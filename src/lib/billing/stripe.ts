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

export function lookupKeyFor(plan: PaidPlan): string {
  return `osirus_${plan}_monthly_eur`;
}

const resolvedPriceCache = new Map<PaidPlan, string>();

/**
 * Resolves the Stripe Price ID for a paid plan:
 * 1. Returns the configured STRIPE_PRICE_* env var when present.
 * 2. Otherwise queries Stripe by `lookup_key` (`osirus_<plan>_monthly_eur`)
 *    and provisions the product + monthly EUR price on the fly if missing.
 */
export async function resolvePriceId(
  plan: PaidPlan,
  prices: Record<string, string | undefined> = priceEnv(),
): Promise<string | null> {
  const fromEnv = priceIdFor(plan, prices);
  if (fromEnv) return fromEnv;
  const cached = resolvedPriceCache.get(plan);
  if (cached) return cached;
  if (!billingConfigured()) return null;

  try {
    const s = stripe();
    const lookupKey = lookupKeyFor(plan);
    const existing = await s.prices.list({
      lookup_keys: [lookupKey],
      limit: 1,
    });
    if (existing.data[0]?.id) {
      resolvedPriceCache.set(plan, existing.data[0].id);
      return existing.data[0].id;
    }
    const cfg = BILLING_CONFIG.plans[plan];
    const search = await s.products.search({
      query: `metadata['osirus_plan']:'${plan}'`,
    });
    const product =
      search.data[0] ??
      (await s.products.create({
        name: `Osirus ${cfg.label}`,
        metadata: { osirus_plan: plan },
      }));
    const created = await s.prices.create({
      product: product.id,
      currency: "eur",
      unit_amount: cfg.monthlyPriceEur * 100,
      recurring: { interval: "month" },
      tax_behavior: "inclusive",
      lookup_key: lookupKey,
      metadata: { osirus_plan: plan },
    });
    resolvedPriceCache.set(plan, created.id);
    return created.id;
  } catch {
    return null;
  }
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
