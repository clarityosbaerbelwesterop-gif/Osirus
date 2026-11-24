import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetGatewayModelCache } from "@/lib/gateway/models";
import { GatewayProvider } from "@/lib/gateway/provider";

// A run pinned to the free plan's own allowed id (not free per call) falls
// back only to free models or allowed ids when that model fails: never to
// a paid model at the operator's cost.

const OR_MODELS = "https://openrouter.ai/api/v1/models";
const saved = process.env.OPENROUTER_API_KEY;

beforeEach(() => {
  process.env.OPENROUTER_API_KEY = "or-key";
  resetGatewayModelCache();
});
afterEach(() => {
  if (saved === undefined) delete process.env.OPENROUTER_API_KEY;
  else process.env.OPENROUTER_API_KEY = saved;
});

function answer(text: string) {
  return new Response(
    `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\ndata: [DONE]\n\n`,
    { headers: { "content-type": "text/event-stream" } },
  );
}

describe("a free-plan pin's fallback", () => {
  it("skips paid models and lands on a free one", async () => {
    const tried: string[] = [];
    const impl = (async (url: RequestInfo | URL, init?: RequestInit) => {
      if (String(url) === OR_MODELS)
        return Response.json({
          data: [
            {
              id: "glm-5.3-flash",
              pricing: { prompt: "0.0000001", completion: "0.0000004" },
            },
            {
              id: "acme/expensive-70b",
              pricing: { prompt: "0.00001", completion: "0.00003" },
            },
            { id: "acme/gratis-70b:free" },
          ],
        });
      const model = String(JSON.parse(String(init?.body)).model);
      tried.push(model);
      if (model === "glm-5.3-flash")
        return new Response("no such model", { status: 404 });
      return answer(`from ${model}`);
    }) as typeof fetch;
    const provider = new GatewayProvider({
      ref: "openrouter:glm-5.3-flash",
      autoFallback: true,
      fetchImpl: impl,
    });
    const result = await provider.complete({
      requestId: "free-pin",
      role: "FAST",
      messages: [{ role: "user", content: "Hallo" }],
    });
    expect(result.text).toBe("from acme/gratis-70b:free");
    expect(tried).not.toContain("acme/expensive-70b");
  });
});
