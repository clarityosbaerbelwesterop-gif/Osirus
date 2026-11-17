import "server-only";
import type { ProductIdentity } from "../auth/bootstrap";
import type { GatewayModel } from "../gateway/models";
import { completeGateway } from "../gateway/stream";
import { estimateTokens, recordGatewayCall } from "../gateway/usage";
import type { ToolDefinition } from "../tools/registry";
import {
  parseToolPlan,
  toolPlanMessages,
  type BotToolRequest,
  type PlannedCall,
} from "./bot-tool-plan";

// A slow planner answers without a tool rather than holding the reply.
const PLAN_BUDGET_MS = 8_000;
/** Models tried in order before the bot answers without a tool. */
const PLAN_MODELS = 3;

/**
 * One short call: does this message need one of the tools? Any failure or
 * a slow model means "no tool" -- the bot then simply answers.
 */
export async function planBotToolCall(input: {
  identity: ProductIdentity;
  sessionId: string;
  /** The bot's candidates in order; a rate-limited one gives way to the next. */
  models: GatewayModel[];
  botName: string;
  message: string;
  catalog: ToolDefinition[];
  signal?: AbortSignal;
}): Promise<PlannedCall | null> {
  const started = Date.now();
  const deadline = AbortSignal.timeout(PLAN_BUDGET_MS);
  const signal = input.signal
    ? AbortSignal.any([deadline, input.signal])
    : deadline;
  const attempts: string[] = [];
  for (const model of input.models.slice(0, PLAN_MODELS)) {
    if (signal.aborted) break;
    const planned = await planWith({ ...input, model, signal }).catch(
      (error: unknown) => {
        attempts.push(
          `${model.ref}:${error && typeof error === "object" && "code" in error ? String((error as { code?: unknown }).code) : "error"}`,
        );
        return undefined;
      },
    );
    if (planned === undefined) continue;
    // Operator log only: how the step went, never the message or arguments.
    console.info(
      JSON.stringify({
        event: "bot.tool_plan",
        tools: input.catalog.length,
        decided: planned ? planned.toolId : null,
        ms: Date.now() - started,
        failed: attempts,
      }),
    );
    return planned;
  }
  console.info(
    JSON.stringify({
      event: "bot.tool_plan",
      tools: input.catalog.length,
      decided: null,
      ms: Date.now() - started,
      failed: attempts,
    }),
  );
  return null;
}

/** One model's decision; throws when the model does not answer. */
async function planWith(input: {
  identity: ProductIdentity;
  sessionId: string;
  model: GatewayModel;
  botName: string;
  message: string;
  catalog: ToolDefinition[];
  signal: AbortSignal;
}): Promise<PlannedCall | null> {
  const messages = toolPlanMessages({
    botName: input.botName,
    message: input.message,
    tools: input.catalog,
  });
  const started = Date.now();
  {
    const result = await completeGateway({
      ref: input.model.ref,
      messages,
      maxTokens: 600,
      temperature: 0,
      signal: input.signal,
    });
    await recordGatewayCall({
      identity: input.identity,
      model: input.model,
      surface: "ai",
      sessionId: input.sessionId,
      status: "completed",
      usage: {
        ...result.usage,
        inputTokens:
          result.usage.inputTokens ??
          estimateTokens(messages.map((entry) => entry.content).join("\n")),
        outputTokens: result.usage.outputTokens ?? estimateTokens(result.text),
      },
      latencyMs: Date.now() - started,
    }).catch(() => undefined);
    return parseToolPlan(
      result.text,
      input.catalog.map((tool) => tool.id),
    );
  }
}

/** The request as the browser sees it: never the raw tool output. */
export function publicToolRequest(request: BotToolRequest) {
  return {
    id: request.id,
    label: request.label,
    arguments: request.arguments,
    reason: request.reason,
    status: request.status,
    error: request.error ?? null,
  };
}

// Words that carry no topic. Kept short: a missed stopword only costs one
// planning call, a wrong one could hide a tool.
const STOPWORDS = new Set(
  "aber alle also auch bitte dann dass dein deine denn diese dieser dieses doch eine einem einen einer eines etwas habe haben hast hier ihre immer jetzt kann kannst mehr mein meine mich mir nach nicht noch nur oder ohne sehr sein sich sind soll über und unter viel welche wenn wie wird wirst wurde zum zur about after also and are can could does each from have here into just like make more most only other over please some than that the their them then there these they this tool tools using what when where which with would your".split(
    " ",
  ),
);

const INTENT =
  /\b(nutze|nutz|benutze|verwende|frag|frage nach|such|suche|schau|prüfe|ruf|aufrufen|werkzeug|tool|mcp|use|call|ask|look up|search|check)\b/i;

function words(text: string) {
  return new Set(
    text
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .split(/[^a-z0-9]+/)
      .filter((word) => word.length >= 5 && !STOPWORDS.has(word)),
  );
}

/**
 * Whether a message could plausibly want one of these tools. False skips
 * the planning model call (seconds before every answer): no tool named or
 * hinted at, no link or owner/repo, no topic word shared with any tool.
 */
export function toolPlanWorthwhile(
  message: string,
  catalog: Array<{ id: string; title: string; summary: string }>,
) {
  if (INTENT.test(message)) return true;
  if (/https?:\/\/|\b[\w.-]+\/[\w.-]+\b/.test(message)) return true;
  const said = words(message);
  if (!said.size) return false;
  for (const tool of catalog) {
    const vocabulary = words(`${tool.id} ${tool.title} ${tool.summary}`);
    for (const word of said) if (vocabulary.has(word)) return true;
  }
  return false;
}
