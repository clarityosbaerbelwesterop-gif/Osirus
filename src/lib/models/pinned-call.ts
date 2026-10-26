import "server-only";
import { randomUUID } from "node:crypto";
import { forUser } from "../billing/enforce";
import type { ModelRole } from "./provider";
import { UnoRouterProvider } from "./unorouter";
import { GatewayProvider } from "../gateway/provider";
import { isGatewayRef } from "../gateway/providers";

/**
 * One named UNOROUTER model. fallback is off, so a refusal is not answered
 * by a different model. When userId is supplied, the call is guarded by
 * the user's 5-hour/weekly quota and free-plan model lock.
 */
export async function completePinned(input: {
  modelId: string;
  messages: { role: "system" | "user" | "assistant"; content: string }[];
  userId?: string;
  role?: ModelRole;
}) {
  if (isGatewayRef(input.modelId)) {
    // A model behind any configured key ("provider:model"), same guard.
    const gateway = new GatewayProvider({ ref: input.modelId });
    const provider = input.userId ? forUser(gateway, input.userId) : gateway;
    const result = await provider.complete({
      requestId: randomUUID(),
      role: input.role ?? "STRONG",
      messages: input.messages,
    });
    return {
      text: result.text,
      modelId: input.modelId,
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      costUsd: result.usage.cost,
    };
  }
  const base = new UnoRouterProvider({
    model: input.modelId,
    fallback: false,
    priority: "P1",
  });
  const provider = input.userId ? forUser(base, input.userId) : base;
  const requestId = randomUUID();
  const result = await provider.complete({
    requestId,
    role: input.role ?? "STRONG",
    messages: input.messages,
  });
  const served = base.servedModel(requestId);
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
