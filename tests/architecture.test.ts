import { describe, expect, it } from "vitest";
import { pulseCatalog } from "../src/lib/agent/pulse/catalog";
import { runArenaTask } from "../src/lib/arena/harness";
import { architectComposition, composeWorkflow } from "../src/lib/arms/compose";
import { ARCHITECTURE_CHECKS } from "../src/lib/intelligence/architecture/checks";
import { mechanismOf } from "../src/lib/intelligence/meta/meta-policy";
import {
  describeGenome,
  exploratoryMutation,
  hypothesesFor,
} from "../src/lib/intelligence/strategies/genomes";
import type { ModelProvider } from "../src/lib/models/provider";
import { LocalWorkspaceDriver } from "../src/lib/sandbox/local";
import {
  architectureUnder,
  DEFAULT_ARCHITECTURE,
  genomeSchema,
} from "../src/lib/strategy/runtime";

describe("architecture as a Foundry candidate (M46)", () => {
  it("parses strictly and defaults to today's wiring", () => {
    expect(architectureUnder({ genome: {} })).toEqual(DEFAULT_ARCHITECTURE);
    expect(
      architectureUnder({ genome: { architecture: { memory: "late" } } })
        .memory,
    ).toBe("late");
    expect(() =>
      genomeSchema.parse({ architecture: { planning: "swarm" } }),
    ).toThrow();
  });

  it("changes the graph's shape, not only what happens in a stage", () => {
    const composition = architectComposition(["coding"], {
      ...DEFAULT_ARCHITECTURE,
      planning: "planner_executor",
      memory: "late",
    });
    expect(composition).toEqual(["thinking", "coding"]);
    const graph = composeWorkflow({
      objective: "x",
      composition,
      architecture: { ...DEFAULT_ARCHITECTURE, memory: "late" },
    }).graph;
    expect(graph.nodes[0]!.key).toMatch(/^s0-thinking-/);
    expect(
      graph.nodes.some((node) => node.input.stageKind === "retrieve_memory"),
    ).toBe(false);
    // Retrieval's dependant now depends on what retrieval depended on.
    const skills = graph.nodes.find(
      (node) => node.key === "s1-coding-select-skills",
    )!;
    expect(skills.dependsOn).toEqual(["s1-coding-understand"]);
    // The coding segment waits on the planner's verified contract.
    const first = graph.nodes.find(
      (node) => node.key === "s1-coding-understand",
    )!;
    expect(first.dependsOn).toEqual(["s0-thinking-verify"]);
  });

  it("holds every check the pulse runs hourly", async () => {
    for (const entry of ARCHITECTURE_CHECKS)
      expect(entry.check().held, entry.title).toBe(true);
    const specs = (await pulseCatalog()).filter(
      (spec) => spec.family === "ARCHITECTURE_SEARCH",
    );
    expect(specs.length).toBe(5);
    for (const spec of specs)
      expect(
        (await spec.run({ signal: new AbortController().signal })).outcome,
      ).toBe("VERIFIED_SUCCESS");
  });

  it("offers architecture hypotheses and counts them as their own mechanism", () => {
    const hypotheses = hypothesesFor(
      "coding",
      [{ kind: "planning", status: "open", summary: "s", support: 3 } as never],
      {},
      8,
    );
    const architecture = hypotheses.find(
      (entry) => entry.intervention.architecture,
    );
    expect(architecture?.intervention).toEqual({
      architecture: { planning: "planner_executor" },
    });
    expect(mechanismOf(architecture!)).toBe("architecture");
    expect(
      describeGenome({
        architecture: { planning: "planner_executor", memory: "late" },
      }),
    ).toBe("planner → executor, memory on demand");
    const explored = Array.from({ length: 40 }, (_, index) =>
      exploratoryMutation("coding", {}, `seed-${index}`),
    ).filter((entry) => entry?.intervention.architecture);
    expect(explored.length).toBeGreaterThan(0);
  });
});

/** Loop decisions from a script; team roles by request id. */
function scripted(decisions: unknown[], roles: Record<string, unknown> = {}) {
  let index = 0;
  let calls = 0;
  const provider = {
    modelId: () => "scripted",
    structured: async <T>(input: {
      requestId?: string;
      validate: (value: unknown) => T;
    }) => {
      calls += 1;
      const role = Object.keys(roles).find((key) =>
        input.requestId?.endsWith(`:${key}`),
      );
      if (role)
        return {
          value: input.validate(roles[role]),
          usage: { inputTokens: 10, outputTokens: 5 },
        };
      const next = decisions[Math.min(index, decisions.length - 1)];
      index += 1;
      return {
        value: input.validate(next),
        usage: { inputTokens: 10, outputTokens: 5 },
      };
    },
    complete: async () => {
      calls += 1;
      return { text: "Reviewed: the answer stands.", usage: {} };
    },
    stream: async function* () {},
    capabilities: async () => ({}),
    healthCheck: async () => true,
    cancel: async () => undefined,
    normalizeUsage: () => ({}),
    normalizeError: () => new Error("x"),
  } as unknown as ModelProvider;
  return { provider, calls: () => calls };
}

describe("champion vs challenger architecture on the same task and model", () => {
  const task = {
    id: "arch-compare",
    suite: "compound" as const,
    objective: "How many bottles are in 4 crates of 12?",
    composition: ["general" as const],
    expect: {},
  };
  const finish = [
    { action: "FINISH", summary: "Answer", answer: "There are 48 bottles." },
  ];

  it("runs both, with the graph each architecture claims", async () => {
    const champion = scripted(finish);
    const baseline = await runArenaTask(task, {
      provider: champion.provider,
      sandbox: async () => new LocalWorkspaceDriver(),
      policy: {
        strategyVersionId: null,
        label: "champion",
        genome: {},
        assignment: "trial",
      },
    });
    const challenger = scripted(finish);
    const late = await runArenaTask(task, {
      provider: challenger.provider,
      sandbox: async () => new LocalWorkspaceDriver(),
      policy: {
        strategyVersionId: null,
        label: "challenger",
        genome: { architecture: { memory: "late" } },
        assignment: "trial",
      },
    });
    expect(baseline.status).toBe("completed");
    expect(late.status).toBe("completed");
    expect(baseline.stages.some((stage) => /retrieve-memory/.test(stage))).toBe(
      true,
    );
    expect(late.stages.some((stage) => /retrieve-memory/.test(stage))).toBe(
      false,
    );
    expect(late.stages.length).toBe(baseline.stages.length - 1);
    expect(late.answerExcerpt).toMatch(/48 bottles/);
  }, 60_000);
});
