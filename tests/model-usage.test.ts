import { afterEach, describe, expect, it, vi } from "vitest";
import { runAgentLoop } from "../src/lib/agent/loop";
import { runArenaTask } from "../src/lib/arena/harness";
import { mechanismOf } from "../src/lib/intelligence/meta/meta-policy";
import {
  describeGenome,
  hypothesesFor,
} from "../src/lib/intelligence/strategies/genomes";
import { FREE_MODELS, freeRoleModels } from "../src/lib/models/free";
import type { ModelProvider } from "../src/lib/models/provider";
import { LocalWorkspaceDriver } from "../src/lib/sandbox/local";
import {
  directivesUnder,
  genomeSchema,
  modelUseUnder,
} from "../src/lib/strategy/runtime";
import { ToolRegistry } from "../src/lib/tools/registry";
import { z } from "zod";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("model-usage evolution (M48)", () => {
  it("parses strictly; every absent key is today's behaviour", () => {
    expect(modelUseUnder({ genome: {} })).toEqual({
      sampling: undefined,
      promptStyle: "contract_first",
      toolDescriptions: "summary",
      handoff: "full",
      critique: "none",
    });
    expect(() =>
      genomeSchema.parse({ modelUse: { sampling: { temperature: 3 } } }),
    ).toThrow();
    expect(() =>
      genomeSchema.parse({ modelUse: { roles: { BOSS: "x" } } }),
    ).toThrow();
  });

  it("never puts a model outside the free allowlist on a role", () => {
    expect(FREE_MODELS).toEqual(["deepseek-v4-pro-0813:free"]);
    expect(
      freeRoleModels({
        CODING: "deepseek-v4-pro-0813:free",
        VERIFY: "gpt-paid-9",
      }),
    ).toEqual({ CODING: "deepseek-v4-pro-0813:free" });
    expect(freeRoleModels({ VERIFY: "gpt-paid-9" })).toBeUndefined();
  });

  it("sends sampling and a role's model only when the strategy set them", async () => {
    vi.resetModules();
    vi.stubEnv(
      "UNOROUTER_BASE_URL",
      "https://api.unorouter.example/v1/chat/completions",
    );
    vi.stubEnv("UNOROUTER_API_KEY_1", "test-key");
    vi.stubEnv("OSIRUS_MODEL_STRONG", "grok-4.6");
    const bodies: Array<Record<string, unknown>> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: { body: string }) => {
        bodies.push(JSON.parse(init.body));
        return new Response(
          JSON.stringify({
            choices: [{ message: { content: "{}" } }],
            usage: {},
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }),
    );
    const { UnoRouterProvider } = await import("../src/lib/models/unorouter");
    const plain = new UnoRouterProvider({ model: "deepseek-v4-pro-0813:free" });
    await plain.complete({ requestId: "a", role: "STRONG", messages: [] });
    const tuned = new UnoRouterProvider({
      model: "deepseek-v4-pro-0813:free",
      roleModels: { VERIFY: "deepseek-v4-pro-0813:free" },
    });
    await tuned.complete({
      requestId: "b",
      role: "VERIFY",
      messages: [],
      sampling: { temperature: 0.2, topP: 0.9 },
    });
    expect(bodies[0]).not.toHaveProperty("temperature");
    expect(bodies[0]).not.toHaveProperty("top_p");
    expect(bodies[1]).toMatchObject({
      model: "deepseek-v4-pro-0813:free",
      temperature: 0.2,
      top_p: 0.9,
    });
  });

  it("orders the prompt, describes tools and asks for a self-check as the strategy says", async () => {
    const registry = new ToolRegistry();
    registry.register({
      id: "compute.run",
      title: "Compute",
      summary: "Evaluate an expression",
      arms: ["general"],
      effect: "read",
      risk: "low",
      inputSchema: z.object({ expression: z.string() }),
      run: async () => ({ ok: true, data: 1 }),
    } as never);
    const prompts: string[] = [];
    const run = (options: Record<string, unknown>) =>
      runAgentLoop({
        objective: "What is 6 * 7?",
        directives: directivesUnder(
          {
            strategyVersionId: null,
            label: "t",
            genome: { modelUse: { critique: "self_check" } },
            assignment: "trial",
          },
          "general",
        ),
        context: [],
        tools: registry,
        toolContext: {
          runId: "r",
          stageId: "s",
          armId: "general",
          organizationId: "o",
          workspaceId: "w",
        },
        decide: async (input) => {
          prompts.push(input.system);
          return { action: "FINISH", summary: "done", answer: "42" } as never;
        },
        ...options,
      });
    await run({});
    await run({
      promptStyle: "task_first",
      toolDescriptions: "summary_with_inputs",
    });
    expect(prompts[0]!.startsWith("You are OSIRUS")).toBe(true);
    expect(prompts[0]).not.toMatch(/\(input: expression\)/);
    expect(prompts[1]!.startsWith("Your task: What is 6 * 7?")).toBe(true);
    expect(prompts[1]).toMatch(
      /compute\.run: Evaluate an expression \(input: expression\)/,
    );
    expect(prompts[0]).toMatch(/re-derive the key result by a different route/);
  });

  it("offers model-usage hypotheses as prompt or model mechanisms", () => {
    const hypotheses = hypothesesFor(
      "math_science",
      [
        {
          kind: "verification",
          status: "open",
          summary: "s",
          support: 2,
        } as never,
      ],
      {},
      20,
    );
    const selfCheck = hypotheses.find(
      (entry) => entry.intervention.modelUse?.critique,
    );
    expect(selfCheck).toBeTruthy();
    expect(mechanismOf(selfCheck!)).toBe("prompt");
    expect(
      mechanismOf({
        intervention: { modelUse: { sampling: { temperature: 0.2 } } },
      }),
    ).toBe("model");
    expect(
      describeGenome({
        modelUse: { promptStyle: "task_first", critique: "self_check" },
      }),
    ).toBe("task-first prompt, self-check before finish");
  });
});

describe("a production arm uses the model as its strategy says", () => {
  it("passes sampling to every loop decision of a trial", async () => {
    const seen: unknown[] = [];
    const provider = {
      modelId: () => "scripted",
      structured: async <T>(input: {
        sampling?: unknown;
        validate: (value: unknown) => T;
      }) => {
        seen.push(input.sampling);
        return {
          value: input.validate({
            action: "FINISH",
            summary: "Answer",
            answer: "48 bottles.",
          }),
          usage: { inputTokens: 1, outputTokens: 1 },
        };
      },
      complete: async () => ({ text: "", usage: {} }),
      stream: async function* () {},
      capabilities: async () => ({}),
      healthCheck: async () => true,
      cancel: async () => undefined,
      normalizeUsage: () => ({}),
      normalizeError: () => new Error("x"),
    } as unknown as ModelProvider;
    const result = await runArenaTask(
      {
        id: "sampling",
        suite: "compound",
        objective: "How many bottles are in 4 crates of 12?",
        composition: ["general"],
        expect: {},
      },
      {
        provider,
        sandbox: async () => new LocalWorkspaceDriver(),
        policy: {
          strategyVersionId: null,
          label: "t",
          genome: { modelUse: { sampling: { temperature: 0.2 } } },
          assignment: "trial",
        },
      },
    );
    expect(result.status).toBe("completed");
    expect(seen).toContainEqual({ temperature: 0.2 });
  }, 60_000);
});
