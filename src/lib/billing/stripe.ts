import "server-only";
import Stripe from "stripe";
import { env } from "../env";
import { BILLING_CONFIG, PAID_PLANS, type PaidPlan } from "./config";

// The Stripe client and the plan <-> price mapping. Keys and price ids come
// only from the environment; nothing secret lives in code.

export const STRIPE_API_VERSION = "2026-09-30.endive" as const;

let client: Stripe | null = null;

export function billingConfigured() {
  return Boolean(env.STRIPE_SECRET_KEY);
}

export function stripe(): Stripe {
  if (!env.STRIPE_SECRET_KEY)
    throw new Error("STRIPE_SECRET_KEY is not configured");
  client ??= new Stripe(env.STRIPE_SECRET_KEY, {
    apiVersion: STRIPE_API_VERSION,
    appInfo: { name: "Osirus" },
  });
  return client;
}

function priceEnv(): Record<string, string | undefined> {
  return {
    STRIPE_PRICE_PRO: env.STRIPE_PRICE_PRO,
    STRIPE_PRICE_DEVELOPER: env.STRIPE_PRICE_DEVELOPER,
    STRIPE_PRICE_ULTRA_100: env.STRIPE_PRICE_ULTRA_100,
    STRIPE_PRICE_ULTRA_200: env.STRIPE_PRICE_ULTRA_200,
  };
}

export function priceIdFor(
  plan: PaidPlan,
  prices: Record<string, string | undefined> = priceEnv(),
) {
  const name = BILLING_CONFIG.plans[plan].priceEnv;
  return name ? (prices[name] ?? null) : null;
}

/** The plan a Stripe price id belongs to; null for an unknown price. */
export function planForPrice(
  priceId: string | null | undefined,
  prices: Record<string, string | undefined> = priceEnv(),
): PaidPlan | null {
  if (!priceId) return null;
  return (
    PAID_PLANS.find((plan) => priceIdFor(plan, prices) === priceId) ?? null
  );
}

/**
 * Stripe asks integrations to tag Checkout Sessions with an identifier made
 * of a fixed prefix and eight random lowercase letters.
 */
export function integrationIdentifier() {
  const letters = Array.from(
    crypto.getRandomValues(new Uint8Array(8)),
    (byte) => String.fromCharCode(97 + (byte % 26)),
  ).join("");
  return `osirus_billing_${letters}`;
}
