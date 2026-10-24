import "server-only";
import { randomUUID } from "node:crypto";
import { UnoRouterProvider } from "./unorouter";

/**
 * One named UNOROUTER model. fallback is off, so a refusal is not answered
 * by a different model.
 */
export async function completePinned(input: {
  modelId: string;
  messages: { role: "system" | "user" | "assistant"; content: string }[];
}) {
  const provider = new UnoRouterProvider({
    model: input.modelId,
    fallback: false,
    priority: "P1",
  });
  const requestId = randomUUID();
  const result = await provider.complete({
    requestId,
    role: "STRONG",
    messages: input.messages,
  });
  const served = provider.servedModel(requestId);
  if (served && served !== input.modelId) {
    throw new Error("model_switched");
  }
  return {
    text: result.text,
    modelId: input.modelId,
    inputTokens: result.usage.inputTokens,
    outputTokens: result.usage.outputTokens,
    costUsd: result.usage.cost,
  };
}
