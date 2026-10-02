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
 * Rouge 1 model program. The planned decoder is not trained.
 * `architecture.fixture` is the only part that executes.
 */
export const rougeProgram: ModelProgram = {
  id: "rouge",
  displayName: "ROUGE 1",
  nativeModelId: "osirus/rouge-1",
  summary:
    "General model for reasoning, research, and verification. Constructed as a dense decoder with RoPE. Not trained. Served by API fallback until a validated native checkpoint is online.",
  architecture: {
    id: "rouge-dense-rope-v1",
    version: "v1-planned",
    family: "dense-rope",
    plannedLayers: 24,
    plannedHidden: 2048,
    plannedHeads: 16,
    plannedKvHeads: 4,
    plannedContext: 16384,
    precision: "bf16-planned",
    fixture: {
      family: "dense-rope",
      vocab: 8,
      dim: 4,
      heads: 2,
      kvHeads: 1,
      ffn: 8,
      experts: 1,
      context: 8,
      precision: "fp64-fixture",
    },
    notes:
      "Sequence model: token embeddings, RoPE, RMSNorm, causal attention, SwiGLU-style ReLU FFN stand-in, output head. Memory is the residual stream of the fixture, not a product memory store.",
  },
  tokenizer: {
    id: "rouge-bpe",
    version: "0.0.0-untrained",
    family: "byte-level-bpe",
    vocabSize: 32000,
  },
  mixture: {
    id: "rouge-mix",
    version: "v1",
    parts: [
      {
        source: "fixture-authored-reasoning",
        fraction: 0.4,
        license: "fixture-authored",
      },
      {
        source: "fixture-authored-code",
        fraction: 0.3,
        license: "fixture-authored",
      },
      {
        source: "fixture-authored-prose",
        fraction: 0.3,
        license: "fixture-authored",
      },
    ],
  },
  curriculum: [
    {
      id: "rouge-pretrain",
      order: 0,
      objective: "next-token on the versioned mixture",
      executable: false,
    },
    {
      id: "rouge-reason",
      order: 1,
      objective: "short reasoning items with exact targets",
      executable: false,
    },
    {
      id: "rouge-fixture",
      order: 2,
      objective: "CPU decoder fixture only",
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
    experimentId: "rouge-fixture-exp-001",
    seed: 5601,
    datasetVersion: "v1",
    architectureVersion: "v1-planned",
    executable: "tiny-cpu-fixture",
    trainingReady: false,
  },
  objectives: [
    {
      id: "rouge-no-trained-claim",
      statement: "Never label an API answer as a Rouge checkpoint.",
    },
    {
      id: "rouge-cite-route",
      statement: "Every answer carries native or api_fallback provenance.",
    },
  ],
  arms: [
    arm(
      "ROUGE_REASONING",
      "Short entailment can be graded by exact match on fixtures.",
      "exact",
      { input: "yes", target: "yes" },
    ),
    arm(
      "ROUGE_MATH",
      "Arithmetic fixtures are graded by exact numeric strings.",
      "exact",
      { input: "2", target: "2" },
    ),
    arm(
      "ROUGE_SCIENCE",
      "Science items stay unmeasured beyond the fixture string.",
      "exact",
      { input: "h2o", target: "h2o" },
    ),
    arm(
      "ROUGE_CODING",
      "Coding arm does not claim repository edits yet.",
      "exact",
      { input: "return", target: "return" },
    ),
    arm(
      "ROUGE_RESEARCH",
      "Research arm records a source id, not a web result.",
      "exact",
      { input: "source:fixture", target: "source:fixture" },
    ),
    arm(
      "ROUGE_LONG_CONTEXT",
      "Long context is a planned 16k window, not a measured one.",
      "exact",
      { input: "ctx", target: "ctx" },
    ),
    arm(
      "ROUGE_MEMORY",
      "Memory arm is a hypothesis, not the product memory store.",
      "exact",
      { input: "mem", target: "mem" },
    ),
    arm(
      "ROUGE_VERIFICATION",
      "Verification prefers an independent judge over self-score.",
      "exact",
      { input: "judge", target: "judge" },
    ),
    arm(
      "ROUGE_PLANNING",
      "Planning arm lists steps; it does not execute them.",
      "exact",
      { input: "plan", target: "plan" },
    ),
    arm(
      "ROUGE_THINKING",
      "Thinking records a classification. It is not a hidden chain of thought from a trained model.",
      "exact",
      { input: "think", target: "think" },
    ),
    arm(
      "ROUGE_CYBERSECURITY",
      "Cybersecurity is a static scan of the request text. It does not exploit anything.",
      "static-scan",
      { input: "eval(1)", target: "1" },
    ),
    arm(
      "ROUGE_TERMINAL",
      "Terminal coding stays on an allowlist. No shell is spawned.",
      "exact",
      { input: "echo", target: "echo" },
    ),
    arm(
      "ROUGE_LONG_HORIZON",
      "Long-horizon coding records steps and does not execute them.",
      "exact",
      { input: "hold", target: "hold" },
    ),
  ],
  evalSuite: {
    id: "rouge-program-eval",
    measured: false,
    tasks: ["ROUGE_REASONING", "ROUGE_VERIFICATION"],
  },
  research: {
    loopId: "ROUGE_LOOP",
    hypotheses: [
      "A dense RoPE decoder can later cover general tasks. This is not a result.",
      "API fallback must stay labeled as fallback until a native checkpoint is validated.",
    ],
  },
  ui: {
    selectorLabel: "ROUGE 1",
    fallbackLabel: "ROUGE 1 · API fallback",
    activities: [
      "thinking",
      "reasoning",
      "research",
      "verification",
      "waiting",
      "api_fallback",
      "native_inference",
    ],
  },
  fallback: {
    envVar: "LAB_FALLBACK_MODEL_ROUGE",
    defaultModelId: "qwen3:free",
    catalogRole: "general",
  },
};
