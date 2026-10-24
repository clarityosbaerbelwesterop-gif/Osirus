import { z } from "zod";
import { guardWrite, json } from "@/lib/product/api";
import { agentsMentioned } from "@/lib/agents/mentions";
import { groupMembers, insertGroupMessage } from "@/lib/agents/store";
import { completePinned } from "@/lib/models/pinned-call";
import { queryAs } from "@/lib/db/client";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

const schema = z.object({
  content: z.string().trim().min(1).max(8000),
});

/**
 * Reply rule until the owner decides otherwise: only @mentioned agents
 * answer. No mention means no agent call.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ chatId: string }> },
) {
  const { chatId } = await context.params;
  if (!z.string().uuid().safeParse(chatId).success) {
    return json({ error: "invalid_request" }, 400);
  }
  const guard = await guardWrite(request, {
    schema,
    route: "group-chats.messages",
    limit: 30,
    maxBytes: 12_000,
  });
  if (!guard.ok) return guard.response;
  const members = await groupMembers(guard.identity, chatId);
  if (!members) return json({ error: "not_found" }, 404);
  if (members.length === 0) return json({ error: "not_found" }, 404);
  await insertGroupMessage({
    identity: guard.identity,
    groupId: chatId,
    role: "user",
    userId: guard.identity.userId,
    content: guard.body.content,
    status: "stored",
  });
  const mentioned = agentsMentioned(
    guard.body.content,
    members.flatMap((member) =>
      member.agent_id && member.name
        ? [{ id: member.agent_id, name: member.name }]
        : [],
    ),
  );
  if (mentioned.length === 0) {
    return json({
      replyRule: "mentions-only",
      replies: [],
      message:
        "Keine @Erwähnung. Es hat kein Agent geantwortet. Wer ohne Erwähnung spricht, ist noch nicht entschieden.",
    });
  }
  const byId = new Map(
    members
      .filter((member) => member.agent_id)
      .map((member) => [member.agent_id, member]),
  );
  const replies = [];
  for (const mention of mentioned) {
    const agent = byId.get(mention.id);
    if (!agent?.model_id || agent.status !== "active") {
      replies.push({
        agentId: mention.id,
        name: mention.name,
        status: "unavailable" as const,
        message: "Bald verfügbar. Der Agent ist pausiert oder hat kein Modell.",
      });
      continue;
    }
    try {
      const result = await completePinned({
        modelId: agent.model_id,
        messages: [
          ...(agent.system_prompt
            ? [{ role: "system" as const, content: agent.system_prompt }]
            : []),
          { role: "user" as const, content: guard.body.content },
        ],
      });
      await queryAs(
        guard.identity.userId,
        `insert into osirus.model_calls
           (organization_id, workspace_id, provider, model, logical_role,
            status, input_tokens, output_tokens, estimated_cost_usd,
            completed_at, request_metadata)
         values ($1::uuid, $2::uuid, 'unorouter', $3, 'STRONG', 'completed',
                 $4, $5, $6, now(), $7::jsonb)`,
        [
          guard.identity.organizationId,
          guard.identity.workspaceId,
          result.modelId,
          result.inputTokens ?? null,
          result.outputTokens ?? null,
          result.costUsd ?? null,
          JSON.stringify({ purpose: "group_chat", agentId: mention.id }),
        ],
      );
      await insertGroupMessage({
        identity: guard.identity,
        groupId: chatId,
        role: "agent",
        agentId: mention.id,
        content: result.text.slice(0, 8000),
        status: "completed",
        modelId: result.modelId,
      });
      replies.push({
        agentId: mention.id,
        name: mention.name,
        status: "completed" as const,
        modelId: result.modelId,
        text: result.text,
      });
    } catch {
      await insertGroupMessage({
        identity: guard.identity,
        groupId: chatId,
        role: "agent",
        agentId: mention.id,
        content: "Bald verfügbar. Keine Antwort vom Modell.",
        status: "unavailable",
        modelId: agent.model_id,
      });
      replies.push({
        agentId: mention.id,
        name: mention.name,
        status: "unavailable" as const,
        modelId: agent.model_id,
        message: "Bald verfügbar. Keine Antwort vom Modell.",
      });
    }
  }
  return json({ replyRule: "mentions-only", replies });
}
