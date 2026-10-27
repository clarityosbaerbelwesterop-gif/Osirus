import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { classifyFailure } from "@/lib/models/unorouter";
import { tierOf } from "@/lib/gateway/routing";
import { extractJsonObject } from "@/lib/gateway/json";
import {
  familyRank,
  isChatModelId,
  listGatewayModels,
  parseProviderModels,
  pickDefaultModel,
  prettyModelName,
  resetGatewayModelCache,
  resolveGatewayModel,
} from "@/lib/gateway/models";
import {
  chatCompletionsUrl,
  configuredProviders,
  modelsUrlFor,
  parseModelRef,
} from "@/lib/gateway/providers";
import { GatewayProvider } from "@/lib/gateway/provider";
import {
  ThinkSplitter,
  completeGateway,
  normalizeGatewayUsage,
  streamGateway,
} from "@/lib/gateway/stream";
import {
  answerCacheKey,
  cachedAnswer,
  resetAnswerCache,
  storeAnswer,
} from "@/lib/gateway/cache";
import { collapseRegenerations } from "@/lib/gateway/threads";
import { callCostUsd } from "@/lib/gateway/usage";

const KEYS = [
  "OPENROUTER_API_KEY",
  "NVIDIA_API_KEY",
  "UNOROUTER_API_KEY",
  "BYTEZ_API_KEY",
  "KUNYA_API_KEY",
  "BAI_API_KEY",
  "AIHUBMIX_API_KEY",
  "SHORTAPI_API_KEY",
  "OSIRUS_SERVED_MODELS",
];
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of KEYS) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
  resetGatewayModelCache();
  resetAnswerCache();
});

afterEach(() => {
  for (const key of KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

function sse(frames: unknown[], done = true) {
  const text =
    frames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join("") +
    (done ? "data: [DONE]\n\n" : "");
  return new Response(text, {
    headers: { "content-type": "text/event-stream" },
  });
}

type Call = {
  url: string;
  auth: string | null;
  body: Record<string, unknown> | null;
};

function fakeFetch(
  handler: (call: Call, index: number) => Response | Promise<Response>,
) {
  const calls: Call[] = [];
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    const call: Call = {
      url: String(input),
      auth: headers.get("authorization"),
      body: init?.body ? JSON.parse(String(init.body)) : null,
    };
    calls.push(call);
    return handler(call, calls.length - 1);
  }) as typeof fetch;
  return { impl, calls };
}

describe("providers", () => {
  it("normalizes base URLs to chat completions and models", () => {
    expect(chatCompletionsUrl("https://api.x.com/v1")).toBe(
      "https://api.x.com/v1/chat/completions",
    );
    expect(chatCompletionsUrl("https://api.x.com/v1/chat/completions/")).toBe(
      "https://api.x.com/v1/chat/completions",
    );
    expect(chatCompletionsUrl("ftp://x")).toBeNull();
    expect(modelsUrlFor("https://api.x.com/v1/chat/completions")).toBe(
      "https://api.x.com/v1/models",
    );
  });

  it("offers only providers with a key", () => {
    expect(configuredProviders().map((p) => p.id)).not.toContain("openrouter");
    process.env.OPENROUTER_API_KEY = "or-key";
    const ids = configuredProviders().map((p) => p.id);
    expect(ids).toContain("openrouter");
    expect(
      configuredProviders().find((p) => p.id === "openrouter")?.chatUrl,
    ).toBe("https://openrouter.ai/api/v1/chat/completions");
  });

  it("parses references, keeping colons inside model ids", () => {
    expect(
      parseModelRef("openrouter:meta-llama/llama-3.3-70b-instruct:free"),
    ).toEqual({
      provider: "openrouter",
      model: "meta-llama/llama-3.3-70b-instruct:free",
    });
    expect(parseModelRef("glm-5.3-flash")).toBeNull();
    expect(parseModelRef("acme:model")).toBeNull();
    expect(parseModelRef("nvidia:")).toBeNull();
  });
});

describe("model lists", () => {
  it("keeps chat models, reads OpenRouter prices and free variants", () => {
    const models = parseProviderModels(
      { id: "openrouter", label: "OpenRouter" },
      {
        data: [
          {
            id: "anthropic/claude-sonnet-4.5",
            name: "Anthropic: Claude Sonnet 4.5",
            pricing: { prompt: "0.000003", completion: "0.000015" },
            context_length: 200000,
            architecture: { output_modalities: ["text"] },
          },
          {
            id: "meta-llama/llama-3.3-70b-instruct:free",
            name: "Meta: Llama 3.3 70B Instruct (free)",
            pricing: { prompt: "0", completion: "0" },
          },
          { id: "openai/text-embedding-3-large" },
          {
            id: "black-forest-labs/flux-1",
            architecture: { output_modalities: ["image"] },
          },
        ],
      },
    );
    expect(models.map((m) => m.id)).toEqual([
      "anthropic/claude-sonnet-4.5",
      "meta-llama/llama-3.3-70b-instruct:free",
    ]);
    expect(models[0]).toMatchObject({
      ref: "openrouter:anthropic/claude-sonnet-4.5",
      name: "Claude Sonnet 4.5",
      vendor: "Anthropic",
      free: false,
      contextLength: 200000,
    });
    expect(models[0].inputPerMillionUsd).toBeCloseTo(3);
    expect(models[1]).toMatchObject({
      free: true,
      name: "Llama 3.3 70B Instruct",
    });
  });

  it("filters NVIDIA's non-chat models and marks NVIDIA free", () => {
    const models = parseProviderModels(
      { id: "nvidia", label: "NVIDIA", freeByDefault: true },
      {
        data: [
          { id: "meta/llama-3.3-70b-instruct" },
          { id: "nvidia/nv-embedqa-e5-v5" },
          { id: "nvidia/llama-3.2-nv-rerankqa-1b-v2" },
          { id: "meta/llama-guard-4-12b" },
          { id: "deepseek-ai/deepseek-r1" },
        ],
      },
    );
    expect(models.map((m) => m.id)).toEqual([
      "meta/llama-3.3-70b-instruct",
      "deepseek-ai/deepseek-r1",
    ]);
    expect(models.every((m) => m.free)).toBe(true);
    expect(models[1].reasoning).toBe(true);
  });

  it("names and ranks models", () => {
    expect(prettyModelName("meta/llama-3.3-70b-instruct")).toBe(
      "Llama 3.3 70B Instruct",
    );
    expect(prettyModelName("glm-5.3-flash:free")).toBe("GLM 5.3 Flash");
    expect(familyRank("anthropic/claude-opus-4.1")).toBeLessThan(
      familyRank("meta/llama-3.1-8b"),
    );
    expect(isChatModelId("openai/whisper-1")).toBe(false);
  });

  it("lists every configured provider once, caches, and survives a failing provider", async () => {
    process.env.OPENROUTER_API_KEY = "or-key";
    process.env.NVIDIA_API_KEY = "nv-key";
    const { impl, calls } = fakeFetch((call) => {
      if (call.url.includes("openrouter")) {
        return Response.json({
          data: [
            {
              id: "openai/gpt-5",
              pricing: { prompt: "0.00000125", completion: "0.00001" },
            },
            {
              id: "qwen/qwen3-235b-a22b:free",
              pricing: { prompt: "0", completion: "0" },
            },
          ],
        });
      }
      return new Response("down", { status: 503 });
    });
    const first = await listGatewayModels({ fetchImpl: impl, now: 1_000 });
    expect(first.models.map((m) => m.ref)).toEqual([
      "openrouter:openai/gpt-5",
      "openrouter:qwen/qwen3-235b-a22b:free",
    ]);
    expect(first.providers.find((p) => p.id === "nvidia")).toMatchObject({
      ok: false,
      models: 0,
    });
    const before = calls.length;
    await listGatewayModels({ fetchImpl: impl, now: 2_000 });
    expect(calls.length).toBe(before);
    // A provider whose list failed still accepts a well-formed reference.
    expect(
      await resolveGatewayModel("nvidia:meta/llama-3.3-70b-instruct", {
        fetchImpl: impl,
      }),
    ).toMatchObject({
      provider: "nvidia",
      free: true,
    });
    expect(
      await resolveGatewayModel("openrouter:not/listed", { fetchImpl: impl }),
    ).toBeNull();
    expect(pickDefaultModel(first.models)?.ref).toBe("openrouter:openai/gpt-5");
    expect(pickDefaultModel(first.models, { freeOnly: true })?.ref).toBe(
      "openrouter:qwen/qwen3-235b-a22b:free",
    );
  });
});

describe("streaming", () => {
  it("splits a leading think block, even across chunks", () => {
    const splitter = new ThinkSplitter();
    const events = [
      ...splitter.push("<thi"),
      ...splitter.push("nk>step one</th"),
      ...splitter.push("ink>\n\nThe answer"),
      ...splitter.push(" is 4."),
      ...splitter.flush(),
    ];
    expect(
      events
        .filter((e) => e.type === "reasoning")
        .map((e) => ("text" in e ? e.text : ""))
        .join(""),
    ).toBe("step one");
    expect(
      events
        .filter((e) => e.type === "text")
        .map((e) => ("text" in e ? e.text : ""))
        .join(""),
    ).toBe("The answer is 4.");
    const plain = new ThinkSplitter();
    expect([...plain.push("Use <think> tags"), ...plain.flush()]).toEqual([
      { type: "text", text: "Use <think> tags" },
    ]);
  });

  it("streams text, reasoning and usage from an OpenAI-compatible provider", async () => {
    process.env.OPENROUTER_API_KEY = "or-key";
    const { impl, calls } = fakeFetch(() =>
      sse([
        { choices: [{ delta: { reasoning: "Thinking..." } }] },
        { choices: [{ delta: { content: "Hal" } }] },
        { choices: [{ delta: { content: "lo" } }] },
        {
          choices: [],
          usage: { prompt_tokens: 12, completion_tokens: 3, cost: 0.0004 },
        },
      ]),
    );
    const result = await completeGateway({
      ref: "openrouter:openai/gpt-5",
      messages: [{ role: "user", content: "Hi" }],
      fetchImpl: impl,
    });
    expect(result).toEqual({
      text: "Hallo",
      reasoning: "Thinking...",
      usage: { inputTokens: 12, outputTokens: 3, costUsd: 0.0004 },
    });
    expect(calls[0].url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(calls[0].auth).toBe("Bearer or-key");
    expect(calls[0].body).toMatchObject({
      model: "openai/gpt-5",
      stream: true,
      usage: { include: true },
    });
  });

  it("never answers a rate limit with another key", async () => {
    process.env.UNOROUTER_API_KEY = "uno-a";
    const { impl, calls } = fakeFetch(
      () =>
        new Response("slow down", {
          status: 429,
          headers: { "retry-after": "7" },
        }),
    );
    await expect(
      completeGateway({
        ref: "unorouter:glm-5.3-flash",
        messages: [],
        fetchImpl: impl,
      }),
    ).rejects.toMatchObject({
      name: "ProviderError",
      code: "rate_limited",
      retryAfterMs: 7000,
    });
    expect(calls).toHaveLength(1);
  });

  it("retries once without the optional usage fields when a server refuses them", async () => {
    process.env.NVIDIA_API_KEY = "nv";
    const { impl, calls } = fakeFetch((_call, index) =>
      index === 0
        ? new Response('{"error":"unrecognized field stream_options"}', {
            status: 400,
          })
        : sse([{ choices: [{ delta: { content: "ok" } }] }]),
    );
    const result = await completeGateway({
      ref: "nvidia:meta/llama-3.3-70b-instruct",
      messages: [],
      fetchImpl: impl,
    });
    expect(result.text).toBe("ok");
    expect(calls[1].body).not.toHaveProperty("stream_options");
  });

  it("hides a model the provider does not serve", async () => {
    process.env.OPENROUTER_API_KEY = "or-key";
    const listing = fakeFetch(() =>
      Response.json({ data: [{ id: "x/gone" }, { id: "x/here" }] }),
    );
    expect(
      (await listGatewayModels({ fetchImpl: listing.impl })).models,
    ).toHaveLength(2);
    const failing = fakeFetch(
      () => new Response("model not found", { status: 404 }),
    );
    await expect(
      completeGateway({
        ref: "openrouter:x/gone",
        messages: [],
        fetchImpl: failing.impl,
      }),
    ).rejects.toMatchObject({ code: "model_not_configured" });
    const after = await listGatewayModels({ fetchImpl: listing.impl });
    expect(after.models.map((m) => m.id)).toEqual(["x/here"]);
  });

  it("stops offering paid models of a provider without credit", async () => {
    process.env.OPENROUTER_API_KEY = "or-key";
    const listing = fakeFetch(() =>
      Response.json({
        data: [
          {
            id: "anthropic/claude-opus-4.1",
            pricing: { prompt: "0.000015", completion: "0.000075" },
          },
          {
            id: "openai/gpt-5",
            pricing: { prompt: "0.00000125", completion: "0.00001" },
          },
          {
            id: "qwen/qwen3-235b:free",
            pricing: { prompt: "0", completion: "0" },
          },
        ],
      }),
    );
    const before = await listGatewayModels({ fetchImpl: listing.impl });
    expect(before.models).toHaveLength(3);
    const broke = fakeFetch(
      () =>
        new Response('{"error":{"message":"Insufficient credits"}}', {
          status: 402,
        }),
    );
    await expect(
      completeGateway({
        ref: "openrouter:anthropic/claude-opus-4.1",
        messages: [],
        fetchImpl: broke.impl,
      }),
    ).rejects.toMatchObject({ code: "insufficient_credit" });
    const after = await listGatewayModels({ fetchImpl: listing.impl });
    // Every paid model of the provider goes; the free one stays.
    expect(after.models.map((m) => m.id)).toEqual(["qwen/qwen3-235b:free"]);
  });

  it("offers no Bytez model when the sync found none that answers", async () => {
    process.env.BYTEZ_API_KEY = "bz-key";
    try {
      const defaults = await listGatewayModels({
        fetchImpl: fakeFetch(() => Response.json({ data: [] })).impl,
      });
      expect(defaults.models.some((m) => m.provider === "bytez")).toBe(true);
      resetGatewayModelCache();
      process.env.OSIRUS_BYTEZ_MODELS = "none";
      const none = await listGatewayModels({
        fetchImpl: fakeFetch(() => Response.json({ data: [] })).impl,
      });
      expect(none.models.filter((m) => m.provider === "bytez")).toEqual([]);
    } finally {
      delete process.env.OSIRUS_BYTEZ_MODELS;
    }
  });

  it("takes the measured unfunded providers from the runtime sync", async () => {
    process.env.OPENROUTER_API_KEY = "or-key";
    const listing = fakeFetch(() =>
      Response.json({
        data: [
          {
            id: "openai/gpt-5",
            pricing: { prompt: "0.00000125", completion: "0.00001" },
          },
          {
            id: "qwen/qwen3-235b:free",
            pricing: { prompt: "0", completion: "0" },
          },
        ],
      }),
    );
    try {
      process.env.OSIRUS_UNFUNDED_PROVIDERS = "nvidia,openrouter";
      const blocked = await listGatewayModels({ fetchImpl: listing.impl });
      expect(blocked.models.map((m) => m.free)).toEqual([true]);
      process.env.OSIRUS_UNFUNDED_PROVIDERS = "none";
      const funded = await listGatewayModels({ fetchImpl: listing.impl });
      expect(funded.models).toHaveLength(2);
    } finally {
      delete process.env.OSIRUS_UNFUNDED_PROVIDERS;
    }
  });

  it("reports a provider error sent inside the stream", async () => {
    process.env.OPENROUTER_API_KEY = "or-key";
    const { impl } = fakeFetch(() =>
      sse([
        { choices: [{ delta: { content: "Hal" } }] },
        { error: { message: "Rate limit exceeded", code: 429 } },
      ]),
    );
    const seen: string[] = [];
    await expect(
      (async () => {
        for await (const event of streamGateway({
          ref: "openrouter:a/b",
          messages: [],
          fetchImpl: impl,
        })) {
          if (event.type === "text") seen.push(event.text);
        }
      })(),
    ).rejects.toMatchObject({ code: "rate_limited" });
    expect(seen).toEqual(["Hal"]);
  });

  it("refuses a provider without a key", async () => {
    await expect(
      completeGateway({ ref: "lightning:x/y", messages: [] }),
    ).rejects.toMatchObject({
      code: "provider_not_configured",
    });
  });
});

describe("structured output", () => {
  it("finds the object in prose, fences and think blocks", () => {
    expect(extractJsonObject('Sure! {"a": 1}')).toEqual({ a: 1 });
    expect(extractJsonObject('```json\n{"a": [1, 2,],}\n```')).toEqual({
      a: [1, 2],
    });
    expect(
      extractJsonObject('<think>{"wrong": true}</think>Result: {"ok": "{x}"}'),
    ).toEqual({ ok: "{x}" });
    expect(extractJsonObject("no json here")).toBeUndefined();
  });

  it("asks once more for the object when the first reply has none", async () => {
    process.env.OPENROUTER_API_KEY = "or-key";
    let replies = 0;
    const { impl, calls } = fakeFetch((call) => {
      if (call.url.endsWith("/models"))
        return Response.json({ data: [{ id: "a/b" }] });
      const index = replies++;
      return sse([
        {
          choices: [
            {
              delta: {
                content: index === 0 ? "I would plan it." : '{"plan": "x"}',
              },
            },
          ],
        },
      ]);
    });
    const provider = new GatewayProvider({
      ref: "openrouter:a/b",
      fetchImpl: impl,
    });
    const result = await provider.structured({
      requestId: "r1",
      role: "THINKING",
      messages: [{ role: "user", content: "plan" }],
      validate: (value) => value as { plan: string },
    });
    expect(result.value).toEqual({ plan: "x" });
    const chat = calls.filter((call) => call.url.endsWith("/chat/completions"));
    expect(chat).toHaveLength(2);
    const repair = (
      chat[1].body?.messages as Array<{ role: string; content: string }>
    ).at(-1);
    expect(repair?.content).toMatch(/exactly one JSON object/);
  });
});

describe("pinned runs fall back like the chat", () => {
  // Live 2026-10-26: a Rouge run pinned a ranked guess the service no longer
  // served and failed in 4 s, while measured models were answering.
  const OR_MODELS = "https://openrouter.ai/api/v1/models";
  const NV_MODELS = "https://integrate.api.nvidia.com/v1/models";

  afterEach(() => {
    delete process.env.OSIRUS_VERIFIED_TOP_MODELS;
  });

  function answer(text: string) {
    return sse([{ choices: [{ delta: { content: text } }] }]);
  }

  it("tries the measured models right after the pinned one", async () => {
    process.env.OPENROUTER_API_KEY = "or-key";
    process.env.NVIDIA_API_KEY = "nv-key";
    process.env.OSIRUS_VERIFIED_TOP_MODELS =
      "nvidia:nvidia/nemotron-3-ultra-550b-a55b";
    const { impl, calls } = fakeFetch((call) => {
      if (call.url === OR_MODELS)
        return Response.json({
          data: [
            { id: "acme/gone-70b-pin:free" },
            { id: "acme/other-70b-pin:free" },
          ],
        });
      if (call.url === NV_MODELS)
        return Response.json({
          data: [{ id: "nvidia/nemotron-3-ultra-550b-a55b" }],
        });
      if (call.body?.model === "acme/gone-70b-pin:free")
        return new Response("no such model", { status: 404 });
      return answer(`from ${String(call.body?.model)}`);
    });
    const provider = new GatewayProvider({
      ref: "openrouter:acme/gone-70b-pin:free",
      autoFallback: true,
      fetchImpl: impl,
    });
    const result = await provider.complete({
      requestId: "pin-1",
      role: "THINKING",
      messages: [{ role: "user", content: "Hallo" }],
    });
    expect(result.text).toBe("from nvidia/nemotron-3-ultra-550b-a55b");
    const chat = calls.filter((call) => call.url.endsWith("/chat/completions"));
    expect(chat.map((call) => call.body?.model)).toEqual([
      "acme/gone-70b-pin:free",
      "nvidia/nemotron-3-ultra-550b-a55b",
    ]);
  });

  it("leaves a rate-limited service for the rest of the call", async () => {
    process.env.OPENROUTER_API_KEY = "or-key";
    process.env.NVIDIA_API_KEY = "nv-key";
    const { impl, calls } = fakeFetch((call) => {
      if (call.url === OR_MODELS)
        return Response.json({
          data: [
            { id: "acme/busy-70b-pin:free" },
            { id: "acme/busy-70b-two:free" },
            { id: "acme/busy-70b-three:free" },
          ],
        });
      if (call.url === NV_MODELS)
        return Response.json({ data: [{ id: "acme/steady-8b-nv" }] });
      if (call.url.includes("openrouter"))
        return new Response("busy", { status: 429 });
      return answer("steady");
    });
    const provider = new GatewayProvider({
      ref: "openrouter:acme/busy-70b-pin:free",
      autoFallback: true,
      fetchImpl: impl,
    });
    const events: string[] = [];
    for await (const event of provider.stream({
      requestId: "pin-2",
      role: "THINKING",
      messages: [{ role: "user", content: "Hallo" }],
    }))
      if (event.type === "delta") events.push(event.text);
    expect(events.join("")).toBe("steady");
    const chat = calls.filter((call) => call.url.endsWith("/chat/completions"));
    expect(chat.filter((call) => call.url.includes("openrouter"))).toHaveLength(
      1,
    );
  });
});

describe("gated gateways", () => {
  // Live 2026-10-27: Kunya lists 219 models (chat, image, live audio), most
  // behind a plan; B.AI, AIHubMix and ShortAPI need a deposit. Only what the
  // runtime sync measured answering may reach a picker.
  const KUNYA_MODELS = "https://kunya.ai/api/v1/models";
  const SHORTAPI_LIST = "https://api.shortapi.ai/v1/model/list";

  function lists() {
    return fakeFetch((call) => {
      if (call.url === KUNYA_MODELS)
        return Response.json({
          data: [
            { id: "claude-sonnet-5-5", type: "chat" },
            { id: "claude-opus-5-5", type: "chat" },
            { id: "gpt-6-luna", type: "chat" },
            { id: "midjourney-v8.1", type: "image" },
            { id: "gemini-3.8-live", type: "live" },
          ],
        });
      if (call.url === SHORTAPI_LIST)
        return Response.json({
          code: 0,
          data: {
            list: [
              { id: "6a0439", model_name: "anthropic/claude-opus-4.7" },
              { id: "69e8ab", model_name: "openai/gpt-image-2/text-to-image" },
            ],
          },
        });
      return new Response("not found", { status: 404 });
    });
  }

  it("offers only the models the runtime sync measured", async () => {
    process.env.KUNYA_API_KEY = "kunya-key";
    process.env.SHORTAPI_API_KEY = "short-key";
    process.env.OSIRUS_SERVED_MODELS =
      "kunya:claude-sonnet-5-5,kunya:gpt-6-luna";
    const { impl, calls } = lists();
    const { models } = await listGatewayModels({ fetchImpl: impl });
    expect(models.map((m) => m.ref).sort()).toEqual([
      "kunya:claude-sonnet-5-5",
      "kunya:gpt-6-luna",
    ]);
    // Served models need no list call (Kunya's free plan allows about 20
    // calls an hour), and read like the vendor writes them.
    expect(calls.filter((call) => call.url === KUNYA_MODELS)).toHaveLength(0);
    expect(models.map((m) => m.name)).toContain("Claude Sonnet 5.5");
    // The probe sees the whole chat list: no image or live-audio entries,
    // ShortAPI by its callable model name.
    const all = await listGatewayModels({ fetchImpl: impl, unserved: true });
    expect(all.models.map((m) => m.ref).sort()).toEqual([
      "kunya:claude-opus-5-5",
      "kunya:claude-sonnet-5-5",
      "kunya:gpt-6-luna",
      "shortapi:anthropic/claude-opus-4.7",
    ]);
  });

  it("offers none of them before the sync has measured", async () => {
    process.env.KUNYA_API_KEY = "kunya-key";
    const { impl } = lists();
    const { models } = await listGatewayModels({ fetchImpl: impl });
    expect(models).toHaveLength(0);
    process.env.OSIRUS_SERVED_MODELS = "none";
    resetGatewayModelCache();
    expect(
      (await listGatewayModels({ fetchImpl: lists().impl })).models,
    ).toHaveLength(0);
  });

  it("tells a model behind a plan from an account without balance", async () => {
    const code = async (status: number, body: string) =>
      (await classifyFailure(new Response(body, { status }))).code;
    // One model needs a plan or deposit: the others of the account answer.
    expect(
      await code(
        403,
        '{"error":{"message":"GPT-6.1 Sol requires Starter or higher. Upgrade or purchase credits to unlock this model."}}',
      ),
    ).toBe("model_not_configured");
    expect(
      await code(
        403,
        '{"error":{"code":"access_denied","message":"Access restricted. Deposit required to unlock premium models."}}',
      ),
    ).toBe("model_not_configured");
    // The whole account has no balance.
    expect(
      await code(
        403,
        '{"error":{"message":"Your account balance is insufficient. Please recharge your account to continue using the API."}}',
      ),
    ).toBe("insufficient_credit");
    expect(
      await code(
        402,
        '{"error":{"message":"Insufficient credit. Please purchase more credits or use a different model."}}',
      ),
    ).toBe("insufficient_credit");
  });

  it("records the cost the gateway charged", () => {
    expect(
      normalizeGatewayUsage({
        prompt_tokens: 423,
        completion_tokens: 4,
        charged_cost_usd: 0.001976,
      }).costUsd,
    ).toBe(0.001976);
  });

  it("ranks the new families", () => {
    const tier = (id: string) => tierOf({ id, rank: familyRank(id) });
    expect(tier("claude-sonnet-5-5")).toBe("top");
    expect(tier("gpt-5.4")).toBe("top");
    expect(tier("deepseek-v4-pro")).toBe("top");
    expect(familyRank("gpt-6-astra")).toBeLessThan(familyRank("gpt-5.4"));
    // Luna is the small variant (priced like one).
    expect(tier("gpt-6-luna")).toBe("fast");
  });
});

describe("cache, threads and cost", () => {
  it("answers the same conversation from cache, per workspace", () => {
    const messages = [{ role: "user" as const, content: "Hi" }];
    const a = answerCacheKey({
      scope: "ws-a",
      ref: "openrouter:a/b",
      messages,
    });
    const b = answerCacheKey({
      scope: "ws-b",
      ref: "openrouter:a/b",
      messages,
    });
    expect(a).not.toBe(b);
    storeAnswer(a, { text: "Hallo", reasoning: "" }, 0);
    expect(cachedAnswer(a, 1000)?.text).toBe("Hallo");
    expect(cachedAnswer(b, 1000)).toBeNull();
    expect(cachedAnswer(a, 31 * 60 * 1000)).toBeNull();
  });

  it("shows only the newest answer after a regenerate", () => {
    expect(
      collapseRegenerations([
        { role: "user", id: 1 },
        { role: "assistant", id: 2 },
        { role: "assistant", id: 3 },
        { role: "user", id: 4 },
      ]).map((m) => m.id),
    ).toEqual([1, 3, 4]);
  });

  it("charges the provider's cost, list prices, or a conservative estimate", () => {
    const base = {
      ref: "openrouter:a/b",
      provider: "openrouter" as const,
      providerLabel: "OpenRouter",
      id: "a/b",
      name: "B",
      vendor: "A",
      reasoning: false,
      contextLength: null,
      rank: 1,
    };
    expect(
      callCostUsd(
        { ...base, free: false, inputPerMillionUsd: 1, outputPerMillionUsd: 2 },
        { costUsd: 0.5 },
      ),
    ).toBe(0.5);
    expect(
      callCostUsd(
        { ...base, free: false, inputPerMillionUsd: 1, outputPerMillionUsd: 2 },
        { inputTokens: 1_000_000, outputTokens: 1_000_000 },
      ),
    ).toBe(3);
    expect(
      callCostUsd(
        {
          ...base,
          free: true,
          inputPerMillionUsd: null,
          outputPerMillionUsd: null,
        },
        { inputTokens: 1_000_000, outputTokens: 1_000_000 },
      ),
    ).toBeCloseTo(0.5, 6);
    expect(
      callCostUsd(
        {
          ...base,
          free: false,
          inputPerMillionUsd: null,
          outputPerMillionUsd: null,
        },
        { inputTokens: 1_000_000, outputTokens: 0 },
      ),
    ).toBe(3);
  });
});

describe("model hygiene", () => {
  it("keeps embedding, OCR, music and router entries out of the chat list", async () => {
    const { isChatModelId } = await import("@/lib/gateway/models");
    for (const id of [
      "voyage-4-large",
      "nvidia/nvclip",
      "google/lyria-3-pro-preview",
      "nvidia/nemotron-parse",
      "openrouter/auto-router",
      "free-models-router",
      "nvidia/vila",
    ]) {
      expect(isChatModelId(id)).toBe(false);
    }
    for (const id of [
      "nvidia/nemotron-3.5-lightning",
      "qwen/qwen3-coder-plus",
      "deepseek-ai/deepseek-r1",
    ]) {
      expect(isChatModelId(id)).toBe(true);
    }
  });

  it("lists one entry per model name and pushes slow or failing models back", async () => {
    const { uniqueByName, noteModelResult, modelPenalty } =
      await import("@/lib/gateway/models");
    expect(
      uniqueByName([{ name: "GLM 5.3" }, { name: "GLM-5.3" }, { name: "X" }]),
    ).toEqual([{ name: "GLM 5.3" }, { name: "X" }]);
    const now = Date.now();
    noteModelResult("p:slow", { ok: true, firstTokenMs: 20_000 }, now);
    noteModelResult("p:bad", { ok: false, firstTokenMs: 12_000 }, now);
    expect(modelPenalty("p:slow", now)).toBe(20);
    expect(modelPenalty("p:bad", now)).toBe(20);
    expect(modelPenalty("p:new", now)).toBe(0);
    expect(modelPenalty("p:bad", now + 11 * 60 * 1000)).toBe(0);
  });
});
