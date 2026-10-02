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
 * QUASNIR model program. Coding and security specialist.
 * The FIM fixture executes. The planned model is not trained.
 */
export const quasnirProgram: ModelProgram = {
  id: "quasnir",
  displayName: "QUASNIR",
  nativeModelId: "osirus/quasnir-1",
  summary:
    "Coding and security model. Constructed as a causal decoder with a fill-in-the-middle span. Not trained. Served by API fallback until a validated native checkpoint is online.",
  architecture: {
    id: "quasnir-fim-causal-v1",
    version: "v1-planned",
    family: "fim-causal",
    plannedLayers: 16,
    plannedHidden: 1536,
    plannedHeads: 12,
    plannedKvHeads: 12,
    plannedContext: 16384,
    precision: "bf16-planned",
    fixture: {
      family: "fim-causal",
      vocab: 8,
      dim: 4,
      heads: 2,
      kvHeads: 2,
      ffn: 8,
      experts: 1,
      context: 8,
      precision: "fp64-fixture",
    },
    notes:
      "Same block as a causal decoder, plus an executable FIM mix from a suffix anchor. Planned FIM rate is a hypothesis, not a measured training result.",
  },
  tokenizer: {
    id: "quasnir-bpe-fim",
    version: "0.0.0-untrained",
    family: "byte-level-bpe-fim",
    vocabSize: 49152,
  },
  mixture: {
    id: "quasnir-mix",
    version: "v1",
    parts: [
      {
        source: "fixture-authored-code",
        fraction: 0.8,
        license: "fixture-authored",
      },
      {
        source: "fixture-authored-security-notes",
        fraction: 0.2,
        license: "fixture-authored",
      },
    ],
  },
  curriculum: [
    {
      id: "quasnir-fim",
      order: 0,
      objective: "fill-in-the-middle on authored fixtures",
      executable: false,
    },
    {
      id: "quasnir-repo",
      order: 1,
      objective: "repository-shaped packs",
      executable: false,
    },
    {
      id: "quasnir-security",
      order: 2,
      objective: "static findings, not exploit procedures",
      executable: false,
    },
    {
      id: "quasnir-fixture",
      order: 3,
      objective: "CPU FIM fixture only",
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
    experimentId: "quasnir-fixture-exp-001",
    seed: 7101,
    datasetVersion: "v1",
    architectureVersion: "v1-planned",
    executable: "tiny-cpu-fixture",
    trainingReady: false,
  },
  objectives: [
    {
      id: "quasnir-no-trained-claim",
      statement: "Never label an API answer as a Quasnir checkpoint.",
    },
    {
      id: "quasnir-no-exploit",
      statement:
        "Security arms grade fixtures. They do not emit exploit procedures.",
    },
  ],
  arms: [
    arm(
      "QUASNIR_CODING",
      "Code fixtures can be checked by executing a known function.",
      "execute",
      { input: "1, 2, 3, 4", target: "2.5" },
    ),
    arm(
      "QUASNIR_DEBUGGING",
      "A literal patch is correct only when the expected text appears.",
      "patch",
      { input: "return a", target: "a=>b=>return b" },
    ),
    arm(
      "QUASNIR_REPOSITORY",
      "Repository context is a fixture id, not a cloned private repo.",
      "exact",
      { input: "repo:fixture", target: "repo:fixture" },
    ),
    arm(
      "QUASNIR_CODE_REVIEW",
      "Review records a static finding count, not a percentage.",
      "static-scan",
      { input: "eval(user)", target: "1" },
    ),
    arm(
      "QUASNIR_SECURITY",
      "Security scan flags process spawn in a fixture string.",
      "static-scan",
      { input: "child_process.exec(cmd)", target: "1" },
    ),
    arm(
      "QUASNIR_VULNERABILITY",
      "Vulnerability notes stay descriptive. This fixture only counts a pickle load.",
      "static-scan",
      { input: "pickle.loads(blob)", target: "1" },
    ),
    arm(
      "QUASNIR_DEVOPS",
      "Devops arm is unmeasured beyond the fixture token.",
      "exact",
      { input: "deploy", target: "deploy" },
    ),
    arm(
      "QUASNIR_DATABASE",
      "Database arm does not open a connection in this fixture.",
      "exact",
      { input: "select 1", target: "select 1" },
    ),
    arm(
      "QUASNIR_INFRASTRUCTURE",
      "Infrastructure arm is config text, not a provisioned machine.",
      "exact",
      { input: "dry-run", target: "dry-run" },
    ),
    arm(
      "QUASNIR_TESTING",
      "Unit fixture reports how many arithmetic cases passed.",
      "unit",
      { input: "add", target: "3" },
    ),
    arm(
      "QUASNIR_ARCHITECTURE",
      "A patch regression keeps the median fixture while the text changes.",
      "regression",
      { input: "median-v1", target: "median-v2" },
    ),
    arm(
      "QUASNIR_LOGIC",
      "Logic stays on an exact fixture. It is not a general-reasoning score.",
      "exact",
      { input: "1+1", target: "1+1" },
    ),
    arm(
      "QUASNIR_TERMINAL",
      "Terminal coding is allowlisted. No shell is spawned.",
      "exact",
      { input: "echo", target: "echo" },
    ),
    arm(
      "QUASNIR_LONG_HORIZON",
      "Long-horizon coding records steps and does not execute them.",
      "exact",
      { input: "hold", target: "hold" },
    ),
  ],
  evalSuite: {
    id: "quasnir-program-eval",
    measured: false,
    tasks: ["QUASNIR_CODING", "QUASNIR_SECURITY", "QUASNIR_TESTING"],
  },
  research: {
    loopId: "QUASNIR_LOOP",
    hypotheses: [
      "Fill-in-the-middle may help completion later. This is not a result.",
      "Static scans and patch checks can grade fixtures without claiming full security coverage.",
    ],
  },
  ui: {
    selectorLabel: "QUASNIR",
    fallbackLabel: "QUASNIR · API fallback",
    activities: [
      "code_analysis",
      "security_scan",
      "test_execution",
      "patch_verification",
      "waiting",
      "api_fallback",
      "native_inference",
    ],
  },
  fallback: {
    envVar: "LAB_FALLBACK_MODEL_QUASNIR",
    defaultModelId: "qwen2.5-coder-32b:free",
    catalogRole: "code",
  },
};
