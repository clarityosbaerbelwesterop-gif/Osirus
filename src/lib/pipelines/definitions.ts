import type { Capability } from "../runtime/types";

export type PipelineStageKind =
  | "understand"
  | "ground_task"
  | "decompose_question"
  | "parse_problem"
  | "inspect_data_objective"
  | "retrieve_memory"
  | "select_skills"
  | "plan"
  | "execute"
  | "verify";

export type PipelineStageDefinition = {
  kind: PipelineStageKind;
  name: string;
  capability: Capability;
};

export type PipelineDefinition = {
  id: string;
  capabilities: Capability[];
  stages: PipelineStageDefinition[];
};

const capabilityPreparation: Record<Capability, PipelineStageDefinition> = {
  general: {
    kind: "understand",
    name: "Understand objective",
    capability: "general",
  },
  coding: {
    kind: "ground_task",
    name: "Ground coding task",
    capability: "coding",
  },
  research: {
    kind: "decompose_question",
    name: "Decompose research question",
    capability: "research",
  },
  math_science: {
    kind: "parse_problem",
    name: "Parse math or science problem",
    capability: "math_science",
  },
  data: {
    kind: "inspect_data_objective",
    name: "Inspect data objective",
    capability: "data",
  },
  multimodal: {
    kind: "understand",
    name: "Understand multimodal objective",
    capability: "multimodal",
  },
  computer_use: {
    kind: "understand",
    name: "Understand computer-use objective",
    capability: "computer_use",
  },
};

export function pipelineForCapabilities(
  requestedCapabilities: Capability[],
): PipelineDefinition {
  const capabilities = [
    ...new Set(
      requestedCapabilities.length
        ? requestedCapabilities
        : (["general"] as Capability[]),
    ),
  ];
  const primary = capabilities[0] ?? "general";
  const preparation = capabilities.map(
    (capability) => capabilityPreparation[capability],
  );
  const shared: PipelineStageDefinition[] = [
    {
      kind: "retrieve_memory",
      name: "Retrieve relevant context",
      capability: primary,
    },
    {
      kind: "select_skills",
      name: "Select progressive skills",
      capability: primary,
    },
    { kind: "plan", name: "Prepare execution plan", capability: primary },
    { kind: "execute", name: "Execute response", capability: primary },
    { kind: "verify", name: "Verify response contract", capability: primary },
  ];

  return {
    id: `${capabilities.join("+")}:v1`,
    capabilities,
    stages: [...preparation, ...shared],
  };
}
