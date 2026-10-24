// Billing and usage quotas: every number in one place.
//
// Owner decisions (2026-10-24): four paid monthly plans, no free plan, and
// each plan has two budgets of model cost in EUR -- a rolling 5-hour window
// and a rolling 7-day window. An empty window means waiting until it refills;
// there is no top-up and no hard ban. Stripe handles currency and tax, so
// there is no margin or exchange-rate logic beyond the fixed usdToEur below,
// which only converts the USD cost UNOROUTER reports per call.
//
// Budgets are computed from the net amount after 19 % VAT, the Stripe fee and
// Stripe Tax (about 81 % of the list price), spread over 4.33 weeks per month;
// the 5-hour window is a fifth of the weekly budget.

export const PAID_PLANS = [
  "pro",
  "developer",
  "ultra_100",
  "ultra_200",
] as const;
export type PaidPlan = (typeof PAID_PLANS)[number];
export type BillingPlan = PaidPlan | "free";

export type PlanConfig = {
  /** Shown to users; the UI owns the final copy. */
  label: string;
  /** List price per month in EUR, incl. VAT (what the Stripe price says). */
  monthlyPriceEur: number;
  /** Model-cost budget in EUR per rolling 7 days. */
  weeklyBudgetEur: number;
  /** Model-cost budget in EUR per rolling 5 hours. */
  fiveHourBudgetEur: number;
  /** Env var holding the Stripe price id (price_...). Never a literal id. */
  priceEnv: string | null;
};

export const BILLING_CONFIG = {
  currency: "eur" as const,
  /**
   * Master switch for server-side quota enforcement. Enforcement is also off
   * while STRIPE_SECRET_KEY is unset (billing not configured).
   */
  enforceQuotas: true,
  /**
   * No free plan (owner decision). Turning this on gives users without a
   * subscription the `free` budgets below instead of no budget at all.
   */
  freePlanEnabled: false,
  /** Fixed USD->EUR factor for UNOROUTER's USD cost. Not a live rate. */
  usdToEur: 0.92,
  /**
   * Placeholder surcharge in EUR added to every model call to cover Vercel
   * and Neon. 0 until the owner sets it.
   */
  infraBufferEur: 0,
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
      weeklyBudgetEur: 3.73,
      fiveHourBudgetEur: 0.75,
      priceEnv: "STRIPE_PRICE_PRO",
    },
    developer: {
      label: "Developer",
      monthlyPriceEur: 50,
      weeklyBudgetEur: 9.41,
      fiveHourBudgetEur: 1.88,
      priceEnv: "STRIPE_PRICE_DEVELOPER",
    },
    ultra_100: {
      label: "Ultra 100",
      monthlyPriceEur: 100,
      weeklyBudgetEur: 18.87,
      fiveHourBudgetEur: 3.77,
      priceEnv: "STRIPE_PRICE_ULTRA_100",
    },
    ultra_200: {
      label: "Ultra 200",
      monthlyPriceEur: 200,
      weeklyBudgetEur: 37.8,
      fiveHourBudgetEur: 7.56,
      priceEnv: "STRIPE_PRICE_ULTRA_200",
    },
    // Only used when freePlanEnabled is true. Placeholder values.
    free: {
      label: "Free",
      monthlyPriceEur: 0,
      weeklyBudgetEur: 0.25,
      fiveHourBudgetEur: 0.05,
      priceEnv: null,
    },
  } satisfies Record<BillingPlan, PlanConfig>,
};

export type BillingConfig = typeof BILLING_CONFIG;

export function isPaidPlan(value: unknown): value is PaidPlan {
  return (
    typeof value === "string" &&
    (PAID_PLANS as readonly string[]).includes(value)
  );
}

/** EUR charged against the quota for one model call's USD cost. */
export function callCostEur(
  costUsd: number | null | undefined,
  config: Pick<BillingConfig, "usdToEur" | "infraBufferEur"> = BILLING_CONFIG,
) {
  const usd =
    typeof costUsd === "number" && Number.isFinite(costUsd) && costUsd > 0
      ? costUsd
      : 0;
  return usd * config.usdToEur + config.infraBufferEur;
}
