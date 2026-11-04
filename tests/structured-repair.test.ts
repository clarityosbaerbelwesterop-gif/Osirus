import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { coerceAgentDecision } from "@/lib/agent/decision";
import { jsonObjectCandidates } from "@/lib/gateway/json";
import { modelPenalty, resetGatewayModelCache } from "@/lib/gateway/models";
import { GatewayProvider } from "@/lib/gateway/provider";
import { readStructured, structuredWithRepair } from "@/lib/gateway/structured";

// Live 2026-10-30: "Model reply was not a valid decision" ended a Rouge step
// at once, although the model had answered JSON. These pin the repair path.

const saved = process.env.OPENROUTER_API_KEY;
beforeEach(() => {
  process.env.OPENROUTER_API_KEY = "or-key";
  resetGatewayModelCache();
});
afterEach(() => {
  if (saved === undefined) delete process.env.OPENROUTER_API_KEY;
  else process.env.OPENROUTER_API_KEY = saved;
});

const answer = (text: string) =>
  new Response(
    `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\ndata: [DONE]\n\n`,
    { headers: { "content-type": "text/event-stream" } },
  );

type Call = {
  model: string;
  messages: Array<{ role: string; content: string }>;
};

function provider(reply: (call: Call, index: number) => string) {
  const calls: Call[] = [];
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).endsWith("/models"))
      return Response.json({ data: [{ id: "a/b" }, { id: "c/d" }] });
    const body = JSON.parse(String(init?.body)) as Call;
    calls.push(body);
    return answer(reply(body, calls.length - 1));
  }) as typeof fetch;
  return {
    calls,
    gateway: new GatewayProvider({
      ref: "openrouter:a/b",
      fallbackRefs: ["openrouter:c/d"],
      fetchImpl: impl,
    }),
  };
}

const plan = (value: unknown) => {
  const row = value as { plan?: unknown };
  if (typeof row.plan !== "string") throw new Error("plan must be a string");
  return { plan: row.plan };
};

describe("reading a structured reply", () => {
  it("tries every top-level object, not the nested ones", () => {
    const text =
      'Example: {"example": true}\nMy answer: {"plan": "x", "input": {"plan": 5}}';
    expect(jsonObjectCandidates(text)).toEqual([
      { example: true },
      { plan: "x", input: { plan: 5 } },
    ]);
    const read = readStructured(text, plan);
    expect(read).toEqual({ ok: true, value: { plan: "x" } });
  });

  it("names the exact problem in the repair turn", () => {
    const read = readStructured('{"plan": 3}', plan);
    expect(read.ok).toBe(false);
    if (!read.ok) {
      expect(read.repair).toMatch(/did not match the required format/);
      expect(read.repair).toMatch(/plan must be a string/);
      expect(read.repair).toMatch(/exactly one JSON object/);
    }
  });
});

describe("structured output repairs a wrong shape", () => {
  it("repairs on the same model and adds both usages", async () => {
    const { gateway, calls } = provider((_, index) =>
      index === 0 ? '{"plan": 3}' : '{"plan": "ok"}',
    );
    const result = await gateway.structured({
      requestId: "s1",
      role: "THINKING",
      messages: [{ role: "user", content: "plan" }],
      validate: plan,
    });
    expect(result.value).toEqual({ plan: "ok" });
    expect(calls.map((call) => call.model)).toEqual(["a/b", "a/b"]);
    expect(calls[1]!.messages.at(-1)!.content).toMatch(/plan must be a string/);
  });

  it("moves to the next model when the repair fails too", async () => {
    const { gateway, calls } = provider((call) =>
      call.model === "a/b" ? '{"plan": 3}' : '{"plan": "from c/d"}',
    );
    const result = await gateway.structured({
      requestId: "s2",
      role: "THINKING",
      messages: [{ role: "user", content: "plan" }],
      validate: plan,
    });
    expect(result.value).toEqual({ plan: "from c/d" });
    expect(calls.map((call) => call.model)).toEqual(["a/b", "a/b", "c/d"]);
    // The fresh attempt starts clean: no failed reply in its history.
    expect(calls[2]!.messages).toHaveLength(1);
    // The router now ranks the model that answered unusably lower.
    expect(modelPenalty("openrouter:a/b")).toBeGreaterThan(0);
  });

  it("keeps the validator's own error when nothing helps", async () => {
    const { gateway, calls } = provider(() => '{"plan": 3}');
    await expect(
      gateway.structured({
        requestId: "s3",
        role: "THINKING",
        messages: [{ role: "user", content: "plan" }],
        validate: plan,
      }),
    ).rejects.toThrow("plan must be a string");
    expect(calls).toHaveLength(3);
  });

  it("turns a loose Rouge decision into a valid one without a retry", async () => {
    const { gateway, calls } = provider(
      () => 'Sure. {"answer": "Das Repository Goal existiert bereits."}',
    );
    const result = await gateway.structured({
      requestId: "s4",
      role: "THINKING",
      messages: [{ role: "user", content: "decide" }],
      validate: coerceAgentDecision,
    });
    expect(result.value.action).toBe("FINISH");
    expect(calls).toHaveLength(1);
  });
});

describe("retries stop for a pause", () => {
  it("rethrows when the run was paused during the repair", async () => {
    const controller = new AbortController();
    let call = 0;
    await expect(
      structuredWithRepair({
        requestId: "p1",
        messages: [],
        validate: plan,
        signal: controller.signal,
        call: async () => {
          call += 1;
          if (call === 1) return { text: "no json", usage: {} };
          controller.abort();
          throw new DOMException("Paused", "AbortError");
        },
      }),
    ).rejects.toThrow("Paused");
    expect(call).toBe(2);
  });

  it("skips the fresh attempt when no other model is left", async () => {
    const attempts: number[] = [];
    await expect(
      structuredWithRepair({
        requestId: "p2",
        messages: [],
        validate: plan,
        call: async (_messages, _id, attempt) => {
          attempts.push(attempt);
          return attempt === 2 ? null : { text: '{"plan": 1}', usage: {} };
        },
      }),
    ).rejects.toThrow("plan must be a string");
    expect(attempts).toEqual([0, 1, 2]);
  });
});
