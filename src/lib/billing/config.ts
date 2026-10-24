// Billing and usage quotas: every number in one place.
//
// Owner decisions (2026-10-24): four paid monthly plans plus a free quota,
// and each plan has two budgets of model cost -- a rolling 5-hour window and a
// rolling 7-day window. An empty window means waiting until it refills;
// there is no top-up and no hard ban.
//
// The operator is a Kleinunternehmer under § 19 UStG: no VAT is charged, so
// there is no VAT and no Stripe Tax fee in the math, and Stripe Tax
// (automatic_tax) is off by default.
//
// Budgets are fixed USD amounts compared directly against the USD cost that
// UNOROUTER logs per call. There is no exchange-rate logic at runtime; the
// EUR budgets were converted to USD once, by hand:
//
//   net (EUR)    = price - (1.5 % * price + 0.25 EUR)   Stripe card fee
//   week (EUR)   = net / 4.333                         weeks per month
//   5h (EUR)     = week (rounded) / 5
//   USD          = EUR * 1.1253                        fixed, 1 EUR = 1.1253 USD
//   all values rounded to cents
//
//   plan        price  net     week EUR  5h EUR  ->  week USD  5h USD
//   Pro           20   19.45     4.49     0.90        5.05     1.01
//   Developer     50   49.00    11.31     2.26       12.73     2.54
//   Ultra 100    100   98.25    22.67     4.53       25.51     5.10
//   Ultra 200    200  196.75    45.41     9.08       51.10    10.22
//
// To change a budget, redo this derivation and update the table and the
// numbers below together.

export const PAID_PLANS = [
  "pro",
  "developer",
  "ultra_100",
  "ultra_200",
] as const;
export type PaidPlan = (typeof PAID_PLANS)[number];
export type BillingPlan = PaidPlan | "free";

/**
 * Free-plan model lock, enforced server-side in billing/enforce.ts.
 * TODO: wire to the central UNOROUTER model config once that lands (other PR);
 * until then these ids live here.
 */
export type FreePlanLimits = {
  /** Main (non-reviewer) models a free user may run. Empty = no restriction. */
  allowedModels: readonly string[];
  /** Most sub-agents one free run may start. */
  maxSubAgents: number;
  /** The only reviewer/checker (VERIFY role) model allowed. */
  reviewerModel: string;
};

/**
 * PLACEHOLDER: amount pending owner decision. The free budgets below
 * (0.25 USD / 7 days, 0.05 USD / 5 hours) are AI Trainer's proposal; flip
 * this to true once the owner confirms (or changes) them.
 */
export const FREE_TIER_AMOUNTS_CONFIRMED = false;

export type PlanConfig = {
  /** Shown to users; the UI owns the final copy. */
  label: string;
  /** Price per month in EUR (what the Stripe price says; no VAT, § 19 UStG). */
  monthlyPriceEur: number;
  /** Model-cost budget in USD (UNOROUTER cost) per rolling 7 days. */
  weeklyBudgetUsd: number;
  /** Model-cost budget in USD (UNOROUTER cost) per rolling 5 hours. */
  fiveHourBudgetUsd: number;
  /** Env var holding the Stripe price id (price_...). Never a literal id. */
  priceEnv: string | null;
};

export const BILLING_CONFIG = {
  currency: "eur" as const,
  /**
   * Master switch for server-side quota enforcement. Independent of Stripe:
   * without STRIPE_SECRET_KEY users without a paid plan are simply on the
   * free plan (budgets and model lock still enforced); only Checkout,
   * Portal and upgrading need Stripe.
   */
  enforceQuotas: true,
  /**
   * Free quota, on by default (owner decision 2026-10-24): users without an
   * entitled subscription get the `free` budgets below. Emergency kill
   * switch: env OSIRUS_FREE_TIER_ENABLED=false (exactly) turns it off at
   * runtime; see freeTierEnabled().
   */
  freePlanEnabled: true,
  /**
   * Stripe Tax (automatic_tax) in Checkout. Off: the operator is a
   * Kleinunternehmer (§ 19 UStG) and charges no VAT. Turning it on also
   * needs an active tax registration in the Stripe Dashboard.
   */
  stripeAutomaticTax: false,
  /**
   * Note shown on the Checkout page and as the customer's invoice footer.
   * Set to null to show nothing.
   */
  taxNote: "Gemäß § 19 UStG wird keine Umsatzsteuer berechnet." as
    string | null,
  /**
   * Placeholder surcharge in USD added to every model call to cover Vercel
   * and Neon. 0 until the owner sets it.
   */
  infraBufferUsd: 0,
  windows: {
    fiveHourMs: 5 * 60 * 60 * 1000,
    weeklyMs: 7 * 24 * 60 * 60 * 1000,
  },
  /** Stripe subscription statuses that grant the plan's budgets. */
  entitledStatuses: ["active", "trialing"] as readonly string[],
  plans: {
    pro: {
      label: "Pro",
      monthlyPriceEur: 20,
      weeklyBudgetUsd: 5.05,
      fiveHourBudgetUsd: 1.01,
      priceEnv: "STRIPE_PRICE_PRO",
    },
    developer: {
      label: "Developer",
      monthlyPriceEur: 50,
      weeklyBudgetUsd: 12.73,
      fiveHourBudgetUsd: 2.54,
      priceEnv: "STRIPE_PRICE_DEVELOPER",
    },
    ultra_100: {
      label: "Ultra 100",
      monthlyPriceEur: 100,
      weeklyBudgetUsd: 25.51,
      fiveHourBudgetUsd: 5.1,
      priceEnv: "STRIPE_PRICE_ULTRA_100",
    },
    ultra_200: {
      label: "Ultra 200",
      monthlyPriceEur: 200,
      weeklyBudgetUsd: 51.1,
      fiveHourBudgetUsd: 10.22,
      priceEnv: "STRIPE_PRICE_ULTRA_200",
    },
    // Users without an entitled subscription, while the free tier is on.
    // Same mechanics as the paid plans: 5h + 7-day window, wait, no top-up.
    free: {
      label: "Free",
      monthlyPriceEur: 0,
      // PLACEHOLDER: amount pending owner decision (FREE_TIER_AMOUNTS_CONFIRMED)
      weeklyBudgetUsd: 0.25,
      // PLACEHOLDER: amount pending owner decision (FREE_TIER_AMOUNTS_CONFIRMED)
      fiveHourBudgetUsd: 0.05,
      priceEnv: null,
    },
  } satisfies Record<BillingPlan, PlanConfig>,
  /**
   * Free-plan model lock (server-side). TODO: move to the central UNOROUTER
   * config when it lands; keep the ids in sync until then.
   */
  freePlanLimits: {
    allowedModels: ["glm-5.3-flash"],
    maxSubAgents: 2,
    reviewerModel: "gpt-6.1-sol",
  } as FreePlanLimits,
};

export type BillingConfig = typeof BILLING_CONFIG;

export function isPaidPlan(value: unknown): value is PaidPlan {
  return (
    typeof value === "string" &&
    (PAID_PLANS as readonly string[]).includes(value)
  );
}

/**
 * Whether users without a subscription get the free plan right now: on in
 * config and not killed by OSIRUS_FREE_TIER_ENABLED=false (exactly "false";
 * any other value, or unset, leaves it on).
 */
export function freeTierEnabled(
  config: Pick<BillingConfig, "freePlanEnabled"> = BILLING_CONFIG,
  envValue: string | undefined = process.env.OSIRUS_FREE_TIER_ENABLED,
) {
  return config.freePlanEnabled && envValue !== "false";
}

/**
 * Server-side: is the free plan on right now? For the landing CTA ("start
 * free") and anything else that must not offer a free quota while it is off.
 */
export function isFreeTierEnabled(): boolean {
  return freeTierEnabled();
}

/** USD charged against the quota for one model call's logged USD cost. */
export function callCostUsd(
  costUsd: number | null | undefined,
  config: Pick<BillingConfig, "infraBufferUsd"> = BILLING_CONFIG,
) {
  const usd =
    typeof costUsd === "number" && Number.isFinite(costUsd) && costUsd > 0
      ? costUsd
      : 0;
  return usd + config.infraBufferUsd;
}
