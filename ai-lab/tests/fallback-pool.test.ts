import { describe, expect, it, vi } from "vitest";
import { labKeyPool } from "../inference/key-pool";
import {
  FALLBACK_ADMISSION,
  UnoRouterError,
  unorouterChat,
} from "../inference/unorouter";
import { answerWithProgram } from "../programs/serve";
import { rougeProgram } from "../programs/rouge";
import type { ModelProgram } from "../programs/types";

const offline = {
  checkpointPresent: false,
  checkpointValidated: false,
  runtimeOnline: false,
};

function jsonResponse(text: string, status = 200): Response {
  return new Response(
    JSON.stringify({
      model: "qwen3:free",
      choices: [{ message: { content: text } }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    }),
    { status, headers: { "content-type": "application/json" } },
  );
}

function authOf(call: unknown[]): string {
  const init = call[1] as { headers?: { Authorization?: string } };
  return init.headers?.Authorization ?? "";
}

describe("UnoRouter key pool", () => {
  it("reads the named env vars and still works with only UNOROUTER_API_KEY", () => {
    expect(
      labKeyPool({
        UNOROUTER_API_KEY: "lab-only",
        UNOROUTER_API_KEY_1: "",
        UNOROUTER_API_KEY_2: "   ",
      }),
    ).toEqual(["lab-only"]);
    expect(
      labKeyPool({
        UNOROUTER_API_KEY: "same",
        UNOROUTER_API_KEY_1: "same",
        UNOROUTER_API_KEY_2: "second",
        UNOROUTER_API_KEY_3: "third",
      }),
    ).toEqual(["same", "second", "third"]);
    expect(labKeyPool({ NODE_ENV: "test" })).toEqual([]);
  });

  it("tries the next key on 429 and 5xx, not on other client errors", async () => {
    const sleep = vi.fn(async () => undefined);
    const rateLimited = vi.fn(async (_url: string, init?: RequestInit) => {
      const header = new Headers(init?.headers).get("authorization") ?? "";
      if (header.endsWith("key-a")) return new Response("no", { status: 429 });
      return jsonResponse("ok");
    });
    const first = await unorouterChat({
      apiKeys: ["key-a", "key-b"],
      model: "qwen3:free",
      messages: [{ role: "user", content: "hi" }],
      fetchImpl: rateLimited as unknown as typeof fetch,
      sleep,
    });
    expect(first.text).toBe("ok");
    expect(first.keyAttempts).toBe(2);
    expect(sleep).toHaveBeenCalledOnce();
    expect(rateLimited).toHaveBeenCalledTimes(2);

    const serverError = vi.fn(async (_url: string, init?: RequestInit) => {
      const header = new Headers(init?.headers).get("authorization") ?? "";
      if (header.endsWith("key-a")) return new Response("no", { status: 503 });
      return jsonResponse("ok");
    });
    await unorouterChat({
      apiKeys: ["key-a", "key-b"],
      model: "qwen3:free",
      messages: [{ role: "user", content: "hi" }],
      fetchImpl: serverError as unknown as typeof fetch,
      sleep: async () => undefined,
    });
    expect(serverError).toHaveBeenCalledTimes(2);

    const rejected = vi.fn(async () => new Response("no", { status: 401 }));
    await expect(
      unorouterChat({
        apiKeys: ["key-a", "key-b"],
        model: "qwen3:free",
        messages: [{ role: "user", content: "hi" }],
        fetchImpl: rejected as unknown as typeof fetch,
        sleep: async () => undefined,
      }),
    ).rejects.toBeInstanceOf(UnoRouterError);
    expect(rejected).toHaveBeenCalledTimes(1);
  });

  it("does not share one in-flight lock across parallel calls", async () => {
    expect(FALLBACK_ADMISSION).toBeGreaterThan(40);
    let active = 0;
    let peak = 0;
    const fetchImpl = vi.fn(async () => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 15));
      active -= 1;
      return jsonResponse("ok");
    });
    const calls = Array.from({ length: 40 }, () =>
      unorouterChat({
        apiKeys: ["key-a"],
        model: "qwen3:free",
        messages: [{ role: "user", content: "hi" }],
        fetchImpl: fetchImpl as unknown as typeof fetch,
        sleep: async () => undefined,
      }),
    );
    const results = await Promise.all(calls);
    expect(results).toHaveLength(40);
    expect(peak).toBe(40);
    expect(fetchImpl).toHaveBeenCalledTimes(40);
  });

  it("gives every parallel request its own key attempt, not a shared cursor", async () => {
    const seen: string[] = [];
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const header = new Headers(init?.headers).get("authorization") ?? "";
      seen.push(header);
      if (header.endsWith("key-a")) return new Response("no", { status: 429 });
      return jsonResponse("ok");
    });
    await Promise.all(
      [0, 1].map(() =>
        unorouterChat({
          apiKeys: ["key-a", "key-b"],
          model: "qwen3:free",
          messages: [{ role: "user", content: "hi" }],
          fetchImpl: fetchImpl as unknown as typeof fetch,
          sleep: async () => undefined,
        }),
      ),
    );
    const firstKey = seen.filter((header) => header.endsWith("key-a"));
    expect(firstKey).toHaveLength(2);
    expect(authOf(fetchImpl.mock.calls[0] as unknown[])).not.toContain(
      "UNOROUTER_API_KEY=",
    );
  });
});

describe("fallback stays on the selected program", () => {
  it("sends Rouge's contract and does not relabel the API model as the checkpoint", async () => {
    let system = "";
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as {
        messages: { content: string }[];
      };
      system = body.messages[0]?.content ?? "";
      return jsonResponse("ok");
    });
    const answer = await answerWithProgram({
      program: rougeProgram,
      native: offline,
      messages: [{ role: "user", content: "verify this step" }],
      apiKey: "test-key",
      env: { NODE_ENV: "test" },
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(answer.userLabel).toBe("ROUGE 1 · API fallback");
    expect(answer.provenance).toBe(
      "ROUGE-1 / api_fallback / UnoRouter / qwen3:free",
    );
    expect(answer.checkpoint).toBeNull();
    expect(answer.modelId).not.toBe(rougeProgram.nativeModelId);
    expect(answer.measuredEqual).toBe(false);
    expect(answer.armIds).toContain("ROUGE_VERIFICATION");
    expect(answer.costQuote.billed).toBe(false);
    expect(answer.costQuote.eurInput).toBeGreaterThan(0);
    expect(answer.budgetNote).toMatch(/not a measured cost match/);
    expect(answer.trained).toBe(false);
    expect(system).toContain("ROUGE 1");
    expect(system).toContain("ROUGE_VERIFICATION");
    expect(system).toContain("not the native checkpoint");
    expect(system).toMatch(/not a benchmark score|benchmark score/);
  });

  it("keeps a Darus-shaped program on DARUS · API fallback", async () => {
    const darusLike: ModelProgram = {
      ...rougeProgram,
      id: "darus",
      displayName: "DARUS",
      nativeModelId: "osirus/darus-1",
      ui: {
        selectorLabel: "DARUS",
        fallbackLabel: "DARUS · API fallback",
        activities: [
          "deep_reasoning",
          "planning",
          "waiting",
          "api_fallback",
          "native_inference",
        ],
      },
      arms: [
        {
          ...rougeProgram.arms[0]!,
          id: "DARUS_PLANNING",
          task: {
            ...rougeProgram.arms[0]!.task,
            instruction: "Planning lists steps. It does not execute them.",
          },
        },
      ],
      fallback: {
        envVar: "LAB_FALLBACK_MODEL_DARUS",
        defaultModelId: "gemini-3.6-flash:free",
        catalogRole: "broad",
      },
    };
    const fetchImpl = vi.fn(async () => jsonResponse("a step"));
    const answer = await answerWithProgram({
      program: darusLike,
      native: offline,
      messages: [{ role: "user", content: "plan the rollout" }],
      apiKey: "test-key",
      env: { NODE_ENV: "test" },
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(answer.userLabel).toBe("DARUS · API fallback");
    expect(answer.provenance).toContain("DARUS / api_fallback / UnoRouter /");
    expect(answer.provenance).not.toContain("osirus/darus-1");
    expect(answer.checkpoint).toBeNull();
    expect(answer.armIds).toEqual(["DARUS_PLANNING"]);
    expect(answer.phases).toContain("planning");
    expect(answer.measuredEqual).toBe(false);
    expect(answer.costQuote.modelId).toBe("darus");
    expect(answer.costQuote.billed).toBe(false);
  });

  it("withholds a QUASNIR fallback that fails the program security gate", async () => {
    const quasnirLike: ModelProgram = {
      ...rougeProgram,
      id: "quasnir",
      displayName: "QUASNIR",
      nativeModelId: "osirus/quasnir-1",
      ui: {
        selectorLabel: "QUASNIR",
        fallbackLabel: "QUASNIR · API fallback",
        activities: [
          "code_analysis",
          "security_scan",
          "waiting",
          "api_fallback",
          "native_inference",
        ],
      },
      arms: [
        {
          ...rougeProgram.arms[0]!,
          id: "QUASNIR_SECURITY",
          task: {
            ...rougeProgram.arms[0]!.task,
            instruction: "Security findings stay on the static scan.",
          },
        },
      ],
      fallback: {
        envVar: "LAB_FALLBACK_MODEL_QUASNIR",
        defaultModelId: "qwen2.5-coder-32b:free",
        catalogRole: "code",
      },
    };
    const fetchImpl = vi.fn(async () => jsonResponse("eval(input)"));
    const answer = await answerWithProgram({
      program: quasnirLike,
      native: offline,
      messages: [{ role: "user", content: "security scan this function" }],
      apiKey: "test-key",
      env: { NODE_ENV: "test" },
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(answer.userLabel).toBe("QUASNIR · API fallback");
    expect(answer.armIds).toEqual(["QUASNIR_SECURITY"]);
    expect(answer.phases).toContain("security_scan");
    expect(answer.text).toMatch(/withheld/);
    expect(answer.text).not.toContain("eval(input)");
    expect(answer.checkpoint).toBeNull();
    expect(answer.measuredEqual).toBe(false);
  });
});

it("runs the selected arm policy and refuses a locked surface without a provider call", async () => {
  const fetchImpl = vi.fn(async () => jsonResponse("unused"));
  const math = await answerWithProgram({
    program: rougeProgram,
    native: offline,
    messages: [{ role: "user", content: "math 2 + 2" }],
    apiKey: "test-key",
    env: { NODE_ENV: "test" },
    fetchImpl: fetchImpl as unknown as typeof fetch,
  });
  expect(math.armIds).toContain("ROUGE_MATH");
  expect(math.armSteps.some((step) => step.includes("2 + 2 = 4"))).toBe(true);
  expect(math.text).toContain("Program steps:");
  expect(math.measuredEqual).toBe(false);
  expect(math.checkpoint).toBeNull();
  expect(math.userLabel).toBe("ROUGE 1 · API fallback");

  const terminal = await answerWithProgram({
    program: rougeProgram,
    native: offline,
    messages: [{ role: "user", content: "terminal `echo hi`" }],
    apiKey: "test-key",
    env: { NODE_ENV: "test" },
    fetchImpl: fetchImpl as unknown as typeof fetch,
  });
  expect(terminal.armIds).toContain("ROUGE_TERMINAL");
  expect(
    terminal.armSteps.some(
      (step) => step.includes("no shell spawned") || step.includes("echo hi"),
    ),
  ).toBe(true);

  const callsBefore = fetchImpl.mock.calls.length;
  const refused = await answerWithProgram({
    program: rougeProgram,
    native: offline,
    messages: [{ role: "user", content: "disable trust_root" }],
    apiKey: "test-key",
    env: { NODE_ENV: "test" },
    fetchImpl: fetchImpl as unknown as typeof fetch,
  });
  expect(fetchImpl.mock.calls.length).toBe(callsBefore);
  expect(refused.text).toMatch(/refused|not changed/);
  expect(refused.armSteps.some((step) => step.includes("trust_root"))).toBe(
    true,
  );
  expect(refused.measuredEqual).toBe(false);
  expect(refused.provenance).toContain("api_fallback");
});
