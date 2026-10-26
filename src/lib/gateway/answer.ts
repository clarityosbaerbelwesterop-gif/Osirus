import "server-only";
import type { ProductIdentity } from "@/lib/auth/bootstrap";
import { modelAccessFor, modelAllowed } from "./access";
import {
  hideModel,
  listGatewayModels,
  modelPenalty,
  verifiedLead,
  type GatewayModel,
} from "./models";
import { chatSystemPrompt } from "./prompt";
import {
  botTier,
  botWantsCoding,
  candidatesFor,
  FALLBACK_CODES,
} from "./routing";
import { completeGateway, type GatewayMessage } from "./stream";
import { estimateTokens, recordGatewayCall } from "./usage";

// One complete answer from a bot, outside the streaming chat (group chats).
// Same routing as the chat: the bot's role fixes its class, the best model of
// that class answers, the next one takes over when it fails.

function codeOf(error: unknown) {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" ? code : "provider_error";
}

export async function botAnswer(input: {
  identity: ProductIdentity;
  user: { email: string | null; emailVerified?: boolean };
  bot: { id: string; name: string; system_prompt: string | null };
  content: string;
  surface: string;
}): Promise<{ text: string } | { error: string }> {
  const [access, listing] = await Promise.all([
    modelAccessFor({
      userId: input.identity.userId,
      email: input.user.email,
      emailVerified: input.user.emailVerified,
    }),
    listGatewayModels(),
  ]);
  const allowed = listing.models.filter((model) => modelAllowed(model, access));
  const tier = botTier(input.bot);
  const candidates: GatewayModel[] = candidatesFor(allowed, tier, {
    coding: botWantsCoding(input.bot),
    limit: 3,
    penalty: (ref) => modelPenalty(ref),
    lead: verifiedLead(allowed, tier),
  });
  const messages: GatewayMessage[] = [
    {
      role: "system",
      content: chatSystemPrompt({
        botName: input.bot.name,
        botPrompt: input.bot.system_prompt,
      }),
    },
    { role: "user", content: input.content },
  ];
  let last = "provider_error";
  for (const model of candidates) {
    const started = Date.now();
    try {
      const result = await completeGateway({ ref: model.ref, messages });
      if (!result.text.trim())
        throw Object.assign(new Error("empty"), { code: "empty_response" });
      await recordGatewayCall({
        identity: input.identity,
        model,
        surface: input.surface,
        sessionId: null,
        status: "completed",
        usage: {
          inputTokens:
            result.usage.inputTokens ??
            estimateTokens(messages.map((m) => String(m.content)).join("\n")),
          outputTokens:
            result.usage.outputTokens ?? estimateTokens(result.text),
          costUsd: result.usage.costUsd,
        },
        latencyMs: Date.now() - started,
      }).catch(() => undefined);
      return { text: result.text };
    } catch (error) {
      last = codeOf(error);
      if (last === "model_not_configured") hideModel(model.ref);
      if (!FALLBACK_CODES.has(last)) break;
    }
  }
  return { error: last };
}
