import { timingSafeEqual } from "node:crypto";
import { randomUUID } from "node:crypto";
import { after } from "next/server";
import { env } from "@/lib/env";
import { claimNextStage } from "@/lib/runtime/dispatch";
import {
  enforceRateLimit,
  RateLimitError,
  RateLimitUnavailableError,
} from "@/lib/security/rate-limit";
import { budgetStopReason } from "@/lib/runtime/settlement";
import { driveSlices, finalizeRun } from "@/lib/runtime/worker";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

// Recovery for work nobody is holding.
//
// The request path drives its own run while the browser is connected. This
// route exists for everything else: a closed tab, a killed function, a deploy
// landing mid-run. It claims across tenants, which is why it executes each
// stage under the identity recorded on the claimed run rather than under any
// caller identity of its own.
//
// It is never open. hasSameOrigin cannot be used here -- a cron sends no
// Origin header and that helper fails closed on a missing one -- so the route
// authenticates on a shared secret instead, and refuses every request when
// that secret is unset.

const HEADER = "x-osirus-scheduler-secret";

// Vercel Cron invokes with GET and cannot set a custom header; what it does
// set is `Authorization: Bearer $CRON_SECRET`. The configuration sync writes
// the same value to CRON_SECRET and OSIRUS_SCHEDULER_SECRET, so both forms
// carry the same secret and neither widens who may call this route.
const BEARER = /^Bearer\s+(.+)$/i;

/** Work stops this long before the platform limit, leaving room to settle. */
const TICK_BUDGET_MS = 240_000;

/** Bounded per invocation so one tick cannot monopolise a function slot. */
const MAX_STAGES_PER_TICK = 12;
const MAX_RUNS_PER_TICK = 6;

function matches(supplied: string, expected: string) {
  const a = Buffer.from(supplied);
  const b = Buffer.from(expected);
  // timingSafeEqual throws on a length mismatch. Comparing the expected value
  // with itself keeps the work constant so the rejection path does not run
  // measurably faster than the accepting one.
  if (a.length !== b.length) {
    timingSafeEqual(b, b);
    return false;
  }
  return timingSafeEqual(a, b);
}

/** The hourly pulse workflow sends a GitHub OIDC token in this header. */
const OIDC_HEADER = "x-osirus-github-oidc";

async function authorized(request: Request) {
  const expected = env.OSIRUS_SCHEDULER_SECRET;
  if (!expected) return false;

  const header = request.headers.get(HEADER);
  if (header) return matches(header, expected);

  const bearer = BEARER.exec(request.headers.get("authorization") ?? "");
  if (bearer?.[1]) return matches(bearer[1], expected);

  // No shared secret: accept only a GitHub-signed token for this
  // repository's pulse workflow on main (see security/github-oidc.ts).
  const oidc = request.headers.get(OIDC_HEADER);
  if (oidc && oidc.length < 8_192) {
    const { verifyGithubOidc } = await import("@/lib/security/github-oidc");
    return (await verifyGithubOidc(oidc)).ok;
  }

  return false;
}

/** Matches the settings ceiling for dailyChainedTicks; stops every chain. */
const MAX_CHAIN = 288;

async function tick(request: Request) {
  if (!env.OSIRUS_SCHEDULER_SECRET) {
    // Unconfigured means unavailable, never open.
    return Response.json(
      { error: "scheduler_not_configured" },
      { status: 503 },
    );
  }
  if (!(await authorized(request))) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    await enforceRateLimit({
      subject: "scheduler",
      route: "scheduler.tick",
      limit: 60,
    });
  } catch (error) {
    if (error instanceof RateLimitError) {
      return Response.json({ error: "rate_limited" }, { status: 429 });
    }
    if (error instanceof RateLimitUnavailableError) {
      return Response.json({ error: "service_unavailable" }, { status: 503 });
    }
    throw error;
  }

  // A chained tick is started by the previous tick, which lets go of the
  // request after a few seconds; its work must not stop when it does. Every
  // other caller's disconnect still stops the work, as before.
  const chainHeader = request.headers.get("x-osirus-chain");
  const chain = /^\d{1,4}$/.test(chainHeader ?? "") ? Number(chainHeader) : 0;
  const controller = new AbortController();
  if (!chainHeader)
    request.signal.addEventListener(
      "abort",
      () => controller.abort(new Error("request_aborted")),
      { once: true },
    );

  // Scheduled automations whose window has come start first, so the claim
  // loop below executes them in this same tick.
  const { startDueAutomations } = await import("@/lib/automations/store");
  const automationsStarted = await startDueAutomations(5).catch(
    () => [] as string[],
  );

  // Runs nothing else will close: a plan that died midway, or a run whose
  // stages all settled while its worker went away.
  const { recoverStuckRuns } = await import("@/lib/runtime/recovery");
  const recovered = await recoverStuckRuns(10).catch(() => []);

  const workerId = `scheduler:${randomUUID()}`;
  const deadlineAt = Date.now() + TICK_BUDGET_MS;

  // The Intelligence Foundry's bounded step: collect settled trials, start
  // the next one, advance the research cycle. Its trials are runs below
  // product priority, driven by the claim loop below after customer work.
  // A Foundry failure is contained here and never stops the tick.
  const { runFoundryTick } =
    await import("@/lib/intelligence/production/runner");
  const foundry = await runFoundryTick({
    owner: workerId,
    signal: controller.signal,
  }).catch(() => null);

  const { runCapabilityPulseTick } =
    await import("@/lib/agent/pulse/scheduler");
  const pulse = await runCapabilityPulseTick({
    owner: workerId,
    signal: controller.signal,
  }).catch(() => null);
  const touched = new Map<
    string,
    { userId: string; organizationId: string; workspaceId: string }
  >();
  let claimed = 0;
  let completed = 0;
  let failed = 0;

  // One claim across all runs tells us both whether there is work and whose it
  // is. The run is then drained on its own, so a single busy run cannot starve
  // the rest of the queue within one tick.
  while (
    touched.size < MAX_RUNS_PER_TICK &&
    claimed < MAX_STAGES_PER_TICK &&
    Date.now() < deadlineAt &&
    !controller.signal.aborted
  ) {
    const probe = await claimNextStage({ workerId, leaseSeconds: 60 });
    if (!probe) break;

    const identity = {
      userId: probe.requestedBy,
      organizationId: probe.organizationId,
      workspaceId: probe.workspaceId,
    };
    touched.set(probe.runId, identity);

    // The probe already holds a lease on this stage; release it by letting it
    // expire is wasteful, so hand the run to the drive loop which will pick up
    // the next stage, and settle this one first.
    const { executeClaimedStage } = await import("@/lib/runtime/worker");
    const settled = await executeClaimedStage({
      work: probe,
      identity,
      leaseSeconds: 60,
      signal: controller.signal,
    });
    claimed += 1;
    if (settled.outcome.kind === "COMPLETE") completed += 1;
    if (settled.outcome.kind === "FAILED") failed += 1;

    // The probe settled outside the slice loop. Its attempt was charged with
    // its checkpoint; if that charge crossed a ceiling, do not claim another.
    const probeStop = budgetStopReason(settled.outcome, settled.budget);
    if (probeStop) {
      await finalizeRun({
        identity,
        runId: probe.runId,
        exhausted: probeStop,
      }).catch(() => undefined);
      continue;
    }

    const slice = await driveSlices({
      runId: probe.runId,
      workerId,
      deadlineAt,
      signal: controller.signal,
      identity,
      maxStages: MAX_STAGES_PER_TICK - claimed,
    });
    claimed += slice.claimed;
    completed += slice.completed;
    failed += slice.failed;

    await finalizeRun({
      identity,
      runId: probe.runId,
      exhausted: slice.exhausted,
    }).catch(() => undefined);
  }

  // Keep going while there is Foundry work that moved in this tick: another
  // tick is requested from the server, after this response, within the
  // day's continuation envelope. A tick that moved nothing (every Foundry
  // stage parked on a provider refusal, say) ends the chain; the daily cron
  // starts the next one.
  // The chain number is a hard backstop as well: even if the day's ledger
  // could not be charged, no chain outlives the largest daily envelope.
  const chained =
    chain < MAX_CHAIN &&
    ((Boolean(foundry?.continueChain) &&
      (claimed > 0 || (foundry?.step?.progressed ?? 0) > 0)) ||
      Boolean(pulse?.continueChain));
  if (chained)
    after(async () => {
      const { chargeChainedTick } =
        await import("@/lib/intelligence/production/runner");
      const { triggerTick } =
        await import("@/lib/intelligence/production/operator");
      await chargeChainedTick().catch(() => undefined);
      await triggerTick(chain + 1);
    });

  // Counts only. The response carries no objective, no output and no tenant
  // identifier, because whoever holds the scheduler secret is not thereby
  // entitled to read anyone's work.
  return Response.json(
    {
      runs: touched.size,
      claimed,
      completed,
      failed,
      automationsStarted: automationsStarted.length,
      recovered: recovered.length,
      foundry: foundry
        ? {
            ran: foundry.ran,
            phase: foundry.step?.phase ?? null,
            waiting: foundry.reason,
            chained,
          }
        : { ran: false, phase: null, waiting: "error", chained: false },
      pulse: pulse
        ? {
            ran: pulse.ran,
            cycleId: pulse.cycleId,
            tasksRun: pulse.tasksRun,
            completedCycle: pulse.completedCycle,
            regressions: pulse.regressions.length,
            waiting: pulse.reason,
            chained: pulse.continueChain,
          }
        : {
            ran: false,
            cycleId: null,
            tasksRun: 0,
            completedCycle: false,
            regressions: 0,
            waiting: "error",
            chained: false,
          },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: Request) {
  return tick(request);
}

// Vercel Cron only issues GET. The handler is identical and just as closed:
// the same secret gates both verbs.
export async function GET(request: Request) {
  return tick(request);
}
