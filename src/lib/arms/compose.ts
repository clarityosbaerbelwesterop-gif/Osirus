import {
  defineNode,
  topologicalOrder,
  validateGraph,
  type WorkflowGraph,
  type WorkflowNode,
} from "../runtime/graph";
import { armFor } from "./registry";
import type {
  AcceptanceContract,
  ArmId,
  RoutingInput,
  TaskAnalysis,
} from "./types";

// Composing several arms into one run.
//
// A compound objective is not two runs. It is one graph in which a research
// segment's stages must settle before a building segment's stages become
// claimable, and one meta verification at the end that grades the whole thing
// against the contract. Composition happens here so the executor never needs
// to know how many arms are involved -- it claims stages and dispatches each
// to the arm named in its input.

export type ComposedWorkflow = {
  graph: WorkflowGraph;
  contract: AcceptanceContract;
  /** Node key to the arm that owns it. Mirrored into each node's input. */
  owners: Record<string, ArmId>;
};

function prefixed(index: number, armId: ArmId, key: string) {
  return `s${index}-${armId}-${key}`;
}

export function composeWorkflow(input: {
  objective: string;
  composition: ArmId[];
  analysis?: TaskAnalysis;
}): ComposedWorkflow {
  const composition = input.composition.length
    ? input.composition
    : (["general"] as ArmId[]);

  const nodes: WorkflowNode[] = [];
  const owners: Record<string, ArmId> = {};
  const criteria = new Set<string>();
  const evidence = new Set<string>();
  let previousTail: string[] = [];

  composition.forEach((armId, index) => {
    const arm = armFor(armId);
    const routing: RoutingInput = {
      objective: input.objective,
      capabilities: [],
      analysis: input.analysis,
    };
    const segment = arm.buildWorkflow(routing);
    const contract = arm.buildContract(routing);
    for (const criterion of contract.successCriteria) criteria.add(criterion);
    for (const item of contract.requiredEvidence) evidence.add(item);

    const order = topologicalOrder(segment);
    const tail = new Set(order);
    for (const node of segment.nodes) {
      for (const dependency of node.dependsOn) tail.delete(dependency);
    }

    for (const node of segment.nodes) {
      const key = prefixed(index, armId, node.key);
      owners[key] = armId;
      nodes.push(
        defineNode({
          ...node,
          key,
          dependsOn:
            node.dependsOn.length > 0
              ? node.dependsOn.map((dependency) =>
                  prefixed(index, armId, dependency),
                )
              : // The first node of a later segment waits on the previous
                // segment finishing, which is what makes "research, then
                // build" run in that order rather than in parallel.
                previousTail,
          input: {
            ...node.input,
            armId,
            segment: index,
            // Handoffs are only written between arms; a single-arm run has
            // no one to hand over to.
            ...(composition.length > 1 ? { composed: true } : {}),
          },
        }),
      );
    }
    previousTail = [...tail].map((key) => prefixed(index, armId, key));
  });

  if (composition.length > 1) {
    const key = "meta-verify";
    owners[key] = composition[composition.length - 1] ?? "general";
    nodes.push(
      defineNode({
        key,
        name: "Verify against the acceptance contract",
        capability: "general",
        dependsOn: previousTail,
        requiresVerification: true,
        input: {
          stageKind: "meta_verify",
          armId: owners[key],
          segment: composition.length,
        },
      }),
    );
  }

  const graph = { nodes };
  validateGraph(graph);

  return {
    graph,
    owners,
    contract: {
      objective: input.objective,
      successCriteria: input.analysis?.successCriteria ?? [...criteria],
      requiredEvidence: input.analysis?.requiredEvidence ?? [...evidence],
      outputFields: ["answer"],
      forbidden: [
        "claims of tool, test, source or deployment use that did not occur",
        "private chain-of-thought",
      ],
    },
  };
}
