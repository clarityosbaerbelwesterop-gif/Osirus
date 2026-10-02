import { LabCostBudget } from "../inference/budget";
import type { ModelId } from "./types";

/**
 * Native-model cost card. Not a charge and not a Stripe price.
 * Rouge input is EUR and Rouge output is USD, as specified. No FX rate
 * is invented: an EUR component cannot be reserved against the USD budget.
 */
export interface TokenPrice {
  readonly amount: number;
  readonly currency: "EUR" | "USD";
  readonly perTokens: 1_000_000;
}

export interface ModelPriceCard {
  readonly input: TokenPrice;
  readonly output: TokenPrice;
}

export const NATIVE_PRICE: Record<ModelId, ModelPriceCard> = {
  rouge: {
    input: { amount: 2, currency: "EUR", perTokens: 1_000_000 },
    output: { amount: 4, currency: "USD", perTokens: 1_000_000 },
  },
  quasnir: {
    input: { amount: 1, currency: "USD", perTokens: 1_000_000 },
    output: { amount: 2, currency: "USD", perTokens: 1_000_000 },
  },
  darus: {
    input: { amount: 1, currency: "USD", perTokens: 1_000_000 },
    output: { amount: 2, currency: "USD", perTokens: 1_000_000 },
  },
};

export interface NativeQuote {
  readonly modelId: ModelId;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly eurInput: number;
  readonly usd: number;
  readonly billed: false;
}

export class PriceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PriceError";
  }
}

function component(
  price: TokenPrice,
  tokens: number,
  currency: "EUR" | "USD",
): number {
  if (!Number.isInteger(tokens) || tokens < 0) {
    throw new PriceError("token count must be a non-negative integer");
  }
  if (price.currency !== currency) return 0;
  return (tokens / price.perTokens) * price.amount;
}

export function quoteNative(
  modelId: ModelId,
  inputTokens: number,
  outputTokens: number,
): NativeQuote {
  const card = NATIVE_PRICE[modelId];
  const eurInput =
    component(card.input, inputTokens, "EUR") +
    component(card.output, outputTokens, "EUR");
  const usd =
    component(card.input, inputTokens, "USD") +
    component(card.output, outputTokens, "USD");
  return {
    modelId,
    inputTokens,
    outputTokens,
    eurInput,
    usd,
    billed: false,
  };
}

/**
 * Reserves the USD part on the lab budget. EUR is not converted.
 * Any positive EUR amount stops, because this process has no EUR ceiling
 * and must not pretend the euros are dollars.
 */
export function reserveNativeQuote(
  budget: LabCostBudget,
  quote: NativeQuote,
): void {
  if (quote.eurInput > 0) {
    throw new PriceError(
      `cost budget stop: ${quote.eurInput} EUR is not convertible to the USD budget`,
    );
  }
  budget.reserve(quote.usd);
}
