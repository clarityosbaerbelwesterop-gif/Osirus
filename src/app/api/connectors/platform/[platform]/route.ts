import { z } from "zod";
import {
  checkPlatformHealth,
  connectPlatform,
  disconnectPlatform,
  type PlatformId,
} from "@/lib/connectors/platform";
import { guardAction, guardWrite, json } from "@/lib/product/api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const platform = z.enum(["vercel", "neon", "supabase"]);

const schema = z.union([
  z.object({
    action: z.literal("connect"),
    token: z.string().trim().min(20).max(400),
  }),
  z.object({ action: z.literal("check") }),
]);

// Connect (token verified with the provider, then stored sealed) or run a
// live health check. The token never comes back in any response.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ platform: string }> },
) {
  const id = platform.safeParse((await params).platform).data as
    PlatformId | undefined;
  if (!id) return json({ error: "not_found" }, 404);
  const guard = await guardWrite(request, {
    schema,
    route: `connectors.${id}`,
    limit: 10,
    maxBytes: 2 * 1024,
  });
  if (!guard.ok) return guard.response;
  if (guard.body.action === "check")
    return json({ health: await checkPlatformHealth(guard.identity, id) });
  try {
    const verified = await connectPlatform(
      guard.identity,
      id,
      guard.body.token,
    );
    return json({ connected: true, account: verified.account });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message === "connector_key_not_configured")
      return json({ error: "not_configured" }, 409);
    if (message.startsWith("provider_rejected"))
      return json({ error: "token_rejected" }, 400);
    return json({ error: "provider_unreachable" }, 502);
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ platform: string }> },
) {
  const id = platform.safeParse((await params).platform).data as
    PlatformId | undefined;
  if (!id) return json({ error: "not_found" }, 404);
  const guard = await guardAction(request, {
    route: `connectors.${id}.disconnect`,
    limit: 10,
  });
  if (!guard.ok) return guard.response;
  await disconnectPlatform(guard.identity, id);
  return json({ disconnected: true });
}
