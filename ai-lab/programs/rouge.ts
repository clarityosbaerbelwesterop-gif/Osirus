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
      "Short entailment is a forward chain on authored facts. A missing conclusion is not a pass.",
      "entail",
      {
        input: "facts:rain;rules:rain>wet;query:wet",
        target: "yes",
      },
      [
        { input: "facts:rain;rules:rain>wet;query:dry", target: "no" },
        {
          input: "facts:rain;rules:rain>wet,wet>cold;query:cold",
          target: "yes",
        },
        { input: "facts:rain;rules:wet>cold;query:cold", target: "no" },
      ],
    ),
    arm(
      "ROUGE_MATH",
      "Integer expressions are parsed. Division by zero is refused. This is not a math benchmark.",
      "math-expr",
      { input: "(2+3)*4", target: "20" },
      [
        { input: "1/0", target: "refused" },
        { input: "(2+3)^2", target: "25" },
        { input: "7%3", target: "1" },
        { input: "2^9", target: "refused" },
        { input: "-(2+3)", target: "-5" },
        { input: "-2^2", target: "-4" },
      ],
    ),
    arm(
      "ROUGE_SCIENCE",
      "A formula fixture counts atoms or checks a reaction. It is not a paper result.",
      "formula",
      { input: "H2O", target: "H:2,O:1" },
      [
        { input: "NaCl", target: "Na:1,Cl:1" },
        { input: "Fe2O3", target: "Fe:2,O:3" },
        { input: "2H2+O2->2H2O", target: "balanced" },
        { input: "H2+O2->H2O", target: "unbalanced" },
        { input: "H2O!", target: "unparsed" },
      ],
    ),
    arm(
      "ROUGE_CODING",
      "Coding sums an integer list in process. It does not write the repository.",
      "sum",
      { input: "1,2,3", target: "6" },
    ),
    arm(
      "ROUGE_RESEARCH",
      "A research claim without a citation id fails. The fixture does not fetch a page.",
      "citation",
      { input: "id=fixture;title=notes", target: "fixture" },
      [
        { input: "claim=water is wet", target: "missing-id" },
        {
          input: "claim=notes hold;id=fixture;title=notes",
          target: "fixture",
        },
      ],
    ),
    arm(
      "ROUGE_LONG_CONTEXT",
      "The CPU fixture refuses a sequence past its context. The planned window is not measured.",
      "context-bound",
      { input: "9", target: "exceeds" },
      [
        { input: "4", target: "fits" },
        { input: "8", target: "fits" },
        { input: "0", target: "refused" },
        { input: "8.5", target: "refused" },
      ],
    ),
    arm(
      "ROUGE_MEMORY",
      "Memory here is an in-process map for the fixture, not the product memory store.",
      "memory",
      { input: "set:k=v;get:k", target: "v" },
      [
        { input: "set:a=1;get:b", target: "missing" },
        { input: "set:k=v;set:k=w;get:k", target: "w" },
      ],
    ),
    arm(
      "ROUGE_VERIFICATION",
      "Verification compares two sides. It does not award a self-score.",
      "independent",
      { input: "left=judge;right=judge", target: "same" },
      [
        { input: "left=judge;right=other", target: "different" },
        { input: "expr=(2+3)*4;expect=20", target: "match" },
        {
          input: "claimed=21;expr=(2+3)*4;expect=20",
          target: "mismatch",
        },
      ],
    ),
    arm(
      "ROUGE_PLANNING",
      "Planning records steps and executes none. A plan that skips a required step fails.",
      "plan",
      { input: "one. two.", target: "2" },
      [
        {
          input: "need:gather,compare;steps:gather. compare.",
          target: "complete",
        },
        {
          input: "need:gather,compare;steps:gather.",
          target: "skipped:compare",
        },
      ],
    ),
    arm(
      "ROUGE_THINKING",
      "Thinking records a classification. It is not a hidden chain of thought from a trained model.",
      "thinking",
      { input: "think", target: "thinking" },
    ),
    arm(
      "ROUGE_CYBERSECURITY",
      "Cybersecurity is a static scan of the request text. It does not exploit anything.",
      "static-scan",
      { input: "eval(1)", target: "1" },
      [
        { input: "pickle.loads(blob)", target: "1" },
        { input: 'new Function("return 1")', target: "1" },
        { input: 'password="hunter2"', target: "1" },
        { input: "child_process.exec(cmd)", target: "1" },
        { input: "const label = name", target: "0" },
        { input: "document.write(name)", target: "1" },
      ],
    ),
    arm(
      "ROUGE_TERMINAL",
      "Terminal coding stays on an allowlist. No shell is spawned.",
      "terminal",
      { input: "pwd", target: "/fixture" },
      [
        { input: "echo hi", target: "hi" },
        { input: "rm notes", target: "refused" },
      ],
    ),
    arm(
      "ROUGE_LONG_HORIZON",
      "Long-horizon coding records steps and does not execute them.",
      "horizon",
      { input: "hold. review. stop.", target: "3" },
      [
        { input: "ok:hold;ok:review;fail:ship", target: "failed-at:3" },
        { input: "ok:hold;need:review", target: "failed-at:2" },
        { input: "ok:review;need:review", target: "2" },
      ],
    ),
    arm(
      "ROUGE_RSI",
      "Review the fixture step before applying it. Empty or non-finite gradients are not applied. Locked surfaces throw.",
      "rsi",
      { input: "finite", target: "applied" },
      [
        { input: "empty", target: "not-applied" },
        { input: "nan", target: "not-applied" },
        { input: "infinite", target: "not-applied" },
        { input: "locked:budget_limit", target: "threw" },
        { input: "locked:trust_root", target: "threw" },
        { input: "production", target: "threw" },
        { input: "candidate", target: "threw" },
      ],
    ),
  ],
  evalSuite: {
    id: "rouge-program-eval",
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
      "science",
      "research",
      "verification",
    ],
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
