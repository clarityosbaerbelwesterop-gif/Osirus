import { timingSafeEqual } from "node:crypto";
import { randomUUID } from "node:crypto";
import { env } from "@/lib/env";
import { claimNextStage } from "@/lib/runtime/dispatch";
import {
  enforceRateLimit,
  RateLimitError,
  RateLimitUnavailableError,
} from "@/lib/security/rate-limit";
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

function authorized(request: Request) {
  const expected = env.OSIRUS_SCHEDULER_SECRET;
  if (!expected) return false;

  const header = request.headers.get(HEADER);
  if (header) return matches(header, expected);

  const bearer = BEARER.exec(request.headers.get("authorization") ?? "");
  if (bearer?.[1]) return matches(bearer[1], expected);

  return false;
}

async function tick(request: Request) {
  if (!env.OSIRUS_SCHEDULER_SECRET) {
    // Unconfigured means unavailable, never open.
    return Response.json(
      { error: "scheduler_not_configured" },
      { status: 503 },
    );
  }
  if (!authorized(request)) {
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

  const controller = new AbortController();
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

  const workerId = `scheduler:${randomUUID()}`;
  const deadlineAt = Date.now() + TICK_BUDGET_MS;
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
