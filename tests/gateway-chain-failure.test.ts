import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { hideModel, resetGatewayModelCache } from "@/lib/gateway/models";
import { GatewayProvider } from "@/lib/gateway/provider";
import { providerRefusalOf } from "@/lib/models/provider";

// Production 2026-11-25 (journey runs 45628751790, 45635334011): a run on
// the free plan pinned to a free model ended "model_not_configured" within
// nine seconds and was failed for good. Two faults made that:
// - a chain in which no model answered threw the LAST model's error, so a
//   fallback behind a plan (permanent for that model) failed a run whose
//   other candidates were only busy (rate limited, worth waiting for);
// - a pinned model hidden after a 404 was no longer listed, and a pin that
//   cannot be resolved got no fallbacks at all, for an hour.

const OR_MODELS = "https://openrouter.ai/api/v1/models";
const NV_MODELS = "https://integrate.api.nvidia.com/v1/models";
const UNO_MODELS = "https://api.unorouter.com/v1/models";
const saved = {
  or: process.env.OPENROUTER_API_KEY,
  nv: process.env.NVIDIA_API_KEY,
  uno: process.env.UNOROUTER_API_KEY,
};

beforeEach(() => {
  process.env.OPENROUTER_API_KEY = "or-key";
  process.env.NVIDIA_API_KEY = "nv-key";
  resetGatewayModelCache();
});
afterEach(() => {
  for (const [name, value] of [
    ["OPENROUTER_API_KEY", saved.or],
    ["NVIDIA_API_KEY", saved.nv],
    ["UNOROUTER_API_KEY", saved.uno],
  ] as const)
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  resetGatewayModelCache();
});

function answer(text: string) {
  return new Response(
    `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\ndata: [DONE]\n\n`,
    { headers: { "content-type": "text/event-stream" } },
  );
}

function gateway(reply: (model: string) => Response) {
  const tried: string[] = [];
  const impl = (async (url: RequestInfo | URL, init?: RequestInit) => {
    if (String(url) === OR_MODELS)
      return Response.json({
        data: [{ id: "acme/gratis-70b:free" }, { id: "acme/gated-70b:free" }],
      });
    if (String(url) === UNO_MODELS)
      return Response.json({
        data: [{ id: "claude-haiku-5-5:free" }, { id: "agnes-3.0-flash:free" }],
      });
    if (String(url) === NV_MODELS)
      return Response.json({
        data: [
          { id: "nvidia/nemotron-3-ultra-550b-a55b" },
          { id: "meta/llama-3.3-70b-instruct" },
        ],
      });
    const model = String(JSON.parse(String(init?.body)).model);
    tried.push(model);
    return reply(model);
  }) as typeof fetch;
  return { impl, tried };
}

const busy = () => new Response("slow down", { status: 429 });
const gated = () =>
  new Response("This model requires Starter or higher.", { status: 403 });
const gone = () => new Response("no such model", { status: 404 });

async function run(ref: string, impl: typeof fetch) {
  return new GatewayProvider({ ref, autoFallback: true, fetchImpl: impl })
    .complete({
      requestId: `r-${ref}`,
      role: "STRONG",
      messages: [{ role: "user", content: "Hallo" }],
    })
    .catch((error: unknown) => error);
}

describe("a model chain in which no model answered", () => {
  it("is worth waiting for when a candidate was only busy", async () => {
    // The pinned NVIDIA model is busy (429: its service is skipped); the
    // fallbacks on another service are behind a plan, the last one too.
    const { impl, tried } = gateway((model) =>
      model.startsWith("acme/") ? gated() : busy(),
    );
    const error = await run("nvidia:nvidia/nemotron-3-ultra-550b-a55b", impl);
    expect(tried.length).toBeGreaterThan(1);
    // The last candidate was behind a plan; the run must not fail for good.
    expect(providerRefusalOf(error)).toMatchObject({
      code: "rate_limited",
      transient: true,
    });
  });

  it("stays a permanent refusal when every candidate refused for good", async () => {
    const { impl } = gateway(() => gone());
    const error = await run("nvidia:nvidia/nemotron-3-ultra-550b-a55b", impl);
    expect(providerRefusalOf(error)).toMatchObject({
      code: "model_not_configured",
      transient: false,
    });
  });
});

describe("a pinned model hidden after a 404", () => {
  it("still falls back to the other free models", async () => {
    const { impl, tried } = gateway((model) =>
      model === "nvidia/nemotron-3-ultra-550b-a55b"
        ? gone()
        : answer(`from ${model}`),
    );
    hideModel("nvidia:nvidia/nemotron-3-ultra-550b-a55b");
    const result = await run("nvidia:nvidia/nemotron-3-ultra-550b-a55b", impl);
    expect(result).toMatchObject({ text: expect.stringMatching(/^from /) });
    expect(tried.at(-1)).not.toBe("nvidia/nemotron-3-ultra-550b-a55b");
  });
});

// The runtime sync of 2026-11-17 measured "Chat probe claude-haiku-5-5:free:
// HTTP 403 rejected": UnoRouter lists the Haiku as free and refuses every
// call. A person on the free plan who picks it (the reported case) gets an
// answer from another free model instead of a failed run.
describe("the Haiku with the Free badge, refused by its provider", () => {
  for (const [label, body] of [
    ["behind a plan", "This model requires Starter or higher."],
    ["refused", "Forbidden"],
  ] as const)
    it(`still answers from another free model (${label})`, async () => {
      process.env.UNOROUTER_API_KEY = "uno-key";
      const { impl, tried } = gateway((model) =>
        model === "claude-haiku-5-5:free"
          ? new Response(body, { status: 403 })
          : answer(`from ${model}`),
      );
      const result = await run("unorouter:claude-haiku-5-5:free", impl);
      expect(tried[0]).toBe("claude-haiku-5-5:free");
      expect(result).toMatchObject({ text: expect.stringMatching(/^from /) });
      expect(tried.at(-1)).not.toBe("claude-haiku-5-5:free");
    });
});
