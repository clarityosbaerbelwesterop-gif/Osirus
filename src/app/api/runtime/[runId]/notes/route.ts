import { z } from "zod";
import { auth, requireAuthConfiguration } from "@/lib/auth/server";
import { RuntimeRepository } from "@/lib/runtime/repository";
import { hasSameOrigin } from "@/lib/security/request";
import {
  enforceRateLimit,
  RateLimitError,
  RateLimitUnavailableError,
} from "@/lib/security/rate-limit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const paramsSchema = z.object({ runId: z.string().uuid() });
const bodySchema = z.object({ text: z.string().trim().min(1).max(1000) });

const TERMINAL = new Set(["completed", "failed", "cancelled", "cancelling"]);

/**
 * A note to the running agent (like a comment on its plan): stored as a
 * user-visible run event; the agent reads it before its next decision. Only
 * someone who can see the run can add one (row-level security), and only
 * while it still works.
 */
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
  const params = paramsSchema.safeParse(await context.params);
  const body = bodySchema.safeParse(await request.json().catch(() => null));
  if (!params.success || !body.success) {
    return Response.json({ error: "invalid_request" }, { status: 400 });
  }

  try {
    await enforceRateLimit({
      subject: `user:${session.user.id}`,
      route: "runtime.note",
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

  const repository = new RuntimeRepository(session.user.id);
  const run = await repository.getRun(params.data.runId);
  if (!run) return Response.json({ error: "not_found" }, { status: 404 });
  if (TERMINAL.has(String(run.status))) {
    return Response.json({ error: "run_finished" }, { status: 409 });
  }
  const event = await repository.appendEvent({
    runId: params.data.runId,
    type: "user.note",
    visibility: "user",
    summary: body.data.text,
  });
  return Response.json({ id: event.id, at: event.at });
}
