import { z } from "zod";
import { quotaEnforced, quotaStatusFor } from "@/lib/billing/enforce";
import { serializeQuota } from "@/lib/billing/quota";
import { apiIdentity, guardWrite, json } from "@/lib/product/api";
import { agentsMentioned, everyoneMentioned } from "@/lib/agents/mentions";
import {
  groupMembers,
  insertGroupMessage,
  listGroupMessages,
  touchGroupChat,
} from "@/lib/agents/store";
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

/** The group chat's messages, oldest first. */
export async function GET(
  _request: Request,
  context: { params: Promise<{ chatId: string }> },
) {
  const { chatId } = await context.params;
  if (!z.string().uuid().safeParse(chatId).success) {
    return json({ error: "invalid_request" }, 400);
  }
  const identity = await apiIdentity();
  if (!identity) return json({ error: "unauthorized" }, 401);
  return json({ messages: await listGroupMessages(identity, chatId) });
}

/** The last turns a bot reads before it answers in the group. */
const CONTEXT_TURNS = 16;

/**
 * Reply rule until the owner decides otherwise: only @mentioned agents
 * answer; @alle asks every bot of the group. No mention means no agent call.
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
  const named = members.flatMap((member) =>
    member.agent_id && member.name
      ? [{ id: member.agent_id, name: member.name }]
      : [],
  );
  const mentioned = everyoneMentioned(guard.body.content)
    ? named.slice(0, 6)
    : agentsMentioned(guard.body.content, named);
  await touchGroupChat(guard.identity, chatId).catch(() => undefined);
  // What was said before, so a bot answers in the conversation, not to a
  // single line. The message just stored is the last turn.
  const earlier = await listGroupMessages(guard.identity, chatId).catch(
    () => [],
  );
  const nameOf = new Map(named.map((agent) => [agent.id, agent.name]));
  const turns = earlier
    .slice(-CONTEXT_TURNS - 1, -1)
    .filter((message) => message.status !== "unavailable")
    .map((message) =>
      message.role === "user"
        ? `Nutzer: ${message.content}`
        : `${nameOf.get(message.agentId ?? "") ?? "Bot"}: ${message.content}`,
    );
  const groupContext = () =>
    turns.length
      ? `Gruppenchat mit ${named.map((agent) => agent.name).join(", ")}. Bisheriger Verlauf:\n\n${turns.join("\n\n").slice(-12_000)}`
      : null;
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
  let questionInContext = false;
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
      context: groupContext(),
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
      // The next bot asked in this turn reads this answer too.
      if (!questionInContext) turns.push(`Nutzer: ${guard.body.content}`);
      questionInContext = true;
      turns.push(
        `${agent.name ?? mention.name}: ${result.text.slice(0, 4000)}`,
      );
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
