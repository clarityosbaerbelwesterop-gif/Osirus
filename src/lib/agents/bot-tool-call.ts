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

const PLAN_BUDGET_MS = 12_000;

/**
 * One short call: does this message need one of the tools? Any failure or
 * a slow model means "no tool" -- the bot then simply answers.
 */
export async function planBotToolCall(input: {
  identity: ProductIdentity;
  sessionId: string;
  model: GatewayModel;
  botName: string;
  message: string;
  catalog: ToolDefinition[];
  signal?: AbortSignal;
}): Promise<PlannedCall | null> {
  const messages = toolPlanMessages({
    botName: input.botName,
    message: input.message,
    tools: input.catalog,
  });
  const started = Date.now();
  const signals = [AbortSignal.timeout(PLAN_BUDGET_MS)];
  if (input.signal) signals.push(input.signal);
  try {
    const result = await completeGateway({
      ref: input.model.ref,
      messages,
      maxTokens: 600,
      temperature: 0,
      signal: AbortSignal.any(signals),
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
  } catch {
    return null;
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
