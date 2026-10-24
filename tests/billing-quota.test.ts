import { describe, expect, it, vi } from "vitest";
import type { ModelProvider } from "../src/lib/models/provider";
import {
  BILLING_CONFIG,
  callCostUsd,
  type BillingConfig,
} from "../src/lib/billing/config";
import {
  effectivePlan,
  quotaStatus,
  serializeQuota,
  windowStatus,
  type UsageCall,
} from "../src/lib/billing/quota";
import {
  providerRefusalOf,
  refusalDelaySeconds,
} from "../src/lib/models/provider";

const H = 60 * 60 * 1000;
const now = new Date("2026-10-24T12:00:00Z");
const ago = (ms: number) => new Date(now.getTime() - ms);

describe("billing config", () => {
  it("holds the owner's plans, prices and fixed USD budgets", () => {
    const plans = BILLING_CONFIG.plans;
    expect(BILLING_CONFIG.freePlanEnabled).toBe(false);
    expect(BILLING_CONFIG.infraBufferUsd).toBe(0);
    expect("usdToEur" in BILLING_CONFIG).toBe(false);
    expect(
      [plans.pro, plans.developer, plans.ultra_100, plans.ultra_200].map(
        (p) => [p.monthlyPriceEur, p.weeklyBudgetUsd, p.fiveHourBudgetUsd],
      ),
    ).toEqual([
      [20, 5.05, 1.01],
      [50, 12.73, 2.54],
      [100, 25.51, 5.1],
      [200, 51.1, 10.22],
    ]);
    expect(BILLING_CONFIG.windows.fiveHourMs).toBe(5 * H);
    expect(BILLING_CONFIG.windows.weeklyMs).toBe(7 * 24 * H);
  });

  it("budgets follow the documented one-time derivation", () => {
    const cents = (v: number) => Math.round(v * 100 + 1e-9) / 100;
    for (const plan of [
      "pro",
      "developer",
      "ultra_100",
      "ultra_200",
    ] as const) {
      const p = BILLING_CONFIG.plans[plan];
      const net = p.monthlyPriceEur - (0.015 * p.monthlyPriceEur + 0.25);
      const weekEur = cents(net / 4.333);
      const fiveHourEur = cents(weekEur / 5);
      expect(p.weeklyBudgetUsd).toBe(cents(weekEur * 1.1253));
      expect(p.fiveHourBudgetUsd).toBe(cents(fiveHourEur * 1.1253));
    }
  });

  it("charges no VAT: Stripe Tax off, § 19 UStG note set", () => {
    expect(BILLING_CONFIG.stripeAutomaticTax).toBe(false);
    expect(BILLING_CONFIG.taxNote).toBe(
      "Gemäß § 19 UStG wird keine Umsatzsteuer berechnet.",
    );
  });

  it("charges the logged USD cost plus the infra buffer, no conversion", () => {
    expect(callCostUsd(1)).toBe(1);
    expect(callCostUsd(0.0123)).toBe(0.0123);
    expect(callCostUsd(null)).toBe(0);
    expect(callCostUsd(-3)).toBe(0);
    expect(callCostUsd(2, { infraBufferUsd: 0.01 })).toBeCloseTo(2.01);
    // The buffer applies even to a free call.
    expect(callCostUsd(0, { infraBufferUsd: 0.01 })).toBeCloseTo(0.01);
  });
});

describe("rolling windows", () => {
  it("counts only calls inside the window", () => {
    const calls: UsageCall[] = [
      { at: ago(6 * H), costUsd: 0.5 }, // outside 5h
      { at: ago(2 * H), costUsd: 0.2 },
    ];
    const status = windowStatus({
      window: "fiveHour",
      windowMs: 5 * H,
      budgetUsd: 0.75,
      calls,
      now,
    });
    expect(status.spentUsd).toBeCloseTo(0.2);
    expect(status.remainingUsd).toBeCloseTo(0.55);
    expect(status.exhausted).toBe(false);
    expect(status.retryAfterMs).toBe(0);
    expect(status.fullAt.getTime()).toBe(ago(2 * H).getTime() + 5 * H);
  });

  it("refills when enough of the oldest spend ages out", () => {
    const calls: UsageCall[] = [
      { at: ago(4 * H), costUsd: 0.3 },
      { at: ago(3 * H), costUsd: 0.3 },
      { at: ago(1 * H), costUsd: 0.3 },
    ];
    const status = windowStatus({
      window: "fiveHour",
      windowMs: 5 * H,
      budgetUsd: 0.75,
      calls,
      now,
    });
    expect(status.exhausted).toBe(true);
    expect(status.remainingUsd).toBe(0);
    // Dropping the 4h-old call leaves 0.6 < 0.75: available in 1 hour.
    expect(status.retryAfterMs).toBe(1 * H);
    expect(status.availableAt.getTime()).toBe(now.getTime() + 1 * H);
    expect(status.fullAt.getTime()).toBe(now.getTime() + 4 * H);
  });

  it("a plan is blocked by whichever window is spent, until the later refill", () => {
    // Weekly Pro budget 5.05 spent 3 days ago; 5h window untouched.
    const calls: UsageCall[] = [{ at: ago(72 * H), costUsd: 5.1 }];
    const status = quotaStatus({ plan: "pro", calls, now });
    expect(status.allowed).toBe(false);
    expect(status.reason).toBe("quota_exhausted");
    expect(status.windows.find((w) => w.window === "fiveHour")!.exhausted).toBe(
      false,
    );
    expect(status.retryAfterMs).toBe((7 * 24 - 72) * H);

    const fresh = quotaStatus({
      plan: "pro",
      calls,
      now: new Date(now.getTime() + (7 * 24 - 72) * H),
    });
    expect(fresh.allowed).toBe(true);
  });

  it("uses each plan's own budgets", () => {
    const calls: UsageCall[] = [{ at: ago(H), costUsd: 1.2 }];
    expect(quotaStatus({ plan: "pro", calls, now }).allowed).toBe(false);
    expect(quotaStatus({ plan: "developer", calls, now }).allowed).toBe(true);
    const ultra = quotaStatus({ plan: "ultra_200", calls, now });
    expect(ultra.windows[0]!.remainingUsd).toBeCloseTo(9.02);
    expect(ultra.windows[1]!.remainingUsd).toBeCloseTo(49.9);
  });

  it("no plan means no budget, and the free plan only when switched on", () => {
    expect(quotaStatus({ plan: null, calls: [], now }).reason).toBe(
      "no_subscription",
    );
    expect(effectivePlan(null)).toBeNull();
    expect(effectivePlan({ plan: "pro", status: "active" })).toBe("pro");
    expect(effectivePlan({ plan: "ultra_100", status: "trialing" })).toBe(
      "ultra_100",
    );
    expect(effectivePlan({ plan: "pro", status: "past_due" })).toBeNull();
    expect(effectivePlan({ plan: "pro", status: "canceled" })).toBeNull();
    const withFree: BillingConfig = {
      ...BILLING_CONFIG,
      freePlanEnabled: true,
    };
    expect(effectivePlan(null, withFree)).toBe("free");
    expect(effectivePlan({ plan: "pro", status: "canceled" }, withFree)).toBe(
      "free",
    );
  });

  it("serializes remaining budget and refill times for the UI", () => {
    const calls: UsageCall[] = [{ at: ago(H), costUsd: 1.1 }];
    const body = serializeQuota(quotaStatus({ plan: "pro", calls, now }));
    expect(body.allowed).toBe(false);
    expect(body.retryAfterSeconds).toBe(4 * 3600);
    expect(body.availableAt).toBe(
      new Date(now.getTime() + 4 * H).toISOString(),
    );
    expect(body.windows.map((w) => [w.window, w.windowHours])).toEqual([
      ["fiveHour", 5],
      ["weekly", 168],
    ]);
  });
});

describe("quota refusals", () => {
  it("quota_exhausted parks the stage; subscription_required ends it", async () => {
    vi.resetModules();
    const { quotaError } = await import("../src/lib/billing/enforce");
    const spent = quotaStatus({
      plan: "pro",
      calls: [{ at: ago(H), costUsd: 1.2 }],
      now,
    });
    const refusal = providerRefusalOf(quotaError(spent));
    expect(refusal).toEqual({
      code: "quota_exhausted",
      transient: true,
      retryAfterMs: 4 * H,
    });
    expect(refusalDelaySeconds(refusal!)).toBe(4 * 3600);
    const none = providerRefusalOf(
      quotaError(quotaStatus({ plan: null, calls: [], now })),
    );
    expect(none).toMatchObject({
      code: "subscription_required",
      transient: false,
    });
  });

  it("the guarded provider checks the quota before every model call", async () => {
    const { quotaGuardedProvider } = await import("../src/lib/billing/enforce");
    const inner = {
      complete: vi.fn(async () => ({ text: "ok", usage: {} })),
      structured: vi.fn(async () => ({ value: 1, usage: {} })),
      async *stream() {
        yield { type: "delta" as const, text: "hi" };
      },
      modelId: () => "m",
      capabilities: async () => ({}),
      healthCheck: async () => true,
      cancel: async () => undefined,
      normalizeUsage: () => ({}),
      normalizeError: (e: unknown) => e as Error,
    };
    let allowed = true;
    const check = vi.fn(async () =>
      quotaStatus({
        plan: "pro",
        calls: allowed ? [] : [{ at: ago(H), costUsd: 1.2 }],
        now,
      }),
    );
    const guarded = quotaGuardedProvider(
      inner as unknown as ModelProvider,
      "user-1",
      check,
    );
    const input = { requestId: "r", role: "FAST" as const, messages: [] };
    await expect(guarded.complete(input)).resolves.toMatchObject({
      text: "ok",
    });
    const chunks = [];
    for await (const chunk of guarded.stream(input)) chunks.push(chunk);
    expect(chunks).toHaveLength(1);

    allowed = false;
    await expect(guarded.complete(input)).rejects.toMatchObject({
      name: "ProviderError",
      code: "quota_exhausted",
    });
    await expect(
      guarded.structured({ ...input, validate: (v) => v }),
    ).rejects.toMatchObject({ code: "quota_exhausted" });
    await expect(
      (async () => {
        for await (const _ of guarded.stream(input)) void _;
      })(),
    ).rejects.toMatchObject({ code: "quota_exhausted" });
    expect(inner.complete).toHaveBeenCalledTimes(1);
    expect(inner.structured).not.toHaveBeenCalled();
    expect(check).toHaveBeenCalledWith("user-1");
  });
});
