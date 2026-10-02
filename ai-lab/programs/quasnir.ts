import type { CapabilityArm, ModelProgram } from "./types";

function arm(
  id: string,
  hypothesis: string,
  grader: CapabilityArm["task"]["grader"],
  sample: { input: string; target: string },
  more: readonly { input: string; target: string }[] = [],
): CapabilityArm {
  return {
    id,
    dataset: {
      id: `${id.toLowerCase()}-fixture-v1`,
      version: "v1",
      samples: [sample, ...more].map((item, index) => ({
        id: `${id}-s${index + 1}`,
        input: item.input,
        target: item.target,
      })),
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
      "An HTML page is in-program coding and must be a closed document with the asked heading. The median fixture does not write the repository.",
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
      "Repository context stays under fixture/. Parent paths are refused.",
      "repository",
      { input: "repo:fixture/readme", target: "fixture/readme" },
      [
        { input: "repo:../secret", target: "refused" },
        { input: "repo:fixture/%2e%2e/secret", target: "refused" },
        { input: "repo:etc/passwd", target: "outside" },
      ],
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
      "Devops accepts a dry-run token and refuses a live deploy in the fixture.",
      "dry-run",
      { input: "dry-run", target: "dry-run" },
      [
        { input: "deploy now", target: "refused" },
        { input: "dry-run plan", target: "dry-run" },
        { input: "live restart", target: "refused" },
      ],
    ),
    arm(
      "QUASNIR_DATABASE",
      "Only the literal fixture query select 1 returns a row. No connection is opened.",
      "database",
      { input: "select 1", target: "1" },
      [
        { input: "select * from users", target: "parsed" },
        { input: "select name from fixture where id=1", target: "parsed" },
        { input: "drop table fixture", target: "refused" },
        { input: "select 1; select 2", target: "refused" },
      ],
    ),
    arm(
      "QUASNIR_INFRASTRUCTURE",
      "Infrastructure stays on dry-run. Provision is refused.",
      "dry-run",
      { input: "dry-run", target: "dry-run" },
      [
        { input: "provision the box", target: "refused" },
        { input: "mode=dry-run", target: "dry-run" },
        { input: "live apply", target: "refused" },
      ],
    ),
    arm(
      "QUASNIR_TESTING",
      "Unit fixture reports how many arithmetic cases passed.",
      "unit",
      { input: "add", target: "3" },
      [
        { input: "assert:1+2=3", target: "pass" },
        { input: "assert:1+2=4", target: "fail" },
        { input: "assert:2*3=6;assert:9%2=1", target: "pass" },
      ],
    ),
    arm(
      "QUASNIR_ARCHITECTURE",
      "A dependency edge that would cycle fails. Nothing is deployed.",
      "graph",
      { input: "edges:web>api,api>db", target: "acyclic" },
      [
        { input: "edges:api>db,db>api", target: "cycle" },
        { input: "edges:a>b,b>c,c>a", target: "cycle" },
        { input: "edges:a>a", target: "cycle" },
      ],
    ),
    arm(
      "QUASNIR_LOGIC",
      "Boolean fixtures are evaluated. This is not a general-reasoning score.",
      "logic",
      { input: "true AND false", target: "false" },
      [{ input: "NOT false OR false", target: "true" }],
    ),
    arm(
      "QUASNIR_TERMINAL",
      "Terminal coding is allowlisted. No shell is spawned.",
      "terminal",
      { input: "ls", target: "README notes.txt" },
      [{ input: "sudo reboot", target: "refused" }],
    ),
    arm(
      "QUASNIR_LONG_HORIZON",
      "Long-horizon coding records steps and does not execute them.",
      "horizon",
      { input: "read. patch. test.", target: "3" },
      [
        { input: "ok:read;ok:patch;fail:ship", target: "failed-at:3" },
        { input: "ok:read;need:patch", target: "failed-at:2" },
        { input: "ok:patch;need:patch", target: "2" },
      ],
    ),
    arm(
      "QUASNIR_REASONING",
      "Code reasoning is entailment over authored review facts, not a general score.",
      "entail",
      {
        input: "facts:missing-guard;rules:missing-guard>review;query:review",
        target: "yes",
      },
      [
        {
          input: "facts:missing-guard;rules:missing-guard>review;query:exploit",
          target: "no",
        },
        {
          input:
            "facts:missing-guard;rules:missing-guard>review,review>hold;query:hold",
          target: "yes",
        },
        {
          input: "facts:missing-guard;rules:review>hold;query:hold",
          target: "no",
        },
      ],
    ),
    arm(
      "QUASNIR_THINKING",
      "Thinking records a classification for a code request. It is not a trained chain of thought.",
      "thinking",
      { input: "think about the patch", target: "thinking" },
    ),
    arm(
      "QUASNIR_MATH",
      "Integer arithmetic used by code fixtures. Division by zero is refused.",
      "math-expr",
      { input: "8/2", target: "4" },
      [
        { input: "4/0", target: "refused" },
        { input: "2^3*2", target: "16" },
        { input: "8%3", target: "2" },
        { input: "0^0", target: "refused" },
        { input: "-(2+3)*2", target: "-10" },
      ],
    ),
    arm(
      "QUASNIR_CYBERSECURITY",
      "Cybersecurity counts defensive findings in fixture text. It does not exploit anything.",
      "static-scan",
      { input: "element.innerHTML = name", target: "1" },
      [
        { input: "const label = name", target: "0" },
        { input: 'new Function("return 1")', target: "1" },
        { input: 'api_key="sk-fixture"', target: "1" },
        { input: "pickle.loads(blob)", target: "1" },
        { input: "document.write(name)", target: "1" },
        { input: "subprocess.call(cmd)", target: "1" },
      ],
    ),
    arm(
      "QUASNIR_RSI",
      "Review the fixture step before applying it. Empty or non-finite gradients are not applied. Locked surfaces throw.",
      "rsi",
      { input: "finite", target: "applied" },
      [
        { input: "empty", target: "not-applied" },
        { input: "nan", target: "not-applied" },
        { input: "infinite", target: "not-applied" },
        { input: "locked:security_boundary", target: "threw" },
        { input: "production", target: "threw" },
      ],
    ),
  ],
  evalSuite: {
    id: "quasnir-program-eval",
    measured: false,
    tasks: [
      "reasoning",
      "thinking",
      "rsi",
      "math",
      "cybersecurity",
      "coding",
      "terminal",
      "long_horizon",
      "security",
      "testing",
    ],
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
      "thinking",
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
