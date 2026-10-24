import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ModelProvider, ModelRole } from "../src/lib/models/provider";
import { providerRefusalOf } from "../src/lib/models/provider";
import {
  BILLING_CONFIG,
  FREE_TIER_AMOUNTS_CONFIRMED,
  freeTierEnabled,
  isFreeTierEnabled,
} from "../src/lib/billing/config";
import {
  effectivePlan,
  quotaStatus,
  serializeQuota,
  type UsageCall,
} from "../src/lib/billing/quota";

// Free tier: on by default, kill switch OSIRUS_FREE_TIER_ENABLED=false,
// enforced (budgets + model lock) even without STRIPE_SECRET_KEY.

const H = 60 * 60 * 1000;
const now = new Date("2026-10-24T12:00:00Z");
const ago = (ms: number) => new Date(now.getTime() - ms);

const store = vi.hoisted(() => ({
  subscription: null as { plan: string | null; status: string } | null,
  calls: [] as { at: Date; costUsd: number | null }[],
}));

vi.hoisted(() => {
  delete process.env.STRIPE_SECRET_KEY;
});

vi.mock("../src/lib/billing/store", () => ({
  currentSubscription: async () => store.subscription,
  usageSince: async () => store.calls,
}));

const savedEnv = process.env.OSIRUS_FREE_TIER_ENABLED;
beforeEach(() => {
  delete process.env.OSIRUS_FREE_TIER_ENABLED;
  store.subscription = null;
  store.calls = [];
});
afterEach(() => {
  if (savedEnv === undefined) delete process.env.OSIRUS_FREE_TIER_ENABLED;
  else process.env.OSIRUS_FREE_TIER_ENABLED = savedEnv;
});

function fakeProvider(models: Partial<Record<ModelRole, string>>) {
  const complete = vi.fn(async () => ({ text: "ok", usage: {} }));
  const provider = {
    complete,
    structured: vi.fn(async () => ({ value: 1, usage: {} })),
    async *stream() {
      yield { type: "delta" as const, text: "hi" };
    },
    modelId: (role: ModelRole) => models[role] ?? "glm-5.3-flash",
    capabilities: async () => ({}),
    healthCheck: async () => true,
    cancel: async () => undefined,
    normalizeUsage: () => ({}),
    normalizeError: (e: unknown) => e as Error,
  } as unknown as ModelProvider;
  return { provider, complete };
}

const input = (role: ModelRole) => ({
  requestId: "r",
  role,
  messages: [],
});

describe("free tier config", () => {
  it("is on by default with placeholder budgets and the model lock", () => {
    expect(BILLING_CONFIG.freePlanEnabled).toBe(true);
    expect(FREE_TIER_AMOUNTS_CONFIRMED).toBe(false);
    expect(BILLING_CONFIG.plans.free.weeklyBudgetUsd).toBe(0.25);
    expect(BILLING_CONFIG.plans.free.fiveHourBudgetUsd).toBe(0.05);
    expect(BILLING_CONFIG.plans.free.priceEnv).toBeNull();
    expect(BILLING_CONFIG.freePlanLimits).toEqual({
      allowedModels: ["glm-5.3-flash"],
      maxSubAgents: 2,
      reviewerModel: "gpt-6.1-sol",
    });
  });

  it("only OSIRUS_FREE_TIER_ENABLED=false (exactly) switches it off", () => {
    expect(isFreeTierEnabled()).toBe(true);
    for (const value of [undefined, "", "true", "0", "no", "False", " false"])
      expect(freeTierEnabled(BILLING_CONFIG, value)).toBe(true);
    expect(freeTierEnabled(BILLING_CONFIG, "false")).toBe(false);
    process.env.OSIRUS_FREE_TIER_ENABLED = "false";
    expect(isFreeTierEnabled()).toBe(false);
    expect(effectivePlan(null)).toBeNull();
    process.env.OSIRUS_FREE_TIER_ENABLED = "FALSE";
    expect(isFreeTierEnabled()).toBe(true);
    expect(effectivePlan(null)).toBe("free");
  });

  it("an entitled paid subscription always wins over free", () => {
    expect(effectivePlan({ plan: "pro", status: "active" })).toBe("pro");
    expect(effectivePlan({ plan: "ultra_200", status: "trialing" })).toBe(
      "ultra_200",
    );
    // A "free" row in the subscriptions table is never trusted as a plan.
    expect(effectivePlan({ plan: "free", status: "active" })).toBe("free");
    expect(effectivePlan({ plan: "pro", status: "canceled" })).toBe("free");
  });

  it("applies the free budgets with the same rolling windows", () => {
    const calls: UsageCall[] = [{ at: ago(H), costUsd: 0.03 }];
    const ok = quotaStatus({ plan: "free", calls, now });
    expect(ok.allowed).toBe(true);
    expect(ok.windows.map((w) => [w.budgetUsd, w.remainingUsd])).toEqual([
      [0.05, 0.02],
      [0.25, 0.22],
    ]);
    // The same spend leaves Pro untouched.
    expect(quotaStatus({ plan: "pro", calls, now }).upgradeAvailable).toBe(
      false,
    );
  });

  it("an exhausted free window says when it refills and offers upgrading", () => {
    const calls: UsageCall[] = [
      { at: ago(4 * H), costUsd: 0.03 },
      { at: ago(2 * H), costUsd: 0.03 },
    ];
    const status = quotaStatus({ plan: "free", calls, now });
    expect(status.reason).toBe("quota_exhausted");
    // Dropping the 4h-old call leaves 0.03 < 0.05: available in 1 hour.
    expect(status.retryAfterMs).toBe(1 * H);
    expect(status.upgradeAvailable).toBe(true);
    const body = serializeQuota(status);
    expect(body).toMatchObject({
      plan: "free",
      reason: "quota_exhausted",
      retryAfterSeconds: 3600,
      upgradeAvailable: true,
    });
    // Without Stripe there is nothing to upgrade to.
    expect(
      quotaStatus({ plan: "free", calls, now, upgradable: false })
        .upgradeAvailable,
    ).toBe(false);
  });
});

describe("free tier enforcement without STRIPE_SECRET_KEY", () => {
  it("quotas are enforced even though Stripe is not configured", async () => {
    const { quotaEnforced, upgradesAvailable, forUser } =
      await import("../src/lib/billing/enforce");
    expect(quotaEnforced()).toBe(true);
    expect(upgradesAvailable()).toBe(false);
    const { provider } = fakeProvider({});
    expect(forUser(provider, "u")).not.toBe(provider);
  });

  it("free budget applies and an exhausted window throws quota_exhausted", async () => {
    const { quotaStatusFor, quotaGuardedProvider, QuotaError } =
      await import("../src/lib/billing/enforce");
    store.calls = [{ at: ago(H), costUsd: 0.01 }];
    const status = await quotaStatusFor("u", now);
    expect(status).toMatchObject({ plan: "free", allowed: true });
    expect(status.upgradeAvailable).toBe(false);

    store.calls = [{ at: ago(2 * H), costUsd: 0.06 }];
    const check = (userId: string) => quotaStatusFor(userId, now);
    const { provider, complete } = fakeProvider({});
    const guarded = quotaGuardedProvider(provider, "u", check);
    const error = await guarded.complete(input("FAST")).catch((e) => e);
    expect(error).toBeInstanceOf(QuotaError);
    expect(error).toMatchObject({
      name: "ProviderError",
      code: "quota_exhausted",
      status: 429,
      retryAfterMs: 3 * H,
      plan: "free",
      upgradeAvailable: false,
    });
    expect(providerRefusalOf(error)).toEqual({
      code: "quota_exhausted",
      transient: true,
      retryAfterMs: 3 * H,
    });
    expect(complete).not.toHaveBeenCalled();
  });

  it("kill switch off without Stripe: no plan, subscription_required", async () => {
    const { quotaStatusFor, quotaError } =
      await import("../src/lib/billing/enforce");
    process.env.OSIRUS_FREE_TIER_ENABLED = "false";
    const status = await quotaStatusFor("u", now);
    expect(status.reason).toBe("no_subscription");
    expect(quotaError(status)).toMatchObject({
      code: "subscription_required",
      status: 402,
      upgradeAvailable: false,
    });
  });

  it("locks free users to the free models (403), paid users unaffected", async () => {
    const { quotaStatusFor, quotaGuardedProvider } =
      await import("../src/lib/billing/enforce");
    const check = (userId: string) => quotaStatusFor(userId, now);
    const ok = fakeProvider({ FAST: "glm-5.3-flash", VERIFY: "gpt-6.1-sol" });
    const guardedOk = quotaGuardedProvider(ok.provider, "u", check);
    await expect(guardedOk.complete(input("FAST"))).resolves.toMatchObject({
      text: "ok",
    });
    await expect(guardedOk.complete(input("VERIFY"))).resolves.toMatchObject({
      text: "ok",
    });

    const bad = fakeProvider({
      STRONG: "gpt-6.1-max",
      VERIFY: "glm-5.3-flash",
    });
    const guardedBad = quotaGuardedProvider(bad.provider, "u", check);
    for (const role of ["STRONG", "VERIFY"] as const) {
      const error = await guardedBad.complete(input(role)).catch((e) => e);
      expect(error).toMatchObject({
        name: "ProviderError",
        code: "model_not_in_plan",
        status: 403,
      });
      expect(providerRefusalOf(error)).toMatchObject({
        code: "model_not_in_plan",
        transient: false,
      });
    }
    await expect(
      (async () => {
        for await (const _ of guardedBad.stream(input("STRONG"))) void _;
      })(),
    ).rejects.toMatchObject({ code: "model_not_in_plan" });
    expect(bad.complete).not.toHaveBeenCalled();

    store.subscription = { plan: "pro", status: "active" };
    await expect(guardedBad.complete(input("STRONG"))).resolves.toMatchObject({
      text: "ok",
    });
  });
});

describe("assertFreePlanAllowed", () => {
  it("checks main model, reviewer model and sub-agent count", async () => {
    const { assertFreePlanAllowed } =
      await import("../src/lib/billing/enforce");
    expect(() =>
      assertFreePlanAllowed({
        model: "glm-5.3-flash",
        subAgents: 2,
        reviewerModel: "gpt-6.1-sol",
      }),
    ).not.toThrow();
    expect(() => assertFreePlanAllowed({})).not.toThrow();
    expect(() => assertFreePlanAllowed({ subAgents: 0 })).not.toThrow();
    expect(() => assertFreePlanAllowed({ model: "gpt-6.1-max" })).toThrow(
      expect.objectContaining({ code: "model_not_in_plan", status: 403 }),
    );
    expect(() =>
      assertFreePlanAllowed({ reviewerModel: "glm-5.3-flash" }),
    ).toThrow(expect.objectContaining({ code: "model_not_in_plan" }));
    expect(() => assertFreePlanAllowed({ subAgents: 3 })).toThrow(
      expect.objectContaining({ code: "subagent_limit", status: 403 }),
    );
    expect(() => assertFreePlanAllowed({ subAgents: Number.NaN })).toThrow(
      expect.objectContaining({ code: "subagent_limit" }),
    );
    // Empty allowlist means no main-model restriction.
    expect(() =>
      assertFreePlanAllowed(
        { model: "anything" },
        { ...BILLING_CONFIG.freePlanLimits, allowedModels: [] },
      ),
    ).not.toThrow();
  });
});
