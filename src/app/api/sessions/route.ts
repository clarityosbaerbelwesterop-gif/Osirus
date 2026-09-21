import { z } from "zod";
import { auth, requireAuthConfiguration } from "@/lib/auth/server";
import { bootstrapProductIdentity } from "@/lib/auth/bootstrap";
import { RuntimeRepository } from "@/lib/runtime/repository";
import { hasSameOrigin, readJsonBody } from "@/lib/security/request";
import {
  enforceRateLimit,
  RateLimitError,
  RateLimitUnavailableError,
} from "@/lib/security/rate-limit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const createSchema = z.object({
  title: z.string().trim().min(1).max(120).optional(),
});

async function identityForRequest() {
  requireAuthConfiguration();
  const { data: session } = await auth.getSession();
  if (!session?.user) return null;
  return bootstrapProductIdentity({
    id: session.user.id,
    email: session.user.email,
    name: session.user.name,
  });
}

export async function GET() {
  const identity = await identityForRequest();
  if (!identity)
    return Response.json({ error: "unauthorized" }, { status: 401 });
  const repository = new RuntimeRepository(identity.userId);
  return Response.json(
    await repository.listWorkspaceSessions(identity.workspaceId),
    {
      headers: { "Cache-Control": "no-store" },
    },
  );
}

export async function POST(request: Request) {
  const identity = await identityForRequest();
  if (!identity)
    return Response.json({ error: "unauthorized" }, { status: 401 });
  if (!hasSameOrigin(request)) {
    return Response.json({ error: "invalid_origin" }, { status: 403 });
  }
  if (
    !request.headers
      .get("content-type")
      ?.toLowerCase()
      .startsWith("application/json")
  ) {
    return Response.json({ error: "unsupported_media_type" }, { status: 415 });
  }
  const body = await readJsonBody(request, 4096);
  if (!body.ok) {
    return Response.json(
      { error: body.error },
      { status: body.error === "payload_too_large" ? 413 : 400 },
    );
  }
  const parsed = createSchema.safeParse(body.value);
  if (!parsed.success)
    return Response.json({ error: "invalid_request" }, { status: 400 });

  try {
    await enforceRateLimit({
      subject: `user:${identity.userId}`,
      route: "sessions.create",
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
  const repository = new RuntimeRepository(identity.userId);
  const id = await repository.createSession({
    organizationId: identity.organizationId,
    workspaceId: identity.workspaceId,
    title: parsed.data.title ?? "New chat",
  });
  return Response.json({
    id,
    title: parsed.data.title ?? "New chat",
    updatedAt: new Date().toISOString(),
  });
}
