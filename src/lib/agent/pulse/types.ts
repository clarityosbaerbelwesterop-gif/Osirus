import type {
  CapabilityOutcome,
  DerivedOutcome,
} from "../../verification/outcome";
import type { CapabilityLane, CapabilityLevel, DifficultyClass } from "./lanes";

export type PulseMode = "offline" | "live";

/** What one pulse task observed, with the evidence behind its outcome. */
export type PulseObservation = DerivedOutcome & {
  evidence: Record<string, unknown>;
  modelCalls: number;
  toolCalls: number;
  steps: number;
  repairs: number;
  latencyMs: number;
  /**
   * The separate false-completion probe: a FINISH that claims success
   * without the evidence was accepted. A weakness of the gate, not of the
   * task's own answer. Null when the task has no probe.
   */
  gateLeak: boolean | null;
  notes: string;
};

export type PulseTaskContext = { signal: AbortSignal };

/** One task of the unified suite. Code-defined, with its own grader. */
export type PulseTaskSpec = {
  id: string;
  family: CapabilityLane;
  level: CapabilityLevel;
  difficulty: DifficultyClass;
  /** Bumped when the task or its grader changes; part of the suite version. */
  version: number;
  /** The suite the task comes from (M30 baseline, M36 research, …). */
  source: string;
  mode: PulseMode;
  title: string;
  run(context: PulseTaskContext): Promise<PulseObservation>;
};

export type PulseCycle = {
  id: string;
  suiteVersion: string;
  taskIds: string[];
  cursor: number;
  status: "running" | "completed" | "abandoned";
  leaseOwner: string | null;
  leaseExpiresAt: string | null;
  startedAt: string;
  completedAt: string | null;
  nextDueAt: string | null;
  summary: Record<string, unknown>;
};

export type PulseResult = {
  cycleId: string;
  taskId: string;
  suiteVersion: string;
  family: CapabilityLane;
  level: CapabilityLevel;
  difficulty: DifficultyClass;
  mode: PulseMode;
  outcome: CapabilityOutcome;
  reason: string;
  evidence: Record<string, unknown>;
  modelCalls: number;
  toolCalls: number;
  latencyMs: number;
  createdAt?: string;
};

export type PulseBaseline = {
  suiteVersion: string;
  family: CapabilityLane;
  level: CapabilityLevel;
  samples: number;
  verified: number;
  falseCompletions: number;
  excluded: number;
  rate: number;
  lower: number;
  upper: number;
  regressionStreak: number;
  updatedAt?: string;
};

export type PulseRegression = {
  family: CapabilityLane;
  level: CapabilityLevel;
  kind: "verified_drop" | "false_completion";
  referenceRate: number;
  recentRate: number;
  probabilityWorse: number;
  streak: number;
  source: "pulse" | "product";
};

export type PulseTickReport = {
  ran: boolean;
  reason: string | null;
  cycleId: string | null;
  tasksRun: number;
  completedCycle: boolean;
  continueChain: boolean;
  regressions: PulseRegression[];
};
