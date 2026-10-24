import {
  BILLING_CONFIG,
  callCostEur,
  type BillingConfig,
  type BillingPlan,
} from "./config";

// Pure quota math. A window is rolling: what counts is the cost of the calls
// made in the last `windowMs`. When the window is spent, it becomes usable
// again as soon as enough of its oldest calls age out to bring the spend back
// under the budget, and it is full again when its newest call ages out.

export type UsageCall = { at: Date; costUsd: number | null };

export type WindowName = "fiveHour" | "weekly";

export type WindowStatus = {
  window: WindowName;
  windowMs: number;
  budgetEur: number;
  spentEur: number;
  remainingEur: number;
  exhausted: boolean;
  /** When the window has budget again (now when it already has). */
  availableAt: Date;
  /** Milliseconds until availableAt; 0 when usable now. */
  retryAfterMs: number;
  /** When every call in the window has aged out. */
  fullAt: Date;
};

export type QuotaStatus = {
  plan: BillingPlan | null;
  allowed: boolean;
  /** Why not allowed: no plan at all, or a window is spent. */
  reason: "ok" | "no_subscription" | "quota_exhausted";
  windows: WindowStatus[];
  /** Latest availableAt of the spent windows; null when allowed or no plan. */
  availableAt: Date | null;
  retryAfterMs: number;
};

const round = (value: number) => Math.round(value * 1e6) / 1e6;

export function windowStatus(input: {
  window: WindowName;
  windowMs: number;
  budgetEur: number;
  calls: UsageCall[];
  now: Date;
  config?: Pick<BillingConfig, "usdToEur" | "infraBufferEur">;
}): WindowStatus {
  const now = input.now.getTime();
  const start = now - input.windowMs;
  const inWindow = input.calls
    .filter((call) => {
      const at = call.at.getTime();
      return at > start && at <= now;
    })
    .map((call) => ({
      at: call.at.getTime(),
      eur: callCostEur(call.costUsd, input.config),
    }))
    .sort((a, b) => a.at - b.at);
  const spent = inWindow.reduce((sum, call) => sum + call.eur, 0);
  const exhausted = spent >= input.budgetEur;

  let availableAt = now;
  if (exhausted) {
    // Age out the oldest calls until the spend is back under the budget.
    let remaining = spent;
    for (const call of inWindow) {
      remaining -= call.eur;
      if (remaining < input.budgetEur) {
        availableAt = call.at + input.windowMs;
        break;
      }
    }
  }
  const newest = inWindow.at(-1);
  const fullAt = newest ? newest.at + input.windowMs : now;
  return {
    window: input.window,
    windowMs: input.windowMs,
    budgetEur: input.budgetEur,
    spentEur: round(spent),
    remainingEur: round(Math.max(0, input.budgetEur - spent)),
    exhausted,
    availableAt: new Date(availableAt),
    retryAfterMs: Math.max(0, availableAt - now),
    fullAt: new Date(fullAt),
  };
}

export function quotaStatus(input: {
  plan: BillingPlan | null;
  calls: UsageCall[];
  now?: Date;
  config?: BillingConfig;
}): QuotaStatus {
  const config = input.config ?? BILLING_CONFIG;
  const now = input.now ?? new Date();
  if (!input.plan)
    return {
      plan: null,
      allowed: false,
      reason: "no_subscription",
      windows: [],
      availableAt: null,
      retryAfterMs: 0,
    };
  const plan = config.plans[input.plan];
  const windows = [
    windowStatus({
      window: "fiveHour",
      windowMs: config.windows.fiveHourMs,
      budgetEur: plan.fiveHourBudgetEur,
      calls: input.calls,
      now,
      config,
    }),
    windowStatus({
      window: "weekly",
      windowMs: config.windows.weeklyMs,
      budgetEur: plan.weeklyBudgetEur,
      calls: input.calls,
      now,
      config,
    }),
  ];
  const spent = windows.filter((window) => window.exhausted);
  if (!spent.length)
    return {
      plan: input.plan,
      allowed: true,
      reason: "ok",
      windows,
      availableAt: null,
      retryAfterMs: 0,
    };
  const availableAt = new Date(
    Math.max(...spent.map((window) => window.availableAt.getTime())),
  );
  return {
    plan: input.plan,
    allowed: false,
    reason: "quota_exhausted",
    windows,
    availableAt,
    retryAfterMs: Math.max(0, availableAt.getTime() - now.getTime()),
  };
}

/**
 * The plan a subscription row grants, or the free plan / nothing when there
 * is no entitled subscription.
 */
export function effectivePlan(
  subscription: { plan: string | null; status: string } | null,
  config: BillingConfig = BILLING_CONFIG,
): BillingPlan | null {
  if (
    subscription?.plan &&
    subscription.plan in config.plans &&
    subscription.plan !== "free" &&
    config.entitledStatuses.includes(subscription.status)
  )
    return subscription.plan as BillingPlan;
  return config.freePlanEnabled ? "free" : null;
}

/** JSON shape for the UI. */
export function serializeQuota(status: QuotaStatus) {
  return {
    plan: status.plan,
    allowed: status.allowed,
    reason: status.reason,
    availableAt: status.availableAt?.toISOString() ?? null,
    retryAfterSeconds: Math.ceil(status.retryAfterMs / 1000),
    windows: status.windows.map((window) => ({
      window: window.window,
      windowHours: window.windowMs / 3_600_000,
      budgetEur: window.budgetEur,
      spentEur: window.spentEur,
      remainingEur: window.remainingEur,
      exhausted: window.exhausted,
      availableAt: window.availableAt.toISOString(),
      retryAfterSeconds: Math.ceil(window.retryAfterMs / 1000),
      fullAt: window.fullAt.toISOString(),
    })),
  };
}
