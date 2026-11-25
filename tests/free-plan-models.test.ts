import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ModelProvider, ModelRole } from "../src/lib/models/provider";
import { pickSelection } from "../src/components/agents-chat/use-models";

// Production 2026-11: on the free plan, Code listed a Haiku with the "Free"
// badge (zero-priced at its service), but the run lock only knew ":free"
// and "nvidia:" references, so the run ended with "not in your plan" and
// the page could not start again with any model. Pickers and the lock now
// share one rule, and a refused pick no longer blocks the next start.

const store = vi.hoisted(() => ({
  subscription: null as { plan: string | null; status: string } | null,
  listed: new Map<string, { id: string; free: boolean }>(),
}));

vi.hoisted(() => {
  delete process.env.STRIPE_SECRET_KEY;
  delete process.env.OSIRUS_FREE_TIER_ENABLED;
});

vi.mock("../src/lib/billing/store", () => ({
  currentSubscription: async () => store.subscription,
  usageSince: async () => [],
}));

vi.mock("../src/lib/gateway/models", () => ({
  resolveGatewayModel: async (ref: string) => store.listed.get(ref) ?? null,
}));

beforeEach(() => {
  store.subscription = null;
  store.listed = new Map([
    ["kunya:claude-haiku-5-5", { id: "claude-haiku-5-5", free: true }],
    ["kunya:claude-sonnet-5-5", { id: "claude-sonnet-5-5", free: false }],
  ]);
});

function pinned(ref: string) {
  const complete = vi.fn(async () => ({ text: "ok", usage: {} }));
  const provider = {
    complete,
    structured: vi.fn(async () => ({ value: 1, usage: {} })),
    async *stream() {
      yield { type: "delta" as const, text: "hi" };
    },
    modelId: () => ref,
    capabilities: async () => ({}),
    healthCheck: async () => true,
    cancel: async () => undefined,
    normalizeUsage: () => ({}),
    normalizeError: (e: unknown) => e as Error,
  } as unknown as ModelProvider;
  return { provider, complete };
}

const input = (role: ModelRole) => ({ requestId: "r", role, messages: [] });

describe("the free plan's run lock", () => {
  it("lets a model listed as Free run in every role, the reviewer too", async () => {
    const { quotaGuardedProvider } = await import("../src/lib/billing/enforce");
    const { provider, complete } = pinned("kunya:claude-haiku-5-5");
    const guarded = quotaGuardedProvider(provider, "free-user");
    for (const role of ["STRONG", "FAST", "VERIFY"] as const)
      await expect(guarded.complete(input(role))).resolves.toMatchObject({
        text: "ok",
      });
    expect(complete).toHaveBeenCalledTimes(3);
  });

  it("logs once that a model listed as Free (the Haiku path) was let through", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    store.listed.set("kunya:gpt-6-luna", { id: "gpt-6-luna", free: true });
    const { quotaGuardedProvider } = await import("../src/lib/billing/enforce");
    const { provider } = pinned("kunya:gpt-6-luna");
    const guarded = quotaGuardedProvider(provider, "free-user");
    await guarded.complete(input("STRONG"));
    await guarded.complete(input("VERIFY"));
    const admitted = info.mock.calls.filter((call) =>
      String(call[0]).includes("billing.free_model_admitted"),
    );
    expect(admitted).toEqual([
      [
        JSON.stringify({
          event: "billing.free_model_admitted",
          model: "kunya:gpt-6-luna",
        }),
      ],
    ]);
    info.mockRestore();
  });

  it("lets every kind of Free model run: :free, zero-priced, NVIDIA trial", async () => {
    store.listed.set("openrouter:anthropic/claude-haiku-4.5:free", {
      id: "anthropic/claude-haiku-4.5:free",
      free: true,
    });
    const { quotaGuardedProvider } = await import("../src/lib/billing/enforce");
    for (const ref of [
      "openrouter:anthropic/claude-haiku-4.5:free",
      "kunya:claude-haiku-5-5",
      "nvidia:meta/llama-3.3-70b-instruct",
    ]) {
      const { provider, complete } = pinned(ref);
      await expect(
        quotaGuardedProvider(provider, "free-user").complete(input("VERIFY")),
        ref,
      ).resolves.toMatchObject({ text: "ok" });
      expect(complete, ref).toHaveBeenCalledTimes(1);
    }
  });

  it("still refuses a paid model and an unknown reference", async () => {
    const { quotaGuardedProvider } = await import("../src/lib/billing/enforce");
    for (const ref of ["kunya:claude-sonnet-5-5", "kunya:not-listed"]) {
      const { provider, complete } = pinned(ref);
      const error = await quotaGuardedProvider(provider, "free-user")
        .complete(input("STRONG"))
        .catch((e: unknown) => e);
      expect(error).toMatchObject({ code: "model_not_in_plan", status: 403 });
      expect(complete).not.toHaveBeenCalled();
    }
  });

  it("does not restrict a paid plan", async () => {
    store.subscription = { plan: "pro", status: "active" };
    const { quotaGuardedProvider } = await import("../src/lib/billing/enforce");
    const { provider } = pinned("kunya:claude-sonnet-5-5");
    await expect(
      quotaGuardedProvider(provider, "pro-user").complete(input("STRONG")),
    ).resolves.toMatchObject({ text: "ok" });
  });
});

describe("the remembered model choice", () => {
  const payload = {
    models: [
      { id: "m_a", name: "A" },
      { id: "m_b", name: "B" },
    ],
    defaultId: "m_a",
    freeOnly: true,
  } as Parameters<typeof pickSelection>[0]["payload"];

  it("keeps a listed choice and forgets one the list no longer has", () => {
    expect(pickSelection({ payload, current: null, saved: "m_b" })).toEqual({
      selected: "m_b",
      forgetSaved: false,
    });
    expect(pickSelection({ payload, current: null, saved: "m_gone" })).toEqual({
      selected: "m_a",
      forgetSaved: true,
    });
  });

  it("moves off a model the server just refused", () => {
    expect(
      pickSelection({
        payload,
        current: "m_a",
        saved: "m_a",
        exclude: "m_a",
      }),
    ).toEqual({ selected: "m_b", forgetSaved: true });
  });

  it("chooses nothing when nothing is listed", () => {
    expect(
      pickSelection({
        payload: { ...payload, models: [], defaultId: null },
        current: "m_a",
        saved: null,
      }),
    ).toEqual({ selected: null, forgetSaved: false });
  });
});
