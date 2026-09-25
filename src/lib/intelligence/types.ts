import type { ArmId } from "../arms/types";
import type { StrategyGenome } from "../strategy/runtime";

// Domain types of the Intelligence Plane. Stores persist them, the engine
// reasons over them; nothing here touches a database or a model.

export type Partition = "train" | "dev" | "holdout" | "adversarial" | "fresh";

export type Generator =
  "seed" | "curriculum" | "self_play" | "red" | "mutation" | "replay";

export type CapabilityStatus = "unmeasured" | "weak" | "developing" | "strong";

export type Capability = {
  id: string;
  domain: string;
  name: string;
  description: string;
  status: CapabilityStatus;
  verifiedSuccessRate: number | null;
  sampleCount: number;
  failurePatterns: Array<{ failureClass: string; count: number }>;
  preferred: {
    strategyVersionId?: string;
    model?: string;
    skills?: string[];
    tools?: string[];
  };
  costProfile: { meanUsd?: number; meanTokens?: number };
  latencyProfile: { meanMs?: number };
  version: number;
  lastEvaluatedAt: string | null;
};

export type GapKind =
  | "knowledge"
  | "tool"
  | "execution"
  | "planning"
  | "context"
  | "memory"
  | "model"
  | "verification";

export type CapabilityGap = {
  id: string;
  capabilityId: string;
  kind: GapKind;
  summary: string;
  evidence: Record<string, unknown>;
  support: number;
  status: "open" | "investigating" | "addressed" | "dismissed";
};

/** How a task is judged, independent of the agent's own verdict. */
export type TaskVerify =
  | {
      kind: "tests";
      /** Test files written over whatever the agent left, then run. */
      files: Array<{ path: string; content: string }>;
      command: string[];
    }
  | { kind: "numeric"; value: number; tolerance: number }
  | { kind: "includes"; all: string[]; none?: string[] };

export type TaskSpec = {
  kind: "coding" | "math" | "research" | "general";
  objective: string;
  composition?: ArmId[];
  fixture?: Array<{ path: string; content: string }>;
  verify: TaskVerify;
  /** A trap an adversarial task sets, e.g. "readme_injection". */
  trap?: string;
  /** Memory the run is given; red tasks plant conflicting memories here. */
  memory?: string[];
};

export type DifficultyVector = {
  files?: number;
  modules?: number;
  reasoningDepth?: number;
  ambiguity?: number;
  distractors?: number;
  steps?: number;
};

export type EvalTask = {
  id: string;
  suite: string;
  capabilityId: string;
  partition: Partition;
  difficulty: DifficultyVector;
  difficultyScore: number;
  spec: TaskSpec;
  generator: Generator;
  fingerprint: string;
  parentId: string | null;
  labelVerified: boolean;
  labelEvidence: Record<string, unknown>;
};

export type StrategyStatus =
  | "draft"
  | "experimental"
  | "verified"
  | "champion"
  | "canary"
  | "active"
  | "degraded"
  | "rejected"
  | "deprecated";

export type StrategyVersion = {
  id: string;
  strategyId: string;
  kind: ArmId;
  version: number;
  genome: StrategyGenome;
  parentId: string | null;
  mutation: {
    operator: string;
    rationale: string;
    hypothesis?: string;
  };
  status: StrategyStatus;
  riskClass: "low" | "high";
  /** The model the version was evaluated on. */
  model: string | null;
  canaryPercent: number;
  metrics: Record<string, unknown>;
};

export type TrialResult = {
  success: boolean;
  verified: boolean;
  falseCompletion: boolean;
  failureClass: string | null;
  costUsd: number;
  tokens: number;
  latencyMs: number;
  modelCalls: number;
  toolCalls: number;
  repairs: number;
  verdicts: string[];
  notes: string[];
  answerExcerpt: string;
  /** Why the independent check passed or failed. */
  check: { passed: boolean; detail: string };
  /** What the agent did: stage order and loop actions, never reasoning. */
  trajectory?: {
    stages: string[];
    actions: Array<{ action: string; toolId?: string; outcome: string }>;
    /** The change it made (coding) or its final answer, capped. */
    output?: string;
  };
};

export type Trial = {
  id: string;
  experimentId: string;
  strategyVersionId: string;
  evalTaskId: string;
  partition: Partition;
  replicate: number;
  status: "pending" | "running" | "completed" | "failed" | "skipped";
  runId: string | null;
  attempts: number;
  result: TrialResult | null;
};

export type Hypothesis = {
  id: string;
  gap: GapKind;
  statement: string;
  intervention: Partial<StrategyGenome>;
  expected: string;
};

export type ExperimentDecision = {
  outcome: "improved" | "no_improvement" | "inconclusive" | "regressed";
  winnerVersionId: string | null;
  summary: string;
  comparisons: Array<{
    versionId: string;
    partition: Partition;
    tasks: number;
    champion: { verified: number; n: number };
    challenger: { verified: number; n: number };
    probabilityBetter: number;
    discordant: { challengerOnly: number; championOnly: number };
    signTestP: number;
    costRatio: number | null;
    falseCompletionDelta: number;
  }>;
};

export type Experiment = {
  id: string;
  cycleId: string | null;
  capabilityId: string;
  strategyId: string;
  observation: Record<string, unknown>;
  hypotheses: Hypothesis[];
  design: {
    partitions: Partition[];
    minPaired: number;
    maxReplicates: number;
    decisionRule: string;
  };
  conclusion: ExperimentDecision | null;
  status: "designed" | "running" | "concluded" | "aborted";
  championVersionId: string;
  challengerVersionIds: string[];
};

export type ExperienceOutcome =
  "verified_success" | "success" | "failure" | "false_completion" | "error";

export type ExperienceSource =
  | "trial"
  | "product"
  | "synthetic"
  | "benchmark"
  | "golden"
  | "arena"
  | "self_play"
  | "red"
  | "replay"
  | "human_feedback";

export type Experience = {
  id: string;
  source: ExperienceSource;
  taskRef: string | null;
  taskType: string;
  capabilityIds: string[];
  difficulty: number | null;
  strategyVersionId: string | null;
  model: string | null;
  skills: string[];
  tools: string[];
  /** Structured operational trajectory; never private reasoning. */
  trajectory: {
    arm?: string;
    stages?: string[];
    actions?: Array<{ action: string; toolId?: string; outcome: string }>;
    /** The produced change or answer, capped; Foundry tasks only. */
    output?: string;
  };
  verification: {
    verdicts: string[];
    check?: { passed: boolean; detail: string };
    /** The canonical outcome (verification/outcome.ts) and why. */
    capabilityOutcome?: import("../verification/outcome").CapabilityOutcome;
    reason?: string;
  };
  outcome: ExperienceOutcome;
  failureClass: string | null;
  repairs: number;
  costUsd: number;
  tokens: number;
  latencyMs: number;
  confidence: number | null;
  qualityScore: number;
  fingerprint: string;
  partition: Partition | null;
  provenance: Record<string, unknown>;
  createdAt: string;
};

export type ArtifactKind =
  | "strategic_memory"
  | "procedural_memory"
  | "causal_memory"
  | "skill_candidate"
  | "strategy_candidate"
  | "eval_case"
  | "curriculum_task"
  | "training_example"
  | "failure_pattern"
  | "router_stat";

export type LearningArtifact = {
  id: string;
  cycleId: string | null;
  kind: ArtifactKind;
  capabilityId: string | null;
  taskPattern: string | null;
  content: Record<string, unknown>;
  evidence: Record<string, unknown>;
  support: number;
  status: "proposed" | "active" | "superseded" | "rejected";
  fingerprint: string;
};

export type AgendaItem = {
  id: string;
  capabilityId: string;
  title: string;
  rationale: string;
  score: number;
  components: {
    weakness: number;
    usefulness: number;
    potential: number;
    cost: number;
  };
  status: "open" | "active" | "parked" | "done";
};

export const CYCLE_PHASES = [
  "measure",
  "select_agenda",
  "generate_data",
  "baseline",
  "analyze",
  "hypothesize",
  "design",
  "dev_eval",
  "adversarial_eval",
  "holdout_eval",
  "decide",
  "update_registry",
  "compile",
  "next",
] as const;
export type CyclePhase = (typeof CYCLE_PHASES)[number];

export type ResearchCycle = {
  id: string;
  status: "running" | "completed" | "failed" | "paused";
  phase: CyclePhase;
  agendaItemId: string | null;
  capabilityId: string | null;
  state: {
    experimentId?: string;
    gapIds?: string[];
    hypotheses?: Hypothesis[];
    bestChallengerId?: string | null;
    decision?: ExperimentDecision;
    log?: Array<{ at: string; phase: CyclePhase; note: string }>;
  };
  summary: Record<string, unknown>;
  startedAt: string;
  completedAt: string | null;
};

export type GenerationRun = {
  id: string;
  cycleId: string | null;
  kind:
    | "curriculum"
    | "self_play"
    | "red"
    | "mutation"
    | "dataset"
    | "skill_evolution";
  config: Record<string, unknown>;
  produced: number;
  verified: number;
  rejected: number;
  summary: Record<string, unknown>;
};

export type FoundrySettings = {
  flags: {
    intelligencePlane: boolean;
    experiments: boolean;
    curriculum: boolean;
    selfPlay: boolean;
    redIntelligence: boolean;
    compilation: boolean;
    strategyEvolution: boolean;
    skillEvolution: boolean;
    training: boolean;
    autoCanary: boolean;
    /** Paid models for the Foundry: an operator's emergency switch. */
    paidModelEmergency: boolean;
  };
  budgets: {
    dailyModelCalls: number;
    dailyTokens: number;
    dailyCostUsd: number;
    dailySandboxMinutes: number;
    dailyChainedTicks: number;
    parallelTrials: number;
  };
  /** The model trials run on; the free model by operator decision. */
  foundryModel: string;
  /** The model product runs use; canaries must be verified on it. */
  productModel: string | null;
  /**
   * Set by the Foundry itself when the provider refused a call: no trial
   * starts before `until`. `observedCalls` is what the day had spent when the
   * refusal came, the provider's real envelope as far as can be seen.
   */
  providerPause?: {
    until: string;
    code: string;
    observedCalls: number;
    at: string;
  } | null;
};

export const DEFAULT_SETTINGS: FoundrySettings = {
  flags: {
    intelligencePlane: false,
    experiments: false,
    curriculum: false,
    selfPlay: false,
    redIntelligence: false,
    compilation: false,
    strategyEvolution: false,
    skillEvolution: false,
    training: false,
    autoCanary: false,
    paidModelEmergency: false,
  },
  budgets: {
    // The free model's pool refuses after roughly 90-100 calls a day
    // (observed 2026-09-23); the envelope stays under that.
    dailyModelCalls: 90,
    dailyTokens: 3_000_000,
    dailyCostUsd: 0,
    dailySandboxMinutes: 180,
    // Each chained tick holds a function for up to 300 s: 36 is three hours.
    dailyChainedTicks: 36,
    parallelTrials: 1,
  },
  foundryModel: "deepseek-v4-pro-0813:free",
  productModel: null,
  providerPause: null,
};
