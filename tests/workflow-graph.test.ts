import { describe, expect, it } from "vitest";
import {
  WorkflowGraphError,
  defineNode,
  executionLayers,
  fanOutGather,
  graphFromPipeline,
  readyNodes,
  sequential,
  topologicalOrder,
  validateGraph,
} from "../src/lib/runtime/graph";
import { pipelineForCapabilities } from "../src/lib/pipelines/definitions";

describe("workflow graph validation", () => {
  it("rejects a cycle rather than producing a run that hangs forever", () => {
    // claim_next_stage never finds a cyclic stage runnable, so an unvalidated
    // cycle is a run that sits at 0% with no error. Fail at build time instead.
    const graph = {
      nodes: [
        defineNode({ key: "a", name: "A", dependsOn: ["c"] }),
        defineNode({ key: "b", name: "B", dependsOn: ["a"] }),
        defineNode({ key: "c", name: "C", dependsOn: ["b"] }),
      ],
    };
    expect(() => validateGraph(graph)).toThrow(WorkflowGraphError);
    expect(() => validateGraph(graph)).toThrow(/cycle among: a, b, c/);
  });

  it("rejects an edge to a node that does not exist", () => {
    const graph = {
      nodes: [defineNode({ key: "a", name: "A", dependsOn: ["ghost"] })],
    };
    expect(() => validateGraph(graph)).toThrow(/unknown node ghost/);
  });

  it("rejects a self edge and a duplicate key", () => {
    expect(() =>
      validateGraph({
        nodes: [defineNode({ key: "a", name: "A", dependsOn: ["a"] })],
      }),
    ).toThrow(/depends on itself/);
    expect(() =>
      validateGraph({
        nodes: [
          defineNode({ key: "a", name: "A" }),
          defineNode({ key: "a", name: "A again" }),
        ],
      }),
    ).toThrow(/duplicate node key/);
  });
});

describe("scheduling order", () => {
  it("chains a sequential graph so each stage waits for the previous one", () => {
    const graph = sequential([
      { key: "one", name: "One" },
      { key: "two", name: "Two" },
      { key: "three", name: "Three" },
    ]);
    expect(graph.nodes.map((n) => n.dependsOn)).toEqual([[], ["one"], ["two"]]);
    expect(executionLayers(graph)).toEqual([["one"], ["two"], ["three"]]);
  });

  it("runs fan-out branches in one layer and gathers them in the next", () => {
    const graph = fanOutGather({
      source: { key: "plan", name: "Plan" },
      branches: [
        { key: "left", name: "Left" },
        { key: "right", name: "Right" },
      ],
      gather: { key: "merge", name: "Merge" },
    });
    expect(executionLayers(graph)).toEqual([
      ["plan"],
      ["left", "right"],
      ["merge"],
    ]);
  });

  it("holds a gather node until every branch has settled", () => {
    const graph = fanOutGather({
      source: { key: "plan", name: "Plan" },
      branches: [
        { key: "left", name: "Left" },
        { key: "right", name: "Right" },
      ],
      gather: { key: "merge", name: "Merge" },
    });
    const afterOneBranch = readyNodes(graph, new Set(["plan", "left"]));
    expect(afterOneBranch.map((n) => n.key)).toEqual(["right"]);

    const afterBothBranches = readyNodes(
      graph,
      new Set(["plan", "left", "right"]),
    );
    expect(afterBothBranches.map((n) => n.key)).toEqual(["merge"]);
  });

  it("treats a skipped dependency as settled, matching the claim predicate", () => {
    // osirus.claim_next_stage accepts a predecessor in 'completed' OR 'skipped'.
    // readyNodes models settlement the same way, so the two cannot drift.
    const graph = sequential([
      { key: "one", name: "One" },
      { key: "two", name: "Two" },
    ]);
    expect(readyNodes(graph, new Set(["one"])).map((n) => n.key)).toEqual([
      "two",
    ]);
  });

  it("orders a diamond so the join comes last", () => {
    const graph = {
      nodes: [
        defineNode({ key: "a", name: "A" }),
        defineNode({ key: "b", name: "B", dependsOn: ["a"] }),
        defineNode({ key: "c", name: "C", dependsOn: ["a"] }),
        defineNode({ key: "d", name: "D", dependsOn: ["b", "c"] }),
      ],
    };
    expect(topologicalOrder(graph)).toEqual(["a", "b", "c", "d"]);
  });
});

describe("pipeline conversion", () => {
  it("turns the existing pipeline into a chained graph", () => {
    const pipeline = pipelineForCapabilities(["research", "coding"]);
    const graph = graphFromPipeline(pipeline, { objective: "probe" });
    expect(graph.nodes).toHaveLength(pipeline.stages.length);
    expect(graph.nodes[0]!.dependsOn).toEqual([]);
    expect(executionLayers(graph)).toHaveLength(pipeline.stages.length);
    // The verify stage is the one that must be independently checked.
    const verify = graph.nodes.filter((n) => n.requiresVerification);
    expect(verify).toHaveLength(1);
    expect(verify[0]!.key).toMatch(/verify$/);
  });

  it("defaults every node to a single attempt and a run-failing policy", () => {
    const node = defineNode({ key: "a", name: "A" });
    expect(node.retryPolicy).toEqual({ maxAttempts: 1 });
    expect(node.failurePolicy).toBe("fail_run");
    expect(node.requiresVerification).toBe(false);
  });
});
