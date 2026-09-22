import type { PipelineDefinition } from "../pipelines/definitions";
import type { Capability } from "./types";

// Workflow graph.
//
// run_stages.parent_stage_id is a single-parent tree, which cannot express a
// stage that waits on several predecessors. The graph is therefore defined here
// in terms of edges and persisted into osirus.run_stage_dependencies.
//
// Everything in this file is pure: no database, no clock, no randomness. That
// is deliberate -- CI has no DATABASE_URL, so DAG semantics have to be provable
// without a connection. Claiming and leasing are the parts that genuinely need
// Postgres, and those live in dispatch.ts.

export type FailurePolicy =
  "fail_run" | "block_run" | "skip_stage" | "continue";

export type WorkflowNode = {
  /** Stable within a graph; edges refer to nodes by key, not by index. */
  key: string;
  name: string;
  capability: Capability;
  dependsOn: string[];
  /**
   * maxAttempts bounds retries after a failure; maxSlices bounds how many
   * times a stage may yield and resume. Both are enforced in
   * osirus.claim_next_stage, not here, so a caller cannot opt out of them.
   */
  retryPolicy: { maxAttempts: number; maxSlices?: number };
  failurePolicy: FailurePolicy;
  requiresVerification: boolean;
  workerKind: string;
  input: Record<string, unknown>;
};

export type WorkflowGraph = { nodes: WorkflowNode[] };

export type NodeSpec = Partial<Omit<WorkflowNode, "key" | "name">> & {
  key: string;
  name: string;
};

export function defineNode(spec: NodeSpec): WorkflowNode {
  return {
    key: spec.key,
    name: spec.name,
    capability: spec.capability ?? "general",
    dependsOn: spec.dependsOn ?? [],
    retryPolicy: spec.retryPolicy ?? { maxAttempts: 1 },
    failurePolicy: spec.failurePolicy ?? "fail_run",
    requiresVerification: spec.requiresVerification ?? false,
    workerKind: spec.workerKind ?? "inline",
    input: spec.input ?? {},
  };
}

export class WorkflowGraphError extends Error {
  constructor(
    message: string,
    readonly code:
      "duplicate_node" | "unknown_dependency" | "self_dependency" | "cycle",
  ) {
    super(message);
    this.name = "WorkflowGraphError";
  }
}

/**
 * Reject a graph that cannot execute, before any of it reaches the database.
 *
 * A cycle is the important one: the claim function will simply never find those
 * stages runnable, so an unvalidated cycle becomes a run that hangs forever
 * with no error -- the worst possible failure mode to debug.
 */
export function validateGraph(graph: WorkflowGraph): void {
  const byKey = new Map<string, WorkflowNode>();
  for (const node of graph.nodes) {
    if (byKey.has(node.key)) {
      throw new WorkflowGraphError(
        `duplicate node key: ${node.key}`,
        "duplicate_node",
      );
    }
    byKey.set(node.key, node);
  }
  for (const node of graph.nodes) {
    for (const dependency of node.dependsOn) {
      if (dependency === node.key) {
        throw new WorkflowGraphError(
          `node depends on itself: ${node.key}`,
          "self_dependency",
        );
      }
      if (!byKey.has(dependency)) {
        throw new WorkflowGraphError(
          `node ${node.key} depends on unknown node ${dependency}`,
          "unknown_dependency",
        );
      }
    }
  }
  topologicalOrder(graph);
}

/**
 * Kahn's algorithm. Throws when a cycle leaves nodes that can never be reached.
 * Ties break on the graph's own declaration order so the result is stable.
 */
export function topologicalOrder(graph: WorkflowGraph): string[] {
  const remaining = new Map<string, Set<string>>(
    graph.nodes.map((node) => [node.key, new Set(node.dependsOn)]),
  );
  const order: string[] = [];
  const ordering = graph.nodes.map((node) => node.key);

  while (remaining.size > 0) {
    const ready = ordering.filter(
      (key) => remaining.get(key)?.size === 0 && !order.includes(key),
    );
    if (ready.length === 0) {
      throw new WorkflowGraphError(
        `cycle among: ${[...remaining.keys()].sort().join(", ")}`,
        "cycle",
      );
    }
    for (const key of ready) {
      order.push(key);
      remaining.delete(key);
      for (const dependencies of remaining.values()) dependencies.delete(key);
    }
  }
  return order;
}

/**
 * Nodes whose dependencies are all satisfied. This mirrors the SQL predicate in
 * osirus.claim_next_stage; keeping the two in step is what lets a test assert
 * scheduling order without a database.
 */
export function readyNodes(
  graph: WorkflowGraph,
  settled: ReadonlySet<string>,
): WorkflowNode[] {
  return graph.nodes.filter(
    (node) =>
      !settled.has(node.key) &&
      node.dependsOn.every((dependency) => settled.has(dependency)),
  );
}

/** Nodes that can run at the same time, in dependency layers. */
export function executionLayers(graph: WorkflowGraph): string[][] {
  const settled = new Set<string>();
  const layers: string[][] = [];
  while (settled.size < graph.nodes.length) {
    const layer = readyNodes(graph, settled).map((node) => node.key);
    if (layer.length === 0) {
      throw new WorkflowGraphError("cycle detected building layers", "cycle");
    }
    layers.push(layer);
    for (const key of layer) settled.add(key);
  }
  return layers;
}

export function sequential(nodes: NodeSpec[]): WorkflowGraph {
  const built = nodes.map((spec, index) =>
    defineNode({
      ...spec,
      dependsOn: spec.dependsOn ?? (index === 0 ? [] : [nodes[index - 1]!.key]),
    }),
  );
  const graph = { nodes: built };
  validateGraph(graph);
  return graph;
}

/** One node fanning out to many, then a single node gathering all of them. */
export function fanOutGather(input: {
  source: NodeSpec;
  branches: NodeSpec[];
  gather: NodeSpec;
}): WorkflowGraph {
  const source = defineNode(input.source);
  const branches = input.branches.map((spec) =>
    defineNode({ ...spec, dependsOn: spec.dependsOn ?? [source.key] }),
  );
  const gather = defineNode({
    ...input.gather,
    dependsOn: input.gather.dependsOn ?? branches.map((node) => node.key),
  });
  const graph = { nodes: [source, ...branches, gather] };
  validateGraph(graph);
  return graph;
}

/**
 * Today's pipeline is a straight chain, so this produces a DAG with one path.
 * That is deliberately enough to exercise the dependency machinery for real
 * without inventing a pipeline shape the product does not have yet.
 */
export function graphFromPipeline(
  pipeline: PipelineDefinition,
  input: Record<string, unknown> = {},
): WorkflowGraph {
  return sequential(
    pipeline.stages.map((stage, ordinal) => ({
      key: `${ordinal}:${stage.kind}`,
      name: stage.name,
      capability: stage.capability,
      requiresVerification: stage.kind === "verify",
      input: { ...input, stageKind: stage.kind, pipelineId: pipeline.id },
    })),
  );
}
