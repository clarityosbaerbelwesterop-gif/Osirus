import { z } from "zod";
import { auth, requireAuthConfiguration } from "@/lib/auth/server";
import { parseCodingPermission } from "@/lib/coding/intent";
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
const bodySchema = z.object({
  permission: z.enum(["ask", "accept-edits"]),
});

/**
 * The one coding mode switch. Accept-edits lets file edits through.
 * Reads and commands still wait for Yes. Other surfaces are not updated.
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
      route: "runtime.intent",
      limit: 30,
    });
  } catch (error) {
    if (error instanceof RateLimitError)
      return Response.json({ error: "rate_limited" }, { status: 429 });
    if (error instanceof RateLimitUnavailableError)
      return Response.json({ error: "service_unavailable" }, { status: 503 });
    throw error;
  }
  const permission = parseCodingPermission(body.data.permission);
  const updated = await new RuntimeRepository(
    session.user.id,
  ).setCodingPermission(params.data.runId, permission);
  if (!updated) return Response.json({ error: "not_found" }, { status: 404 });
  return Response.json({ permission });
}
