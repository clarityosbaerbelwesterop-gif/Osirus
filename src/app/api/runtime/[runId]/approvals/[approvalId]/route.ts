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

const paramsSchema = z.object({
  runId: z.string().uuid(),
  approvalId: z.string().uuid(),
});
const bodySchema = z.object({ decision: z.enum(["approved", "rejected"]) });

/**
 * Decide a pending approval. The decision and the stage release happen in one
 * statement under the caller's row-level security, so only someone who can
 * manage the run can approve its calls, and an expired or already decided
 * request is not found rather than overwritten.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ runId: string; approvalId: string }> },
) {
  requireAuthConfiguration();
  const { data: session } = await auth.getSession();
  if (!session?.user)
    return Response.json({ error: "unauthorized" }, { status: 401 });
  if (!hasSameOrigin(request))
    return Response.json({ error: "invalid_origin" }, { status: 403 });
  const params = paramsSchema.safeParse(await context.params);
  const body = bodySchema.safeParse(await request.json().catch(() => null));
  if (!params.success || !body.success)
    return Response.json({ error: "invalid_request" }, { status: 400 });

  try {
    await enforceRateLimit({
      subject: `user:${session.user.id}`,
      route: "runtime.approval",
      limit: 30,
    });
  } catch (error) {
    if (error instanceof RateLimitError)
      return Response.json({ error: "rate_limited" }, { status: 429 });
    if (error instanceof RateLimitUnavailableError)
      return Response.json({ error: "service_unavailable" }, { status: 503 });
    throw error;
  }

  const decided = await new RuntimeRepository(session.user.id).resolveApproval({
    approvalId: params.data.approvalId,
    runId: params.data.runId,
    decision: body.data.decision,
  });
  if (!decided) return Response.json({ error: "not_found" }, { status: 404 });
  return Response.json({
    approvalId: decided.id,
    decision: body.data.decision,
  });
}
