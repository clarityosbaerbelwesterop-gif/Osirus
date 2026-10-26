import { BILLING_CONFIG } from "@/lib/billing/config";
import type { GatewayModel } from "./models";
import type { GatewayUsage } from "./stream";

// What one gateway call counts against the person's usage windows. Pure, so
// the chat route and the runtime's GatewayProvider charge the same way.

/** Used when a paid model publishes no price: deliberately not cheap. */
const UNKNOWN_PRICE = { input: 3, output: 15 };

export function estimateTokens(text: string) {
  return Math.ceil(text.length / 4);
}

/**
 * USD one call counts against the person's windows: the provider's figure,
 * else the list price, else a conservative estimate. Free models count at
 * the shadow price (BILLING_CONFIG.freeModelShadowUsdPerMillion).
 */
export function callCostUsd(
  model: Pick<
    GatewayModel,
    "free" | "inputPerMillionUsd" | "outputPerMillionUsd"
  >,
  usage: GatewayUsage,
) {
  if (typeof usage.costUsd === "number" && usage.costUsd > 0)
    return usage.costUsd;
  const price = model.free
    ? BILLING_CONFIG.freeModelShadowUsdPerMillion
    : {
        input: model.inputPerMillionUsd ?? UNKNOWN_PRICE.input,
        output: model.outputPerMillionUsd ?? UNKNOWN_PRICE.output,
      };
  return (
    ((usage.inputTokens ?? 0) * price.input +
      (usage.outputTokens ?? 0) * price.output) /
    1_000_000
  );
}
