import { env } from "@/lib/env";
import {
  activeShare,
  revokeShare,
  shareChat,
  type ShareState,
} from "@/lib/gateway/shares";
import { isUuid } from "@/lib/gateway/threads";
import { apiIdentity, guardAction, json } from "@/lib/product/api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Context = { params: Promise<{ sessionId: string }> };

function view(request: Request, share: ShareState) {
  if (!share) return { shared: false as const };
  const origin = env.OSIRUS_PUBLIC_URL ?? new URL(request.url).origin;
  return {
    shared: true as const,
    url: new URL(`/s/${share.token}`, origin).toString(),
    sharedAt: share.sharedUntil,
  };
}

/** Whether this chat has a public read-only link, and which. */
export async function GET(request: Request, context: Context) {
  const identity = await apiIdentity();
  if (!identity) return json({ error: "unauthorized" }, 401);
  const { sessionId } = await context.params;
  if (!isUuid(sessionId)) return json({ error: "not_found" }, 404);
  return json(view(request, await activeShare(identity, sessionId)));
}

/** Share the chat as it is now (a new link, or the existing one updated). */
export async function POST(request: Request, context: Context) {
  const guard = await guardAction(request, { route: "chat.share", limit: 30 });
  if (!guard.ok) return guard.response;
  const { sessionId } = await context.params;
  if (!isUuid(sessionId)) return json({ error: "not_found" }, 404);
  const share = await shareChat(guard.identity, sessionId);
  if (!share) return json({ error: "not_found" }, 404);
  return json(view(request, share), 201);
}

/** End the link; the page behind it is gone at once. */
export async function DELETE(request: Request, context: Context) {
  const guard = await guardAction(request, { route: "chat.share", limit: 30 });
  if (!guard.ok) return guard.response;
  const { sessionId } = await context.params;
  if (!isUuid(sessionId)) return json({ error: "not_found" }, 404);
  await revokeShare(guard.identity, sessionId);
  return json({ shared: false });
}
