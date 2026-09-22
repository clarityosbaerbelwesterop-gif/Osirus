import { describe, expect, it } from "vitest";
import { armFor } from "../src/lib/arms/registry";
import { composeWorkflow } from "../src/lib/arms/compose";
import type { ArmId, ArmStageContext } from "../src/lib/arms/types";
import { routeObjective } from "../src/lib/runtime/router-v2";
import { topologicalOrder, validateGraph } from "../src/lib/runtime/graph";
import type { VerdictStatus } from "../src/lib/verification/engine";

// The golden tasks.
//
// Each one drives the real path an objective takes -- route, compose, validate
// the graph, then run the arm's own verification over a supplied answer. What
// is faked is exactly one thing, at one boundary: the model. Everything the
// engine decides is the production code.
//
// That boundary is why no test here asserts a *model-dependent* pass. The
// assertions are about the routing, the shape of the plan, and what the
// verifier concludes from evidence the engine can check itself. A golden task
// run against a real model belongs on a deployed preview, and its result is
// reported from there, never inferred from these.

type Golden = {
  name: string;
  objective: string;
  expectedArm: ArmId;
  expectedComposition?: ArmId[];
  /** An answer of the shape the arm asks for. */
  goodAnswer: string;
  /** The same answer with one thing wrong that the arm must catch. */
  badAnswer: string;
  expectedGood: VerdictStatus;
  expectedBad: VerdictStatus;
};

function contextFor(objective: string, state: Record<string, unknown>) {
  return {
    identity: {
      userId: "u",
      organizationId: "o",
      workspaceId: "w",
    },
    work: {
      attemptId: "a",
      leaseToken: "t",
      leaseExpiresAt: new Date().toISOString(),
      attemptNumber: 1,
      sliceCount: 0,
      handoff: {},
      runId: "11111111-1111-4111-8111-111111111111",
      stageId: "22222222-2222-4222-8222-222222222222",
      organizationId: "o",
      workspaceId: "w",
      sessionId: "s",
      requestedBy: "u",
      objective,
      stageName: "verify",
      capability: "general",
      ordinal: 0,
      stageInput: { stageKind: "verify" },
      requiresVerification: true,
    },
    runtime: {
      // The one fake, at the one boundary this environment cannot reach.
      provider: {
        structured: async () => ({
          value: { verdict: "pass", reason: "reads as complete" },
          usage: {},
        }),
      },
    },
    state,
  } as unknown as ArmStageContext;
}

const goldens: Golden[] = [
  {
    name: "Thinking: plan a migration",
    objective:
      "Analyse how we should approach migrating the claim function to a queue, and decide the trade-offs",
    expectedArm: "thinking",
    goodAnswer:
      "The migration keeps every claim atomic and the rollout stays reversible at each step. Atomic claims are preserved by keeping the stored function; the rollout is reversible because each step is additive.",
    badAnswer: "It depends on several factors worth weighing carefully.",
    expectedGood: "verified",
    expectedBad: "rejected",
  },
  {
    name: "Coding: produce a function",
    objective: "Write a TypeScript function that adds two numbers, with a test",
    expectedArm: "coding",
    goodAnswer:
      "`src/add.ts`:\n\n```ts\nexport const add = (a: number, b: number) => a + b;\n```\n\nI did not run the tests; no sandbox was available.",
    badAnswer: "Add the two numbers together and return the result.",
    // Tests and build are required and could not run here, so the ceiling is
    // unverified. That is the honest answer for code nobody executed.
    expectedGood: "unverified",
    expectedBad: "rejected",
  },
  {
    name: "Research: answer with sources",
    objective:
      "Research what the current guidance says about Postgres advisory locks and cite your sources",
    expectedArm: "research",
    goodAnswer:
      "This answer is unsourced: no documents were retrieved in this run, so the claims below are not backed by a source I fetched.",
    badAnswer:
      "According to https://invented.example/postgres-locks, advisory locks are session scoped.",
    expectedGood: "verified",
    expectedBad: "rejected",
  },
  {
    name: "Math: compute a result",
    objective: "Calculate the total and show your working",
    expectedArm: "math_science",
    goodAnswer:
      "Step one: 12 * 12 = 144. Step two: 144 + 6 = 150.\n\nResult: 150 units",
    badAnswer:
      "Step one: 12 * 12 = 145. Step two: 145 + 6 = 151.\n\nResult: 151 units",
    // Right arithmetic, but nothing was computed: the numbers are asserted.
    // The computed-result check is required, so the ceiling is unverified.
    expectedGood: "unverified",
    expectedBad: "rejected",
  },
  {
    name: "Building: produce a deliverable",
    objective:
      "Draft a specification document covering the rollout plan and the risks",
    expectedArm: "building",
    goodAnswer:
      "# Rollout specification\n\n## Rollout plan\nThe rollout proceeds in three additive steps, each independently reversible.\n\n## Risks\nThe main risk is a partial migration leaving two claim paths live at once.\n\n## Mitigation\nEach step ships behind the existing claim function.",
    badAnswer: "We will roll it out and watch for problems.",
    expectedGood: "verified",
    expectedBad: "rejected",
  },
];

describe.each(goldens)("$name", (golden) => {
  it("routes to the expected arm", async () => {
    const decision = await routeObjective(golden.objective);
    expect(decision.primary).toBe(golden.expectedArm);
    if (golden.expectedComposition) {
      expect(decision.composition).toEqual(golden.expectedComposition);
    }
  });

  it("produces a valid, ordered plan", async () => {
    const decision = await routeObjective(golden.objective);
    const composed = composeWorkflow({
      objective: golden.objective,
      composition: decision.composition,
    });
    expect(() => validateGraph(composed.graph)).not.toThrow();
    const order = topologicalOrder(composed.graph);
    expect(order.length).toBe(composed.graph.nodes.length);
    expect(order[order.length - 1]).toMatch(/verify/);
  });

  it("accepts a correct answer at the level the evidence supports", async () => {
    const arm = armFor(golden.expectedArm);
    const verdict = await arm.verify(
      contextFor(golden.objective, {
        answer: golden.goodAnswer,
        analysis:
          golden.expectedArm === "thinking"
            ? {
                successCriteria: [
                  "Every claim stays atomic",
                  "The rollout is reversible",
                ],
                complexity: "medium",
                risk: "medium",
                proposedStages: [{ key: "a", name: "A" }],
              }
            : undefined,
        outline:
          golden.expectedArm === "building"
            ? ["Rollout plan", "Risks"]
            : undefined,
      }),
    );
    expect(verdict.status, verdict.summary).toBe(golden.expectedGood);
  });

  it("rejects an answer with something actually wrong in it", async () => {
    const arm = armFor(golden.expectedArm);
    const verdict = await arm.verify(
      contextFor(golden.objective, {
        answer: golden.badAnswer,
        analysis:
          golden.expectedArm === "thinking"
            ? {
                successCriteria: [
                  "Every claim stays atomic",
                  "The rollout is reversible",
                ],
                complexity: "medium",
                risk: "medium",
                proposedStages: [{ key: "a", name: "A" }],
              }
            : undefined,
        outline:
          golden.expectedArm === "building"
            ? ["Rollout plan", "Risks"]
            : undefined,
      }),
    );
    expect(verdict.status, verdict.summary).toBe(golden.expectedBad);
  });
});

describe("math verified from computation, not assertion", () => {
  const computed = [
    {
      toolId: "compute.run",
      ok: true,
      input: { op: "evaluate", expression: "12 * 12 + 6" },
      data: {
        result: { op: "evaluate", ok: true, value: 150, text: "150" },
        check: { agrees: true, method: "python-sympy" },
      },
    },
  ];

  it("verifies a result the engine produced and a second method confirmed", async () => {
    const verdict = await armFor("math_science").verify(
      contextFor("Calculate the total and show your working", {
        answer:
          "Step one: 12 * 12 = 144. Step two: 144 + 6 = 150.\n\nResult: 150 units",
        toolEvidence: computed,
      }),
    );
    expect(verdict.status, verdict.summary).toBe("verified");
  });

  it("rejects a stated result no computation produced", async () => {
    const verdict = await armFor("math_science").verify(
      contextFor("Calculate the total and show your working", {
        answer:
          "Step one: 12 * 12 = 144. Step two: 144 + 7 = 151.\n\nResult: 151 units",
        toolEvidence: computed,
      }),
    );
    expect(verdict.status).toBe("rejected");
  });

  it("rejects a result whose independent check disagreed", async () => {
    const verdict = await armFor("math_science").verify(
      contextFor("Calculate", {
        answer: "Result: 150",
        toolEvidence: [
          {
            ...computed[0],
            data: {
              ...computed[0]!.data,
              check: { agrees: false, method: "substitution" },
            },
          },
        ],
      }),
    );
    expect(verdict.status).toBe("rejected");
  });
});

describe("compound golden task", () => {
  it("composes research and building, in that order, with one meta check", async () => {
    const decision = await routeObjective(
      "Research how competitors document their rollout process, then draft a specification document covering our own rollout plan and risks",
    );
    expect(decision.composition).toEqual(["research", "building"]);

    const composed = composeWorkflow({
      objective: "compound",
      composition: decision.composition,
    });
    const order = topologicalOrder(composed.graph);
    expect(order[order.length - 1]).toBe("meta-verify");
    expect(
      order.findIndex((key) => key.startsWith("s1-building")),
    ).toBeGreaterThan(order.findIndex((key) => key === "s0-research-verify"));
  });
});
