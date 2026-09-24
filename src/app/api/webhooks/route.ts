import { z } from "zod";
import { apiIdentity, guardWrite, json } from "@/lib/product/api";
import {
  createEndpoint,
  listEndpoints,
  WEBHOOK_EVENTS,
} from "@/lib/webhooks/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const identity = await apiIdentity();
  if (!identity) return json({ error: "unauthorized" }, 401);
  return json({ endpoints: await listEndpoints(identity).catch(() => []) });
}

const schema = z.object({
  name: z.string().trim().min(1).max(120),
  source: z.enum(["github", "vercel", "generic"]),
  events: z.array(z.enum(WEBHOOK_EVENTS)).max(6).default([]),
});

// The signing secret is in this response and nowhere else, ever again.
export async function POST(request: Request) {
  const guard = await guardWrite(request, {
    schema,
    route: "webhooks.create",
    limit: 10,
    maxBytes: 4 * 1024,
  });
  if (!guard.ok) return guard.response;
  try {
    const { endpoint, secret } = await createEndpoint(
      guard.identity,
      guard.body,
    );
    const origin = new URL(request.url).origin;
    return json(
      { endpoint, secret, url: `${origin}/api/hooks/${endpoint.id}` },
      201,
    );
  } catch (error) {
    return json(
      {
        error:
          error instanceof Error &&
          error.message === "connector_key_not_configured"
            ? "not_configured"
            : "forbidden",
      },
      error instanceof Error && error.message === "connector_key_not_configured"
        ? 409
        : 403,
    );
  }
}
