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
      "Cross-domain entailment on authored facts. A missing conclusion is not a pass.",
      "entail",
      {
        input: "facts:math,plan;rules:math+plan>synthesis;query:synthesis",
        target: "yes",
      },
      [
        {
          input: "facts:math;rules:math+plan>synthesis;query:synthesis",
          target: "no",
        },
        {
          input: "facts:math;rules:math>plan,plan>synthesis;query:synthesis",
          target: "yes",
        },
        {
          input: "facts:math;rules:plan>synthesis;query:synthesis",
          target: "no",
        },
      ],
    ),
    arm(
      "DARUS_MATH",
      "Integer expressions and small word problems are parsed. No benchmark score is claimed.",
      "math-expr",
      { input: "2+2*3", target: "8" },
      [
        { input: "0/0", target: "refused" },
        { input: "2+3^2", target: "11" },
        { input: "(10%4)+1", target: "3" },
        { input: "2^-1", target: "refused" },
        { input: "(-2)^2", target: "4" },
        { input: "boxes:6;each:7;ask:total", target: "42" },
        { input: "had:20;got:1;gave:4;ask:left", target: "17" },
        { input: "boxes:2;each:3;had:1;ask:total", target: "refused" },
        { input: "had:9;gave:9;ask:left", target: "0" },
      ],
    ),
    arm(
      "DARUS_SCIENCE",
      "Science counts atoms or checks a reaction. It is not a paper result.",
      "formula",
      { input: "C6H12O6", target: "C:6,H:12,O:6" },
      [
        { input: "2H2+O2->2H2O", target: "balanced" },
        { input: "H2+O2->H2O", target: "unbalanced" },
      ],
    ),
    arm(
      "DARUS_CODING",
      "Coding on Darus sums an integer list. It is not Quasnir's specialist path and it does not write the repo.",
      "sum",
      { input: "4,5,6", target: "15" },
    ),
    arm(
      "DARUS_RESEARCH",
      "A research claim without a citation id fails. The fixture does not browse.",
      "citation",
      { input: "id=darus-fixture;title=breadth", target: "darus-fixture" },
      [
        { input: "claim=breadth without a source", target: "missing-id" },
        {
          input: "claim=breadth note;id=darus-fixture;title=breadth",
          target: "darus-fixture",
        },
      ],
    ),
    arm(
      "DARUS_PLANNING",
      "Planning records steps and executes none. A skipped required step fails.",
      "plan",
      { input: "gather. compare. hold.", target: "3" },
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
      "DARUS_LONG_CONTEXT",
      "The CPU fixture refuses a sequence past its context. The planned window is not measured.",
      "context-bound",
      { input: "9", target: "exceeds" },
      [
        { input: "8", target: "fits" },
        { input: "0", target: "refused" },
      ],
    ),
    arm(
      "DARUS_MEMORY",
      "Memory here is an in-process map, not the product memory store.",
      "memory",
      { input: "set:topic=breadth;get:topic", target: "breadth" },
      [
        { input: "set:topic=breadth;get:other", target: "missing" },
        {
          input: "set:topic=old;set:topic=breadth;get:topic",
          target: "breadth",
        },
      ],
    ),
    arm(
      "DARUS_TOOL_REASONING",
      "Tool reasoning names an allowlisted tool id. It does not call the tool.",
      "tool",
      { input: "tool:notes", target: "named" },
      [
        { input: "tool:shell", target: "refused" },
        { input: "call:notes", target: "refused" },
        { input: "tool:calendar", target: "named" },
      ],
    ),
    arm(
      "DARUS_WORLD_MODEL",
      "One deterministic step on a 2x2 grid. Edge moves are blocked. This is not a trained dynamics model.",
      "world",
      { input: "pos=0,0;action=right", target: "1,0" },
      [
        { input: "pos=0,0;action=left", target: "blocked" },
        { input: "pos=0,0;action=right;action=up", target: "1,1" },
        {
          input: "pos=0,0;action=right;action=right",
          target: "blocked-at:2",
        },
        { input: "pos=1,1;action=up", target: "blocked" },
      ],
    ),
    arm(
      "DARUS_MULTIMODAL",
      "The CPU fixture has no encoder. Claiming one fails the fixture.",
      "multimodal",
      { input: "no-encoder", target: "unavailable" },
      [{ input: "encoder:image", target: "refused" }],
    ),
    arm(
      "DARUS_VERIFICATION",
      "Verification compares two sides. It does not award a self-score.",
      "independent",
      { input: "left=same;right=same", target: "same" },
      [
        { input: "expr=2+2*3;expect=8", target: "match" },
        { input: "claimed=7;expr=2+2*3;expect=8", target: "mismatch" },
      ],
    ),
    arm(
      "DARUS_STRATEGY",
      "Strategy records a choice and a rejected alternative. It executes neither.",
      "strategy",
      { input: "choose:hold;reject:ship", target: "hold" },
      [
        { input: "choose:hold", target: "missing-alternative" },
        { input: "choose:hold;reject:hold", target: "not-alternative" },
      ],
    ),
    arm(
      "DARUS_THINKING",
      "Thinking records a classification. It is not a trained chain of thought.",
      "thinking",
      { input: "think", target: "thinking" },
    ),
    arm(
      "DARUS_CYBERSECURITY",
      "Cybersecurity is a static scan. It does not exploit anything.",
      "static-scan",
      { input: "eval(1)", target: "1" },
      [
        { input: "element.innerHTML = name", target: "1" },
        { input: 'secret="fixture-secret"', target: "1" },
        { input: "os.system(cmd)", target: "1" },
        { input: "const label = name", target: "0" },
        { input: "document.write(name)", target: "1" },
      ],
    ),
    arm(
      "DARUS_TERMINAL",
      "Terminal coding stays on an allowlist. No shell is spawned.",
      "terminal",
      { input: "echo menu", target: "menu" },
      [{ input: "bash -c id", target: "refused" }],
    ),
    arm(
      "DARUS_LONG_HORIZON",
      "Long-horizon work records up to eight steps. A later failure is recorded and nothing is scored.",
      "horizon",
      { input: "map. synthesize. hold.", target: "3" },
      [
        { input: "ok:map;ok:synthesize;fail:ship", target: "failed-at:3" },
        { input: "ok:map;need:synthesize", target: "failed-at:2" },
        { input: "ok:synthesize;need:synthesize", target: "2" },
        { input: "map. synthesize. hold. review. compare. stop.", target: "6" },
        {
          input: "ok:map;ok:synthesize;ok:hold;ok:review;need:map;need:hold",
          target: "6",
        },
        {
          input:
            "ok:map;ok:synthesize;ok:hold;ok:review;ok:compare;ok:stop;need:ship",
          target: "failed-at:7",
        },
        { input: "ok:map;bogus", target: "malformed" },
      ],
    ),
    arm(
      "DARUS_RSI",
      "Review the fixture step before applying it. Empty or non-finite gradients are not applied. Locked surfaces throw.",
      "rsi",
      { input: "finite", target: "applied" },
      [
        { input: "empty", target: "not-applied" },
        { input: "nan", target: "not-applied" },
        { input: "infinite", target: "not-applied" },
        { input: "locked:evaluation_integrity", target: "threw" },
        { input: "locked:approval_gate", target: "threw" },
        { input: "production", target: "threw" },
        { input: "candidate", target: "threw" },
      ],
    ),
  ],
  evalSuite: {
    id: "darus-program-eval",
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
      "planning",
    ],
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
      "thinking",
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
