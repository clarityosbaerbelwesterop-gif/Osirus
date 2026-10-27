import { z } from "zod";
import { apiIdentity, guardWrite, json } from "@/lib/product/api";
import { createGroupChat, listGroupChats } from "@/lib/agents/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const schema = z.object({
  title: z.string().trim().min(1).max(120),
  agentIds: z.array(z.string().uuid()).min(1).max(12),
});

/** The workspace's group chats, most recently active first. */
export async function GET() {
  const identity = await apiIdentity();
  if (!identity) return json({ error: "unauthorized" }, 401);
  return json({ chats: await listGroupChats(identity) });
}

export async function POST(request: Request) {
  const guard = await guardWrite(request, {
    schema,
    route: "group-chats.create",
    limit: 20,
    maxBytes: 4_000,
  });
  if (!guard.ok) return guard.response;
  const chat = await createGroupChat({
    identity: guard.identity,
    title: guard.body.title,
    agentIds: guard.body.agentIds,
  });
  if (!chat) {
    return json(
      {
        error: "unknown_agent",
        message: "Ein Agent gehört nicht zu diesem Workspace.",
      },
      404,
    );
  }
  return json({ chat }, 201);
}
