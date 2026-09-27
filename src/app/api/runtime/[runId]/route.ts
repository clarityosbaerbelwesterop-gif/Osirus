import { randomUUID } from "node:crypto";
import { after } from "next/server";
import { z } from "zod";
import { auth, requireAuthConfiguration } from "@/lib/auth/server";
import { bootstrapProductIdentity } from "@/lib/auth/bootstrap";
import { RuntimeRepository } from "@/lib/runtime/repository";
import { pollNudge } from "@/lib/runtime/poll-nudge";
import { driveSlices, finalizeRun } from "@/lib/runtime/worker";
import type { RunSnapshot } from "@/lib/runtime/types";
import { recordAccessRefused } from "@/lib/security/access";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// The poll answers at once; the continuation it may start runs after the
// response, within this function's lifetime.
export const maxDuration = 300;

const paramsSchema = z.object({ runId: z.string().uuid() });

/**
 * How long a continuation started by a poll may drive its run.
 *
 * The same slice a request gets. It must be longer than a stage needs: the
 * worker claims nothing with less than its stage headroom (20 s) left, so a
 * short budget -- this was once 8 s -- never claimed a stage at all, and a
 * run whose request had ended sat still until the next scheduler tick,
 * hours away. It runs after the response, so the poll itself stays fast;
 * the next polls see its live lease and do not start another.
 */
const CONTINUATION_BUDGET_MS = 240_000;

export async function GET(
  _request: Request,
  context: { params: Promise<{ runId: string }> },
) {
  requireAuthConfiguration();
  const { data: session } = await auth.getSession();
  if (!session?.user) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const parsed = paramsSchema.safeParse(await context.params);
  if (!parsed.success) {
    return Response.json({ error: "invalid_run_id" }, { status: 400 });
  }

  const repository = new RuntimeRepository(session.user.id);
  let snapshot: RunSnapshot;
  try {
    // Reading the snapshot first is also the authorisation check: row-level
    // security means a run the caller cannot see is not found, and nothing
    // below runs for a run they do not own.
    snapshot = await repository.getSnapshot(parsed.data.runId);
  } catch (error) {
    if (error instanceof Error && error.message === "run_not_found") {
      await recordAccessRefused(session.user, {
        resource: "run",
        id: parsed.data.runId,
      });
      return Response.json({ error: "not_found" }, { status: 404 });
    }
    throw error;
  }

  const nudge = pollNudge(snapshot);
  if (nudge.settleCancel) {
    // Nobody holds the run, so nobody would ever acknowledge the cancel.
    if (await repository.settleCancellationWithoutWorker(parsed.data.runId)) {
      snapshot = await repository.getSnapshot(parsed.data.runId);
    }
  } else if (nudge.drive || nudge.finalize) {
    const identity = await bootstrapProductIdentity({
      id: session.user.id,
      email: session.user.email,
      name: session.user.name,
    });
    const runId = parsed.data.runId;
    if (nudge.drive) {
      after(() => continueRun(identity, runId));
    } else {
      // Nothing left to run: close the run now if it is finished -- the
      // claim itself may have failed its last stage and claimed nothing.
      const completion = await finalizeRun({ identity, runId }).catch(
        () => null,
      );
      if (completion && completion.status !== "running") {
        snapshot = await repository.getSnapshot(runId);
      }
    }
  }

  return Response.json(snapshot, {
    headers: { "Cache-Control": "no-store" },
  });
}

/** Drive a run nobody holds, then close it if that finished it. */
async function continueRun(
  identity: Awaited<ReturnType<typeof bootstrapProductIdentity>>,
  runId: string,
) {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new Error("continuation_budget_reached")),
    CONTINUATION_BUDGET_MS,
  );
  try {
    const slice = await driveSlices({
      runId,
      workerId: `poll:${randomUUID()}`,
      deadlineAt: Date.now() + CONTINUATION_BUDGET_MS,
      signal: controller.signal,
      identity,
    });
    // Always, not only after a claim: the claim may have failed the last
    // stage (attempts exhausted) and claimed nothing.
    await finalizeRun({ identity, runId, exhausted: slice.exhausted });
  } catch {
    // Best effort: the next poll or scheduler tick picks the run up again.
  } finally {
    clearTimeout(timer);
  }
}
