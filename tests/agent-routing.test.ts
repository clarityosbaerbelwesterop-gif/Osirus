import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { composeWorkflow } from "../src/lib/arms/compose";
import { armFor, routableArms } from "../src/lib/arms/registry";
import type { TaskAnalysis } from "../src/lib/arms/types";
import {
  ambiguityOf,
  capabilitiesFor,
  routeObjective,
  scoreCandidates,
  segmentObjective,
} from "../src/lib/runtime/router-v2";
import {
  executionLayers,
  topologicalOrder,
  validateGraph,
} from "../src/lib/runtime/graph";

describe("capability routing", () => {
  it("scores every routable arm rather than returning one winner", () => {
    const candidates = scoreCandidates("Fix the failing TypeScript build");
    expect(candidates).toHaveLength(routableArms().length);
    expect(candidates[0]?.armId).toBe("coding");
    // The point of scores: the runner-up is visible, so ambiguity is
    // measurable instead of being hidden behind a first match.
    expect(candidates[0]!.score).toBeGreaterThan(candidates[1]!.score);
  });

  it("routes a maths problem to the maths arm", () => {
    expect(
      scoreCandidates("Solve the integral and calculate the result")[0]?.armId,
    ).toBe("math_science");
  });

  it("calls a weak match ambiguous instead of answering confidently", () => {
    const objective = "hmm";
    expect(ambiguityOf(objective, scoreCandidates(objective))).toBe(
      "low_confidence",
    );
  });

  it("splits a compound objective on sequencing connectives", () => {
    const segments = segmentObjective(
      "Research the current Postgres lease patterns, then implement the claim function in TypeScript",
    );
    expect(segments).toHaveLength(2);
    expect(segments[0]).toMatch(/^Research/);
  });

  it("composes a compound objective into several arms in order", async () => {
    const decision = await routeObjective(
      "Research how Postgres advisory locks behave under contention, then implement the claim function in TypeScript with tests",
    );
    expect(decision.composition).toEqual(["research", "coding"]);
    expect(decision.escalated).toBe(false);
    expect(decision.capabilities).toEqual(["research", "coding"]);
  });

  it("does not spend a model call when the heuristics are already sure", async () => {
    let called = 0;
    await routeObjective("Fix the failing TypeScript build and add a test", {
      classify: async () => {
        called += 1;
        throw new Error("should not be reached");
      },
    });
    expect(called).toBe(0);
  });

  it("escalates to structured classification when the scores are ambiguous", async () => {
    const analysis: TaskAnalysis = {
      objective: "unclear",
      successCriteria: ["Something checkable"],
      constraints: [],
      unknowns: [],
      capabilities: ["research"],
      complexity: "medium",
      risk: "low",
      requiredEvidence: ["SOURCE"],
      proposedStages: [
        { key: "a", name: "A", capability: "research", dependsOn: [] },
      ],
      parallelGroups: [],
      verifierRequirements: [],
    };
    const decision = await routeObjective("hmm", {
      classify: async () => analysis,
    });
    expect(decision.escalated).toBe(true);
    expect(decision.primary).toBe("research");
  });

  it("falls back to the heuristic route when classification fails", async () => {
    // A classifier outage must degrade routing, never fail the run.
    const decision = await routeObjective("hmm", {
      classify: async () => {
        throw new Error("provider down");
      },
    });
    expect(decision.escalated).toBe(false);
    expect(decision.primary).toBeTruthy();
    expect(decision.reason).toMatch(/Classification failed/);
  });

  it("maps arms back to capabilities without duplicates", () => {
    expect(capabilitiesFor(["building", "general"])).toEqual(["general"]);
  });
});

describe("workflow composition", () => {
  it("builds one valid graph for a single arm", () => {
    const composed = composeWorkflow({
      objective: "Write a function",
      composition: ["coding"],
    });
    expect(() => validateGraph(composed.graph)).not.toThrow();
    const order = topologicalOrder(composed.graph);
    expect(order[0]).toContain("understand");
    expect(order[order.length - 1]).toContain("verify");
  });

  it("chains segments so a later arm waits on the earlier one", () => {
    const composed = composeWorkflow({
      objective: "Research then build",
      composition: ["research", "building"],
    });
    validateGraph(composed.graph);

    const layers = executionLayers(composed.graph);
    const layerOf = (predicate: (key: string) => boolean) =>
      layers.findIndex((layer) => layer.some(predicate));

    const researchVerify = layerOf((key) => key === "s0-research-verify");
    const buildingStart = layerOf((key) => key === "s1-building-understand");
    expect(researchVerify).toBeGreaterThanOrEqual(0);
    expect(buildingStart).toBeGreaterThan(researchVerify);
  });

  it("adds one meta verification at the end of a compound run", () => {
    const composed = composeWorkflow({
      objective: "Research then build",
      composition: ["research", "building"],
    });
    const meta = composed.graph.nodes.find(
      (node) => node.key === "meta-verify",
    );
    expect(meta).toBeDefined();
    expect(meta?.dependsOn).toContain("s1-building-verify");
    expect(
      composeWorkflow({
        objective: "x",
        composition: ["coding"],
      }).graph.nodes.map((node) => node.key),
    ).not.toContain("meta-verify");
  });

  it("names the owning arm on every node so the worker can dispatch", () => {
    const composed = composeWorkflow({
      objective: "Research then build",
      composition: ["research", "building"],
    });
    for (const node of composed.graph.nodes) {
      expect(node.input.armId).toBeTruthy();
      expect(composed.owners[node.key]).toBe(node.input.armId);
    }
  });

  it("carries the analysis success criteria into the acceptance contract", () => {
    const composed = composeWorkflow({
      objective: "Do the thing",
      composition: ["general"],
      analysis: {
        objective: "Do the thing",
        successCriteria: ["The thing is done", "It is measurable"],
        constraints: [],
        unknowns: [],
        capabilities: ["general"],
        complexity: "low",
        risk: "low",
        requiredEvidence: ["STRUCTURE"],
        proposedStages: [
          { key: "a", name: "A", capability: "general", dependsOn: [] },
        ],
        parallelGroups: [],
        verifierRequirements: [],
      },
    });
    expect(composed.contract.successCriteria).toEqual([
      "The thing is done",
      "It is measurable",
    ]);
  });

  it("defaults to the general arm when nothing was composed", () => {
    const composed = composeWorkflow({ objective: "x", composition: [] });
    expect(
      composed.graph.nodes.every((node) => node.input.armId === "general"),
    ).toBe(true);
  });
});

describe("arm workflows", () => {
  it("gives the thinking arm an analysis stage before it answers", () => {
    const graph = armFor("thinking").buildWorkflow({
      objective: "Plan a migration",
      capabilities: [],
    });
    expect(topologicalOrder(graph)).toEqual(["analyse", "answer", "verify"]);
  });

  it("requires the answering stage to be verified in every arm", () => {
    for (const arm of routableArms()) {
      const graph = arm.buildWorkflow({ objective: "x", capabilities: [] });
      const answer = graph.nodes.find((node) => node.key === "answer");
      expect(answer?.requiresVerification, arm.id).toBe(true);
    }
  });

  it("bounds every stage's retries and slices", () => {
    for (const arm of routableArms()) {
      for (const node of arm.buildWorkflow({ objective: "x", capabilities: [] })
        .nodes) {
        expect(
          node.retryPolicy.maxAttempts,
          `${arm.id}:${node.key}`,
        ).toBeGreaterThanOrEqual(1);
        expect(node.retryPolicy.maxAttempts).toBeLessThanOrEqual(3);
      }
    }
  });
});

describe("compound run completion", () => {
  it("gives the meta verification stage a handler in every arm", () => {
    // compose.ts appends a meta_verify node to every compound run. Without a
    // handler the stage falls through to the unhandled branch and fails the
    // run at the last step, after all the real work is already done.
    const composed = composeWorkflow({
      objective: "Research then build",
      composition: ["research", "building"],
    });
    const meta = composed.graph.nodes.find(
      (node) => node.key === "meta-verify",
    );
    expect(meta?.input.stageKind).toBe("meta_verify");

    const source = readFileSync(
      join(process.cwd(), "src", "lib", "arms", "base.ts"),
      "utf8",
    );
    expect(source).toContain('case "meta_verify":');
    expect(source).toContain("metaVerifyStage");
  });

  it("grades every segment's answer, not only the last one", () => {
    const source = readFileSync(
      join(process.cwd(), "src", "lib", "arms", "base.ts"),
      "utf8",
    );
    expect(source).toContain('readState<string[]>(context, "answers", [])');
    const worker = readFileSync(
      join(process.cwd(), "src", "lib", "runtime", "worker.ts"),
      "utf8",
    );
    // The accumulated answers have to survive a checkpoint, or a run picked up
    // by another worker grades against whatever one segment produced.
    expect(worker).toContain('"answers"');
  });
});
