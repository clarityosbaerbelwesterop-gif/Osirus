import { json } from "@/lib/product/api";
import { loadChatThread } from "@/lib/gateway/threads";
import { loadProductSession } from "@/lib/product/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** One Agents chat thread, for switching conversations without a page load. */
export async function GET(
  _request: Request,
  context: { params: Promise<{ sessionId: string }> },
) {
  const session = await loadProductSession();
  if (!session) return json({ error: "unauthorized" }, 401);
  const { sessionId } = await context.params;
  const thread = await loadChatThread(session.identity, sessionId).catch(
    () => null,
  );
  if (!thread) return json({ error: "not_found" }, 404);
  return json(thread);
}
