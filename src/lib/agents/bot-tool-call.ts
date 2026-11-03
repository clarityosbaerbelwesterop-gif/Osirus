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

const PLAN_BUDGET_MS = 15_000;
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
