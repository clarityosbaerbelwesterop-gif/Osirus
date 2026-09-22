import { randomUUID } from "node:crypto";
import { z } from "zod";
import { auth, requireAuthConfiguration } from "@/lib/auth/server";
import { bootstrapProductIdentity } from "@/lib/auth/bootstrap";
import { RuntimeRepository } from "@/lib/runtime/repository";
import { driveSlices, finalizeRun } from "@/lib/runtime/worker";
import type { RunSnapshot } from "@/lib/runtime/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const paramsSchema = z.object({ runId: z.string().uuid() });

/**
 * How long a poll may spend pushing its own run forward.
 *
 * The client polls every two seconds, so this is a nudge rather than a slice:
 * enough to resume a run whose request died, not enough to turn a status poll
 * into an execution request.
 */
const DRAIN_BUDGET_MS = 8_000;
const DRAIN_MAX_STAGES = 2;

const ACTIVE = new Set(["created", "planning", "queued", "running", "blocked"]);

/**
 * True when the run has work nobody is holding.
 *
 * A stage already marked running has a live worker behind it -- or a lease
 * about to expire, which the claim function reclaims on its own. Either way
 * this poll must not pile on.
 */
function hasOrphanedWork(snapshot: RunSnapshot) {
  if (!ACTIVE.has(snapshot.run.status)) return false;
  if (snapshot.run.cancelRequested) return false;
  const stages = snapshot.stages;
  if (stages.length === 0) return false;
  const running = stages.some((stage) => stage.status === "running");
  if (running) return false;
  return stages.some(
    (stage) => stage.status === "pending" || stage.status === "blocked",
  );
}

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
      return Response.json({ error: "not_found" }, { status: 404 });
    }
    throw error;
  }

  if (hasOrphanedWork(snapshot)) {
    const identity = await bootstrapProductIdentity({
      id: session.user.id,
      email: session.user.email,
      name: session.user.name,
    });
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(new Error("drain_budget_reached")),
      DRAIN_BUDGET_MS,
    );
    try {
      const slice = await driveSlices({
        runId: parsed.data.runId,
        workerId: `poll:${randomUUID()}`,
        deadlineAt: Date.now() + DRAIN_BUDGET_MS,
        signal: controller.signal,
        identity,
        maxStages: DRAIN_MAX_STAGES,
      });
      if (slice.claimed > 0) {
        await finalizeRun({
          identity,
          runId: parsed.data.runId,
          exhausted: slice.exhausted,
        }).catch(() => undefined);
        snapshot = await repository.getSnapshot(parsed.data.runId);
      }
    } finally {
      clearTimeout(timer);
      controller.abort(new Error("drain_finished"));
    }
  }

  return Response.json(snapshot, {
    headers: { "Cache-Control": "no-store" },
  });
}
