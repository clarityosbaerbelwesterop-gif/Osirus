import type { CapabilityArm, ModelProgram } from "./types";

function arm(
  id: string,
  hypothesis: string,
  grader: CapabilityArm["task"]["grader"],
  sample: { input: string; target: string },
): CapabilityArm {
  return {
    id,
    dataset: {
      id: `${id.toLowerCase()}-fixture-v1`,
      version: "v1",
      samples: [{ id: `${id}-s1`, ...sample }],
    },
    task: { id: `${id}-task`, instruction: hypothesis, grader },
    training: {
      executable: false,
      note: "Arm training is not authorized. The CPU fixture is not this arm.",
    },
    metadata: { status: "untrained", hypothesis },
  };
}

/**
 * DARUS model program. Broad routed decoder.
 * The two-expert fixture executes. The planned model is not trained.
 */
export const darusProgram: ModelProgram = {
  id: "darus",
  displayName: "DARUS",
  nativeModelId: "osirus/darus-1",
  summary:
    "Broad model for cross-domain synthesis. Constructed as a routed dense decoder with two tiny experts in the fixture. Not trained. Served by API fallback until a validated native checkpoint is online.",
  architecture: {
    id: "darus-routed-dense-v1",
    version: "v1-planned",
    family: "routed-dense",
    plannedLayers: 32,
    plannedHidden: 2560,
    plannedHeads: 20,
    plannedKvHeads: 5,
    plannedContext: 32768,
    precision: "bf16-planned",
    fixture: {
      family: "routed-dense",
      vocab: 8,
      dim: 4,
      heads: 2,
      kvHeads: 1,
      ffn: 8,
      experts: 2,
      context: 8,
      precision: "fp64-fixture",
    },
    notes:
      "Token embeddings, RMSNorm, causal attention, softmax router over two experts, output head. Routing in the fixture is real arithmetic, not a claim about a trained mixture-of-experts model.",
  },
  tokenizer: {
    id: "darus-bpe",
    version: "0.0.0-untrained",
    family: "byte-level-bpe",
    vocabSize: 64000,
  },
  mixture: {
    id: "darus-mix",
    version: "v1",
    parts: [
      {
        source: "fixture-authored-reasoning",
        fraction: 0.4,
        license: "fixture-authored",
      },
      {
        source: "fixture-authored-code",
        fraction: 0.25,
        license: "fixture-authored",
      },
      {
        source: "fixture-authored-science",
        fraction: 0.2,
        license: "fixture-authored",
      },
      {
        source: "fixture-authored-plans",
        fraction: 0.15,
        license: "fixture-authored",
      },
    ],
  },
  curriculum: [
    {
      id: "darus-breadth",
      order: 0,
      objective: "mixed authored fixtures",
      executable: false,
    },
    {
      id: "darus-route",
      order: 1,
      objective: "router fixture only",
      executable: true,
    },
  ],
  training: {
    optimizer: "adamw-planned",
    scheduler: "cosine-planned",
    batch: 1,
    gradAccum: 1,
    precision: "bf16-planned",
    seqLen: 8,
    checkpointIntervalSteps: 1,
    evalIntervalSteps: 1,
    resume: "parentId-lineage",
    failureRecovery: "restore-last-json-checkpoint",
    artifactUpload: "not-configured",
    experimentId: "darus-fixture-exp-001",
    seed: 8301,
    datasetVersion: "v1",
    architectureVersion: "v1-planned",
    executable: "tiny-cpu-fixture",
    trainingReady: false,
  },
  objectives: [
    {
      id: "darus-no-trained-claim",
      statement: "Never label an API answer as a Darus checkpoint.",
    },
    {
      id: "darus-hypothesis",
      statement:
        "Cross-domain synthesis stays a hypothesis until an independent eval exists.",
    },
  ],
  arms: [
    arm(
      "DARUS_REASONING",
      "Short reasoning fixtures are exact strings, not a measured proof.",
      "exact",
      { input: "reasoning", target: "reasoning" },
    ),
    arm(
      "DARUS_MATH",
      "Math fixtures stay exact. No benchmark score is claimed.",
      "exact",
      { input: "math", target: "math" },
    ),
    arm(
      "DARUS_SCIENCE",
      "Science items are authored fixtures, not a paper result.",
      "exact",
      { input: "science", target: "science" },
    ),
    arm(
      "DARUS_CODING",
      "Coding on Darus is a breadth hypothesis, not Quasnir's specialist path.",
      "exact",
      { input: "coding", target: "coding" },
    ),
    arm(
      "DARUS_RESEARCH",
      "Research records a source id. It does not browse in this fixture.",
      "exact",
      { input: "research", target: "research" },
    ),
    arm(
      "DARUS_PLANNING",
      "Planning lists a step id and does not execute the plan.",
      "exact",
      { input: "planning", target: "planning" },
    ),
    arm(
      "DARUS_LONG_CONTEXT",
      "Long context is a planned window, not a measured one.",
      "exact",
      { input: "long_context", target: "long_context" },
    ),
    arm(
      "DARUS_MEMORY",
      "Memory here is a hypothesis, not the product memory store.",
      "exact",
      { input: "memory", target: "memory" },
    ),
    arm(
      "DARUS_TOOL_REASONING",
      "Tool reasoning names a tool id. It does not call tools.",
      "exact",
      { input: "tool_reasoning", target: "tool_reasoning" },
    ),
    arm(
      "DARUS_WORLD_MODEL",
      "World-model arm is an explicit hypothesis, not a trained dynamics model.",
      "exact",
      { input: "world_model", target: "world_model" },
    ),
    arm(
      "DARUS_MULTIMODAL",
      "Multimodal arm has no encoder in the CPU fixture.",
      "exact",
      { input: "multimodal", target: "multimodal" },
    ),
    arm(
      "DARUS_VERIFICATION",
      "Verification prefers an independent judge over a self-score.",
      "exact",
      { input: "verification", target: "verification" },
    ),
    arm(
      "DARUS_STRATEGY",
      "Strategy is a hypothesis about later planning, not a result.",
      "exact",
      { input: "strategy", target: "strategy" },
    ),
  ],
  evalSuite: {
    id: "darus-program-eval",
    measured: false,
    tasks: ["DARUS_REASONING", "DARUS_VERIFICATION"],
  },
  research: {
    loopId: "DARUS_LOOP",
    hypotheses: [
      "A routed decoder may cover broader tasks later. This is not a result.",
      "Tool reasoning and a world model are research areas, not shipped capabilities.",
    ],
  },
  ui: {
    selectorLabel: "DARUS",
    fallbackLabel: "DARUS · API fallback",
    activities: [
      "deep_reasoning",
      "cross_domain_synthesis",
      "research",
      "planning",
      "waiting",
      "api_fallback",
      "native_inference",
    ],
  },
  fallback: {
    envVar: "LAB_FALLBACK_MODEL_DARUS",
    defaultModelId: "gemini-3.6-flash:free",
    catalogRole: "research",
  },
};
