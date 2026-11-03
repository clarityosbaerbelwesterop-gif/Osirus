import { z } from "zod";
import { decideToolRequest } from "@/lib/agents/bot-tools";
import { publicToolRequest } from "@/lib/agents/bot-tool-call";
import { guardWrite, json } from "@/lib/product/api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

// The person's answer to a bot's tool request: approve runs the exact stored
// call once with their own MCP connection, decline records the "no". The
// bot's answer follows as a normal chat turn (toolMessageId).

const schema = z.object({
  sessionId: z.string().uuid(),
  messageId: z.string().uuid(),
  approve: z.boolean(),
});

export async function POST(request: Request) {
  const guard = await guardWrite(request, {
    schema,
    route: "chat.tool",
    limit: 20,
    maxBytes: 2_000,
  });
  if (!guard.ok) return guard.response;
  const decided = await decideToolRequest(guard.identity, guard.body).catch(
    () => null,
  );
  if (!decided)
    return json(
      { error: "not_found", message: "Diese Anfrage gibt es nicht mehr." },
      404,
    );
  return json({ request: publicToolRequest(decided) });
}
