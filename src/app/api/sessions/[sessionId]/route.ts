import { z } from "zod";
import { auth, requireAuthConfiguration } from "@/lib/auth/server";
import { bootstrapProductIdentity } from "@/lib/auth/bootstrap";
import { RuntimeRepository } from "@/lib/runtime/repository";
import { guardWrite, json } from "@/lib/product/api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const paramsSchema = z.object({ sessionId: z.string().uuid() });

export async function GET(
  _request: Request,
  context: { params: Promise<{ sessionId: string }> },
) {
  requireAuthConfiguration();
  const { data: session } = await auth.getSession();
  if (!session?.user)
    return Response.json({ error: "unauthorized" }, { status: 401 });
  const parsed = paramsSchema.safeParse(await context.params);
  if (!parsed.success)
    return Response.json({ error: "invalid_session_id" }, { status: 400 });
  const identity = await bootstrapProductIdentity({
    id: session.user.id,
    email: session.user.email,
    name: session.user.name,
  });
  const repository = new RuntimeRepository(identity.userId);
  try {
    return Response.json(
      await repository.getSessionState(
        parsed.data.sessionId,
        identity.workspaceId,
      ),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof Error && error.message === "session_not_found") {
      return Response.json({ error: "not_found" }, { status: 404 });
    }
    throw error;
  }
}

const pinSchema = z.object({ pinned: z.boolean() });

export async function PATCH(
  request: Request,
  context: { params: Promise<{ sessionId: string }> },
) {
  const parsed = paramsSchema.safeParse(await context.params);
  if (!parsed.success) return json({ error: "invalid_session_id" }, 400);
  const guard = await guardWrite(request, {
    schema: pinSchema,
    route: "sessions.pin",
    limit: 60,
    maxBytes: 1024,
  });
  if (!guard.ok) return guard.response;
  const repository = new RuntimeRepository(guard.identity.userId);
  const updated = await repository.setSessionPinned({
    sessionId: parsed.data.sessionId,
    workspaceId: guard.identity.workspaceId,
    pinned: guard.body.pinned,
  });
  if (!updated) return json({ error: "not_found" }, 404);
  return json({ id: parsed.data.sessionId, pinned: guard.body.pinned });
}
