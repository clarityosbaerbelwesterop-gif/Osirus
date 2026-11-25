import { z } from "zod";
import { requestChatStop } from "@/lib/gateway/threads";
import { guardWrite, json } from "@/lib/product/api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// The stop button of a chat answer. An answer keeps running when the page
// goes away (Safari in the background drops the connection); only this ends
// it. The page sends it before it closes its own connection.

const schema = z.object({ sessionId: z.string().uuid() });

export async function POST(request: Request) {
  const guard = await guardWrite(request, {
    schema,
    route: "chat.stop",
    limit: 60,
    maxBytes: 1_024,
  });
  if (!guard.ok) return guard.response;
  const stopped = await requestChatStop(guard.identity, guard.body.sessionId);
  return stopped ? json({ ok: true }) : json({ error: "not_found" }, 404);
}
