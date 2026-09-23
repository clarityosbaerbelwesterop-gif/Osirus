import { z } from "zod";
import { auth, requireAuthConfiguration } from "@/lib/auth/server";
import { bootstrapProductIdentity } from "@/lib/auth/bootstrap";
import {
  connectGithub,
  disconnectGithub,
  githubConnectorStatus,
} from "@/lib/connectors/github";
import { hasSameOrigin } from "@/lib/security/request";
import {
  enforceRateLimit,
  RateLimitError,
  RateLimitUnavailableError,
} from "@/lib/security/rate-limit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// The GitHub connector for the caller's workspace. The token goes in once, on
// POST, and never comes back out: GET reports login and scopes only.

async function identity() {
  requireAuthConfiguration();
  const { data: session } = await auth.getSession();
  if (!session?.user) return null;
  return bootstrapProductIdentity({
    id: session.user.id,
    email: session.user.email,
    name: session.user.name,
  });
}

async function limited(userId: string) {
  try {
    await enforceRateLimit({
      subject: `user:${userId}`,
      route: "connectors.github",
      limit: 10,
    });
    return null;
  } catch (error) {
    if (error instanceof RateLimitError)
      return Response.json({ error: "rate_limited" }, { status: 429 });
    if (error instanceof RateLimitUnavailableError)
      return Response.json({ error: "service_unavailable" }, { status: 503 });
    throw error;
  }
}

export async function GET() {
  const who = await identity();
  if (!who) return Response.json({ error: "unauthorized" }, { status: 401 });
  return Response.json(await githubConnectorStatus(who));
}

const bodySchema = z.object({
  token: z.string().min(20).max(300),
  allowWrite: z.boolean().default(false),
});

export async function POST(request: Request) {
  const who = await identity();
  if (!who) return Response.json({ error: "unauthorized" }, { status: 401 });
  if (!hasSameOrigin(request))
    return Response.json({ error: "invalid_origin" }, { status: 403 });
  const blocked = await limited(who.userId);
  if (blocked) return blocked;
  const body = bodySchema.safeParse(await request.json().catch(() => null));
  if (!body.success)
    return Response.json({ error: "invalid_request" }, { status: 400 });
  try {
    const { login } = await connectGithub(who, {
      token: body.data.token.trim(),
      scopes: body.data.allowWrite ? ["repo:write"] : [],
    });
    return Response.json({ status: "CONNECTED", login });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "connect_failed";
    // Never echo anything derived from the token back.
    const known = ["connector_key_not_configured", "token_malformed"].find(
      (code) => reason === code,
    );
    return Response.json(
      {
        error:
          known ??
          (reason.startsWith("github_token_rejected")
            ? "github_rejected_token"
            : "connect_failed"),
      },
      { status: known === "connector_key_not_configured" ? 503 : 400 },
    );
  }
}

export async function DELETE(request: Request) {
  const who = await identity();
  if (!who) return Response.json({ error: "unauthorized" }, { status: 401 });
  if (!hasSameOrigin(request))
    return Response.json({ error: "invalid_origin" }, { status: 403 });
  await disconnectGithub(who);
  return Response.json({ status: "NOT_CONNECTED" });
}
