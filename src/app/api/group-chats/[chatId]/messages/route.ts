import { z } from "zod";
import { quotaEnforced, quotaStatusFor } from "@/lib/billing/enforce";
import { serializeQuota } from "@/lib/billing/quota";
import { guardWrite, json } from "@/lib/product/api";
import { agentsMentioned } from "@/lib/agents/mentions";
import { groupMembers, insertGroupMessage } from "@/lib/agents/store";
import { botAnswer } from "@/lib/gateway/answer";
import { chatErrorMessage } from "@/lib/gateway/prompt";
import { loadProductSession } from "@/lib/product/session";
import { publicRuntimeErrorMessage } from "@/lib/runtime/errors";

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
        "Keine @Erwähnung: Es antwortet nur, wer mit @Name angesprochen wird.",
    });
  }
  if (quotaEnforced()) {
    const quota = await quotaStatusFor(guard.identity.userId);
    if (!quota.allowed) {
      const noPlan = quota.reason === "no_subscription";
      return Response.json(
        {
          error: noPlan ? "subscription_required" : "quota_exhausted",
          message: publicRuntimeErrorMessage({
            code: noPlan ? "subscription_required" : "quota_exhausted",
          }),
          quota: serializeQuota(quota),
        },
        {
          status: noPlan ? 402 : 429,
          headers: noPlan
            ? undefined
            : { "Retry-After": String(Math.ceil(quota.retryAfterMs / 1000)) },
        },
      );
    }
  }
  const byId = new Map(
    members
      .filter((member) => member.agent_id)
      .map((member) => [member.agent_id, member]),
  );
  const session = await loadProductSession();
  const replies = [];
  for (const mention of mentioned) {
    const agent = byId.get(mention.id);
    if (!agent || agent.status !== "active") {
      replies.push({
        agentId: mention.id,
        name: mention.name,
        status: "unavailable" as const,
        message: "Dieser Bot ist pausiert.",
      });
      continue;
    }
    const result = await botAnswer({
      identity: guard.identity,
      user: {
        email: session?.user.email ?? null,
        emailVerified: session?.user.emailVerified,
      },
      bot: {
        id: mention.id,
        name: agent.name ?? mention.name,
        system_prompt: agent.system_prompt,
      },
      content: guard.body.content,
      surface: "group_chat",
    });
    if ("text" in result) {
      await insertGroupMessage({
        identity: guard.identity,
        groupId: chatId,
        role: "agent",
        agentId: mention.id,
        content: result.text.slice(0, 8000),
        status: "completed",
        modelId: "auto",
      });
      replies.push({
        agentId: mention.id,
        name: mention.name,
        status: "completed" as const,
        text: result.text,
      });
    } else {
      const message = chatErrorMessage(result.error);
      await insertGroupMessage({
        identity: guard.identity,
        groupId: chatId,
        role: "agent",
        agentId: mention.id,
        content: message,
        status: "unavailable",
        modelId: "auto",
      });
      replies.push({
        agentId: mention.id,
        name: mention.name,
        status: "unavailable" as const,
        message,
      });
    }
  }
  return json({ replyRule: "mentions-only", replies });
}
