import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildFreeRegistry,
  emptyCandidate,
  estimateTokens,
  FreeModelPool,
  parseCatalog,
  parseModelList,
} from "../src/lib/models/free-registry";
import { CapacityScheduler } from "../src/lib/models/capacity";
import {
  describeFailureReport,
  failureMetadata,
  FailureReportBuilder,
} from "../src/lib/models/failure-report";
import { providerRefusalOf } from "../src/lib/models/provider";
import { failureMessage } from "../src/lib/ui/labels";
import { assessReadiness, EvidenceCache } from "../src/lib/readiness/assess";

// M49: free-model-first runtime policy, pacing and cooldowns, the key
// non-evasion rules, honest fallback error reporting, the capacity priority
// scheduler and readiness. No real network: fetch is stubbed per test.

const endpoint = "https://api.unorouter.example/v1/chat/completions";
const modelsUrl = "https://api.unorouter.example/v1/models";
const KEYS = ["test-key-one", "test-key-two", "test-key-three"];

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const ok = (content = "ok") =>
  new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
    status: 200,
  });

type Call = { url: string; model?: string; auth?: string };

async function setup(
  env: Record<string, string> = {},
  pool: string[] = ["free-a:free", "free-b:free", "free-c:free"],
) {
  vi.resetModules();
  vi.stubEnv("UNOROUTER_BASE_URL", endpoint);
  KEYS.forEach((key, i) => vi.stubEnv(`UNOROUTER_API_KEY_${i + 1}`, key));
  for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);
  const providerModule = await import("../src/lib/models/unorouter");
  const runtimeModule = await import("../src/lib/models/model-runtime");
  const registry = await import("../src/lib/models/free-registry");
  const runtime = new runtimeModule.ModelRuntime({ minIntervalMs: 0 });
  runtime.pool.replace(pool.map((id) => registry.emptyCandidate(id)));
  const calls: Call[] = [];
  const route = (handler: (call: Call) => Response | Promise<Response>) =>
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit = {}) => {
        const headers = (init.headers ?? {}) as Record<string, string>;
        const call: Call = {
          url,
          auth: headers.Authorization,
          model: init.body
            ? (JSON.parse(init.body as string).model as string)
            : undefined,
        };
        calls.push(call);
        return handler(call);
      }),
    );
  const provider = (
    options: ConstructorParameters<
      typeof providerModule.UnoRouterProvider
    >[0] = {},
  ) =>
    new providerModule.UnoRouterProvider({
      runtime,
      discover: false,
      ...options,
    });
  return { provider, runtime, calls, route, providerModule, runtimeModule };
}

const complete = (
  provider: { complete: (input: never) => Promise<unknown> },
  requestId = "r",
) =>
  (
    provider as unknown as {
      complete: (input: object) => Promise<{ text: string }>;
    }
  ).complete({
    requestId,
    role: "STRONG",
    messages: [{ role: "user", content: "Hallo" }],
  });

describe("FreeModelRegistry discovery", () => {
  const listing = {
    data: [
      { id: "free-a:free", context_length: 128000 },
      { id: "paid-model" },
      { id: "embed-small:free" },
      { id: "free-b:free" },
      { id: "free-a:free" },
    ],
  };

  it("only lists IDs /v1/models returned, free and chat-capable", () => {
    const models = parseModelList(listing);
    expect(models.map((m) => m.id)).toEqual([
      "free-a:free",
      "paid-model",
      "embed-small:free",
      "free-b:free",
    ]);
    const registry = buildFreeRegistry({
      listedByKey: [{ label: "KEY_1", models }],
    });
    expect(registry.map((c) => c.id).sort()).toEqual([
      "free-a:free",
      "free-b:free",
    ]);
    const a = registry.find((c) => c.id === "free-a:free")!;
    expect(a).toMatchObject({
      availableToKeys: ["KEY_1"],
      free: true,
      contextLength: 128000,
      lastHealth: "unknown",
      cooldownUntil: null,
    });
  });

  it("uses the public catalog to annotate but never to add a model", () => {
    const catalog = parseCatalog({
      data: [
        {
          model_name: "free-b:free",
          is_free: true,
          online: true,
          supported_endpoint_types: ["openai"],
          tags: "Text,Tools",
          metadata: JSON.stringify({
            contextWindow: 262144,
            maxOutputTokens: 32768,
            supportsTools: true,
          }),
        },
        // Listed in the catalog but not for the key: must not appear.
        { model_name: "catalog-only:free", is_free: true, metadata: "{}" },
        {
          model_name: "free-a:free",
          is_free: true,
          online: true,
          tags: "Text,Deprecated",
          metadata: "{}",
        },
      ],
    });
    const registry = buildFreeRegistry({
      listedByKey: [{ label: "KEY_1", models: parseModelList(listing) }],
      catalog,
    });
    expect(registry.map((c) => c.id)).toEqual(["free-b:free"]);
    expect(registry[0]).toMatchObject({
      freeEvidence: "catalog",
      contextLength: 262144,
      maxOutputTokens: 32768,
      supportsTools: true,
    });
  });

  it("is bounded and puts preferred and known models first", () => {
    const models = Array.from({ length: 20 }, (_, i) => ({
      id: `m${i}:free`,
      contextLength: null,
      maxOutputTokens: null,
    }));
    const registry = buildFreeRegistry({
      listedByKey: [{ label: "KEY_1", models }],
      preferred: ["m7:free", "not-listed:free"],
      known: ["m3:free"],
      maxPoolSize: 4,
    });
    expect(registry).toHaveLength(4);
    expect(registry.map((c) => c.id).slice(0, 2)).toEqual([
      "m7:free",
      "m3:free",
    ]);
    expect(registry.map((c) => c.id)).not.toContain("not-listed:free");
  });
});

describe("FreeModelPool selection, pacing and cooldown", () => {
  const pool = (options = {}) =>
    new FreeModelPool(
      [
        emptyCandidate("a:free", { contextLength: 32000 }),
        emptyCandidate("b:free", { contextLength: 256000 }),
        emptyCandidate("c:free", { contextLength: null }),
      ],
      { minIntervalMs: 0, ...options },
    );

  it("honours Retry-After as the model's cooldown (per model, not per key)", () => {
    const p = pool();
    const now = 1_000_000;
    const until = p.recordFailure("a:free", "rate_limited", now, 7_000);
    expect(until).toBe(now + 7_000);
    const selected = p.select({ now: now + 1 });
    expect(selected.kind === "ready" && selected.candidate.id).not.toBe(
      "a:free",
    );
    // After the Retry-After window the model is eligible again.
    const later = p.select({ now: now + 7_001, exclude: ["b:free", "c:free"] });
    expect(later).toMatchObject({ kind: "ready", candidate: { id: "a:free" } });
  });

  it("backs off exponentially on repeated bare 429s", () => {
    const p = pool({ rateLimitBaseMs: 1_000, rateLimitMaxMs: 60_000 });
    expect(p.recordFailure("a:free", "rate_limited", 0)).toBe(1_000);
    expect(p.recordFailure("a:free", "rate_limited", 0)).toBe(2_000);
    expect(p.recordFailure("a:free", "rate_limited", 0)).toBe(4_000);
    p.recordSuccess("a:free", 10_000);
    expect(p.recordFailure("a:free", "rate_limited", 10_000)).toBe(11_000);
  });

  it("returns the soonest opening when every model is cooling down", () => {
    const p = pool();
    p.recordFailure("a:free", "rate_limited", 0, 5_000);
    p.recordFailure("b:free", "rate_limited", 0, 3_000);
    p.recordFailure("c:free", "provider_unavailable", 0);
    const selection = p.select({ now: 1_000 });
    expect(selection).toMatchObject({
      kind: "wait",
      candidate: { id: "b:free" },
      waitMs: 2_000,
    });
  });

  it("paces: repeated requests spread across models instead of hammering one", () => {
    const p = pool({ minIntervalMs: 2_000 });
    const picked: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      const s = p.select({ now: 100 + i });
      if (s.kind !== "ready") throw new Error("expected a ready model");
      picked.push(s.candidate.id);
      p.markUsed(s.candidate.id, 100 + i);
    }
    expect(new Set(picked).size).toBe(3);
    // A fourth immediate request waits for the pacing interval.
    expect(p.select({ now: 103 }).kind).toBe("wait");
  });

  it("prefers healthy models and skips ones that are failing", () => {
    const p = pool();
    p.recordSuccess("b:free", 0, 400);
    p.recordFailure("a:free", "provider_unavailable", 0);
    const s = p.select({ now: 60_000 });
    expect(s).toMatchObject({ kind: "ready", candidate: { id: "b:free" } });
  });

  it("is context-aware", () => {
    const p = pool();
    const s = p.select({ now: 0, minContextTokens: 100_000 });
    // a (32k) cannot hold it; b (256k) is a known fit and wins over unknown c.
    expect(s).toMatchObject({ kind: "ready", candidate: { id: "b:free" } });
    expect(
      p.select({ now: 0, minContextTokens: 10_000_000, exclude: ["c:free"] }),
    ).toEqual({ kind: "none", reason: "context" });
    expect(
      estimateTokens([{ role: "user", content: "x".repeat(4000) }], 0),
    ).toBe(1000);
  });

  it("does not punish a model for a credential failure", () => {
    const p = pool();
    expect(p.recordFailure("a:free", "credential_rejected", 0)).toBeNull();
    expect(p.select({ now: 1, exclude: ["b:free", "c:free"] })).toMatchObject({
      kind: "ready",
    });
  });
});

describe("free-model-first provider policy", () => {
  it("ignores a stale paid default (grok-4.6) and answers on a verified free model", async () => {
    const { provider, calls, route } = await setup({
      OSIRUS_MODEL_STRONG: "grok-4.6",
    });
    route(() => ok("Hallo!"));
    await expect(complete(provider())).resolves.toMatchObject({
      text: "Hallo!",
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].model).toBe("free-a:free");
  });

  it("exposes PRIMARY_FREE / SECONDARY_FREE / TERTIARY_FREE from the verified pool", async () => {
    const { runtime } = await setup();
    expect(runtime.tiers()).toEqual({
      PRIMARY_FREE: "free-a:free",
      SECONDARY_FREE: "free-b:free",
      TERTIARY_FREE: "free-c:free",
    });
  });

  it("discovers the pool from /v1/models and never invents an ID", async () => {
    const { provider, runtime, calls, route } = await setup({}, []);
    route((call) =>
      call.url === modelsUrl
        ? new Response(
            JSON.stringify({
              data: [{ id: "gpt-paid" }, { id: "listed-free:free" }],
            }),
            { status: 200 },
          )
        : ok(),
    );
    await complete(provider({ discover: true }));
    expect(runtime.pool.ids()).toEqual(["listed-free:free"]);
    expect(runtime.discovery).toMatchObject({
      source: "discovered",
      keyStatus: { KEY_1: 200 },
    });
    expect(calls.at(-1)?.model).toBe("listed-free:free");
  });

  it("WAITS on a free-model 429 and retries the same model on the same key", async () => {
    const { provider, calls, route } = await setup();
    let first = true;
    route(() => {
      if (first) {
        first = false;
        return new Response(
          '{"error":{"message":"Too many requests. retry in 0.05s"}}',
          { status: 429 },
        );
      }
      return ok();
    });
    await complete(provider());
    expect(calls.map((c) => c.model)).toEqual(["free-a:free", "free-a:free"]);
    expect(calls.map((c) => c.auth)).toEqual([
      "Bearer test-key-one",
      "Bearer test-key-one",
    ]);
  });

  it("tries another verified free model when one is temporarily unavailable", async () => {
    const { provider, calls, route } = await setup({}, [
      "free-a:free",
      "free-b:free",
    ]);
    route((call) =>
      call.model === "free-a:free"
        ? new Response("upstream down", { status: 503 })
        : ok(),
    );
    await complete(provider());
    // 5xx: keys fail over on model A (provider failure), then model B.
    expect(calls.filter((c) => c.model === "free-a:free")).toHaveLength(3);
    expect(calls.at(-1)?.model).toBe("free-b:free");
  });

  it("surfaces a rate limit with the soonest retry when every free model is cooling down", async () => {
    const { provider, runtime, calls, route } = await setup();
    const now = Date.now();
    for (const id of runtime.pool.ids())
      runtime.pool.recordFailure(id, "rate_limited", now, 120_000);
    route(() => ok());
    await expect(
      complete(provider({ maxRateLimitWaitSeconds: 1 })),
    ).rejects.toMatchObject({ code: "rate_limited" });
    expect(calls).toHaveLength(0);
  });
});

describe("key non-evasion rules (audited)", () => {
  it("never rotates keys on a 429", async () => {
    const { provider, calls, route } = await setup({}, ["only:free"]);
    route(() => new Response("slow down", { status: 429 }));
    await expect(
      complete(provider({ maxRateLimitWaitSeconds: 0 })),
    ).rejects.toMatchObject({ code: "rate_limited" });
    expect(new Set(calls.map((c) => c.auth))).toEqual(
      new Set(["Bearer test-key-one"]),
    );
  });

  it("never tries keys 2/3 for exhausted credit or quota", async () => {
    const { provider, calls, route } = await setup({}, ["only:free"]);
    route(() => new Response("insufficient credit", { status: 402 }));
    await expect(complete(provider())).rejects.toMatchObject({
      code: "insufficient_credit",
    });
    expect(calls.every((c) => c.auth === "Bearer test-key-one")).toBe(true);
  });

  it("fails over to the next key on a rejected credential and remembers it", async () => {
    const { provider, calls, route } = await setup({}, ["only:free"]);
    route((call) =>
      call.auth === "Bearer test-key-one"
        ? new Response("revoked", { status: 401 })
        : ok(),
    );
    await complete(provider(), "first");
    expect(calls.map((c) => c.auth)).toEqual([
      "Bearer test-key-one",
      "Bearer test-key-two",
    ]);
    calls.length = 0;
    await complete(provider(), "second");
    // The revoked key is tried last now, so the next request goes to key 2.
    expect(calls.map((c) => c.auth)).toEqual(["Bearer test-key-two"]);
  });

  it("fails over to the next key on a provider 5xx", async () => {
    const { provider, calls, route } = await setup({}, ["only:free"]);
    route((call) =>
      call.auth === "Bearer test-key-one"
        ? new Response("bad gateway", { status: 502 })
        : ok(),
    );
    await complete(provider());
    expect(calls.map((c) => c.auth)).toEqual([
      "Bearer test-key-one",
      "Bearer test-key-two",
    ]);
  });

  it("states the rule in one predicate", async () => {
    const { providerModule } = await setup();
    const { keyFailoverAllowed, ProviderError } = providerModule;
    const allowed = (code: string) =>
      keyFailoverAllowed(new ProviderError("x", code));
    expect(allowed("credential_rejected")).toBe(true);
    expect(allowed("provider_unavailable")).toBe(true);
    expect(allowed("timeout")).toBe(true);
    expect(allowed("rate_limited")).toBe(false);
    expect(allowed("insufficient_credit")).toBe(false);
    expect(allowed("model_not_configured")).toBe(false);
  });
});

describe("honest fallback error reporting", () => {
  it("primary insufficient_credit then fallback 429 surfaces the fallback failure", async () => {
    const { provider, route } = await setup(
      {
        OSIRUS_MODEL_STRONG: "grok-4.6",
        OSIRUS_MODEL_POLICY: "configured-first",
      },
      ["deepseek-v4-pro-0813:free"],
    );
    route((call) =>
      call.model === "grok-4.6"
        ? new Response("insufficient credit", { status: 402 })
        : new Response("rate limited", { status: 429 }),
    );
    const error = await complete(provider({ maxRateLimitWaitSeconds: 0 })).then(
      () => null,
      (e: unknown) => e as { code: string; report: unknown },
    );
    expect(error?.code).toBe("rate_limited");
    expect(error?.report).toMatchObject({
      primaryModel: "grok-4.6",
      primaryFailure: "insufficient_credit",
      fallbackModel: "deepseek-v4-pro-0813:free",
      fallbackFailure: "rate_limited",
      finalFailure: "rate_limited",
    });
    expect(describeFailureReport(error!.report as never)).toBe(
      "Primary grok-4.6: insufficient_credit / Fallback deepseek-v4-pro-0813:free: rate_limited",
    );
    // What a person sees is the failure that stopped the answer.
    expect(
      failureMessage(
        `provider_${error!.code}`,
        describeFailureReport(error!.report as never),
      ),
    ).toContain("limiting requests");
    // Operator metadata carries both failures and no credential.
    const metadata = JSON.stringify(failureMetadata(error));
    expect(metadata).toContain("insufficient_credit");
    expect(metadata).toContain("rate_limited");
    expect(metadata).not.toMatch(/test-key|Bearer|Authorization/);
  });

  it("primary insufficient_credit then fallback 503 surfaces the outage", async () => {
    const { provider, route } = await setup(
      {
        OSIRUS_MODEL_STRONG: "grok-4.6",
        OSIRUS_MODEL_POLICY: "configured-first",
      },
      ["deepseek-v4-pro-0813:free"],
    );
    route((call) =>
      call.model === "grok-4.6"
        ? new Response("insufficient credit", { status: 402 })
        : new Response("down", { status: 503 }),
    );
    await expect(complete(provider())).rejects.toMatchObject({
      code: "provider_unavailable",
      report: {
        primaryFailure: "insufficient_credit",
        fallbackFailure: "provider_unavailable",
        finalFailure: "provider_unavailable",
      },
    });
  });

  it("keeps each attempt separately in the builder", () => {
    const builder = new FailureReportBuilder();
    builder.record("p", { code: "insufficient_credit", status: 402 });
    builder.record("f1:free", { code: "provider_unavailable", status: 503 });
    builder.record("f2:free", {
      code: "rate_limited",
      status: 429,
      retryAfterMs: 5000,
    });
    expect(builder.build("rate_limited")).toMatchObject({
      primaryModel: "p",
      primaryFailure: "insufficient_credit",
      fallbackModel: "f2:free",
      fallbackFailure: "rate_limited",
      finalFailure: "rate_limited",
      attempts: [
        { model: "p", kind: "primary" },
        { model: "f1:free", kind: "fallback" },
        { model: "f2:free", kind: "fallback", retryAfterMs: 5000 },
      ],
    });
  });
});

describe("capacity priority scheduler (protect user chat from RSI)", () => {
  const calm = {
    poolSize: 3,
    coolingDown: 0,
    ready: 3,
    msSinceRateLimit: null,
  };

  it("admits everything when capacity is plentiful and no user is waiting", () => {
    const s = new CapacityScheduler();
    for (const p of ["P0", "P1", "P2", "P3", "P4"] as const)
      expect(s.admit(p, calm).admitted).toBe(true);
  });

  it("pauses P3/P4 first when free capacity is scarce", () => {
    const s = new CapacityScheduler();
    const scarce = {
      ...calm,
      coolingDown: 1,
      ready: 2,
      msSinceRateLimit: 5_000,
    };
    expect(s.admit("P0", scarce).admitted).toBe(true);
    expect(s.admit("P1", scarce).admitted).toBe(true);
    expect(s.admit("P2", scarce).admitted).toBe(true);
    expect(s.admit("P3", scarce)).toMatchObject({ admitted: false });
    expect(s.admit("P4", scarce)).toMatchObject({ admitted: false });
  });

  it("keeps P3/P4 off model capacity while a user request is in flight", () => {
    const s = new CapacityScheduler();
    const release = s.begin("P0");
    expect(s.admit("P4", calm)).toMatchObject({ admitted: false });
    expect(s.admit("P2", calm).admitted).toBe(true);
    // P2 yields only when nothing can serve and a user is waiting.
    expect(s.admit("P2", { ...calm, ready: 0, coolingDown: 3 }).admitted).toBe(
      false,
    );
    release();
    release(); // idempotent
    expect(s.inFlightCount("P0")).toBe(0);
    expect(s.admit("P4", calm).admitted).toBe(true);
  });

  it("discovers the pool before admitting P3/P4 on a fresh instance", async () => {
    // A cold serverless instance has an empty pool, which reads as scarce:
    // without discovery first, the pulse and RSI would be deferred forever.
    const { providerModule, runtimeModule, route } = await setup();
    const cold = new runtimeModule.ModelRuntime({ minIntervalMs: 0 });
    route((call) =>
      call.url.endsWith("/models")
        ? new Response(
            JSON.stringify({ data: [{ id: "glm-4.7-flash:free" }] }),
            { status: 200 },
          )
        : ok(),
    );
    const rsi = new providerModule.UnoRouterProvider({
      runtime: cold,
      priority: "P4",
    });
    expect((await rsi.admission()).admitted).toBe(true);
    expect(cold.pool.ids()).toEqual(["glm-4.7-flash:free"]);
  });

  it("defers an RSI request without spending a model call, as a transient refusal", async () => {
    const { provider, runtime, calls, route } = await setup();
    route(() => ok());
    runtime.noteRateLimit(Date.now());
    const error = await complete(provider({ priority: "P4" })).then(
      () => null,
      (e: unknown) => e,
    );
    expect(error).toMatchObject({ code: "capacity_deferred" });
    expect(providerRefusalOf(error)).toMatchObject({ transient: true });
    expect(calls).toHaveLength(0);
    // The same moment, a user's chat is still served.
    await expect(complete(provider({ priority: "P0" }))).resolves.toBeTruthy();
  });
});

describe("readiness", () => {
  const base = {
    collectedAt: 1_000_000,
    database: { ok: true },
    auth: {
      configured: true,
      jwksStatus: 200 as const,
      lastAuthenticatedActivityAt: null,
    },
    model: {
      providerConfigured: true,
      poolSource: "discovered" as const,
      poolSize: 3,
      tiers: {
        PRIMARY_FREE: "a:free",
        SECONDARY_FREE: "b:free",
        TERTIARY_FREE: null,
      },
      coolingDown: 0,
      keyStatus: { KEY_1: 200 },
      lastFreeSuccess: { model: "a:free", at: 999_000 },
      lastAnySuccess: { model: "a:free", at: 999_000 },
    },
    sandbox: { configured: false, driver: "NOT_CONFIGURED", reason: null },
    runtime: { schedulerSecret: true, connectorKey: true },
  };

  it("is ready only with a recent successful free-model inference", () => {
    expect(assessReadiness(base, 1_000_000).ready).toBe(true);
    const none = assessReadiness(
      { ...base, model: { ...base.model, lastFreeSuccess: null } },
      1_000_000,
    );
    expect(none.ready).toBe(false);
    expect(none.checks.model.detail).toMatch(/no successful free-model/);
    const stale = assessReadiness(base, 999_000 + 7 * 60 * 60_000);
    expect(stale.ready).toBe(false);
    expect(assessReadiness(base, 1_000_000).model.lastFreeSuccessAt).toBe(
      new Date(999_000).toISOString(),
    );
  });

  it("serves cached evidence and refreshes stale evidence in the background", async () => {
    const cache = new EvidenceCache<number>(1_000);
    let n = 0;
    const collect = async () => ++n;
    expect(await cache.get(collect, Date.now())).toBe(1);
    expect(await cache.get(collect, Date.now())).toBe(1);
    const scheduled: Array<Promise<unknown>> = [];
    expect(
      await cache.get(collect, Date.now() + 5_000, (t) => scheduled.push(t)),
    ).toBe(1);
    await Promise.all(scheduled);
    expect(await cache.get(collect, Date.now())).toBe(2);
  });
});

describe("the runtime pool without the catalog", () => {
  it("keeps image and embedding models out and puts chat families first", () => {
    const registry = buildFreeRegistry({
      listedByKey: [
        {
          label: "KEY_1",
          models: parseModelList({
            data: [
              "absolutereality:free",
              "anything-v5:free",
              "dreamshaper:free",
              "gemini-embedding-001:free",
              "diffusiongemma-26b-a4b-it:free",
              "lorellm:free",
              "glm-4.7-flash:free",
              "gpt-4o:free",
            ].map((id) => ({ id })),
          }),
        },
      ],
      catalog: null,
    });
    expect(registry.map((candidate) => candidate.id)).toEqual([
      "glm-4.7-flash:free",
      "gpt-4o:free",
      "lorellm:free",
    ]);
  });
});
