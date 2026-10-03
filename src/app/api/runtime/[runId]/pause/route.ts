import { z } from "zod";
import { auth, requireAuthConfiguration } from "@/lib/auth/server";
import { abortLocalRun } from "@/lib/runtime/cancellation";
import { canPauseCodingRun, canResumeCodingRun } from "@/lib/runtime/pause";
import { RuntimeRepository } from "@/lib/runtime/repository";
import type { RunStatus } from "@/lib/runtime/types";
import { hasSameOrigin } from "@/lib/security/request";
import {
  enforceRateLimit,
  RateLimitError,
  RateLimitUnavailableError,
} from "@/lib/security/rate-limit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const paramsSchema = z.object({ runId: z.string().uuid() });
const bodySchema = z.object({ action: z.enum(["pause", "resume"]) });

export async function POST(
  request: Request,
  context: { params: Promise<{ runId: string }> },
) {
  requireAuthConfiguration();
  const { data: session } = await auth.getSession();
  if (!session?.user) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!hasSameOrigin(request)) {
    return Response.json({ error: "invalid_origin" }, { status: 403 });
  }

  const parsed = paramsSchema.safeParse(await context.params);
  if (!parsed.success) {
    return Response.json({ error: "invalid_run_id" }, { status: 400 });
  }
  const body = bodySchema.safeParse(await request.json().catch(() => null));
  if (!body.success) {
    return Response.json({ error: "invalid_request" }, { status: 400 });
  }

  const repository = new RuntimeRepository(session.user.id);
  try {
    await enforceRateLimit({
      subject: `user:${session.user.id}`,
      route: "runtime.pause",
      limit: 30,
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

  const run = await repository.getRun(parsed.data.runId);
  if (!run) return Response.json({ error: "not_found" }, { status: 404 });
  const input = await repository.getRunInput(parsed.data.runId);
  const coding = input?.surface === "coding";
  const paused = Boolean(run.paused_at);
  const allowed =
    body.data.action === "pause"
      ? canPauseCodingRun({ coding, status: run.status, paused })
      : canResumeCodingRun({ coding, status: run.status, paused });
  if (!allowed) {
    return Response.json(
      {
        error: "pause_unavailable",
        message:
          body.data.action === "pause"
            ? "Pause is only available while a coding run is in progress."
            : "Resume continues the coding run that was paused.",
      },
      { status: 409 },
    );
  }

  const updated = await repository.setCodingPaused(
    parsed.data.runId,
    body.data.action === "pause",
  );
  if (!updated) {
    return Response.json({ error: "pause_unavailable" }, { status: 409 });
  }
  if (body.data.action === "pause") {
    abortLocalRun(parsed.data.runId, "pause_requested");
  }
  return Response.json({
    runId: updated.id,
    status: updated.status as RunStatus,
    paused: Boolean(updated.paused_at),
  });
}
