import type { CapabilityLane, CapabilityLevel } from "../../agent/pulse/lanes";
import type { GapKind } from "../types";

// The hourly Recursive Intelligence Cycle (RIC): Osirus measuring itself,
// finding what it is bad at, generating harder work from that, attacking
// itself, forming hypotheses and deciding on evidence. The model is the
// engine; everything a cycle changes is Osirus (strategies, generators,
// memory, code proposals), never model weights.
//
// A cycle is a row in osirus_intel.rsi_cycles with a phase cursor. The
// existing scheduler tick steps it; there is no second scheduler.

export const RSI_PHASES = [
  "health",
  "experience",
  "gaps",
  "challenge",
  "self_play",
  "red",
  "hypothesize",
  "experiment",
  "decide",
  "memory",
  "meta",
] as const;
export type RsiPhase = (typeof RSI_PHASES)[number];

/** A pulse cell below its ceiling, or a regression the watchdog confirmed. */
export type WeakCell = {
  family: CapabilityLane;
  level: CapabilityLevel;
  rate: number;
  lower: number;
  samples: number;
  falseCompletions: number;
};

/** A weakness found by the cycle itself (self-play, red, pulse). */
export type RsiFinding = {
  source: "pulse" | "self_play" | "red";
  /** Config or attack class that exposed it, or the pulse task id. */
  origin: string;
  capabilityId: string;
  kind: GapKind;
  summary: string;
  /** The Osirus mechanism that failed, as file:function, if known. */
  mechanism: string | null;
  /** Instance ids (seeded, reproducible) that exposed it. */
  instances: string[];
};

export type RsiHypothesisClass =
  | "strategy"
  | "memory"
  | "context"
  | "planning"
  | "verification"
  | "skill"
  | "tool"
  | "specialist"
  | "team_topology"
  | "compute"
  | "routing"
  | "prompt"
  | "code"
  | "architecture";

export type RsiHypothesis = {
  id: string;
  class: RsiHypothesisClass;
  capabilityId: string;
  gap: GapKind;
  statement: string;
  expected: string;
  /** A genome intervention (strategy classes) ... */
  intervention?: Record<string, unknown>;
  /** ... or the code it would change (code class, M45). */
  target?: { file: string; symbol: string };
  origin: string;
  /** "live" needs model calls (Actions); "offline" is decided here. */
  lane: "live" | "offline";
};

export type RsiPhaseRecord = {
  at: string;
  ms: number;
  note: string;
  /** A phase that threw: recorded and passed over, never retried forever. */
  error?: string;
};

export type RsiState = {
  log?: Partial<Record<RsiPhase, RsiPhaseRecord>>;
  health?: {
    pulseCycleId: string | null;
    suiteVersion: string | null;
    pulseCompletedAt: string | null;
    tasks: number;
    verified: number;
    infrastructure: number;
    weakCells: WeakCell[];
    regressions: Array<{ family: string; level: number; kind: string }>;
    budget: { used: number; allowance: number; day: string };
  };
  experience?: {
    pulseRows: number;
    taught: number;
    excluded: number;
    failureMemories: number;
    antiPatterns: number;
  };
  gaps?: {
    open: number;
    top: Array<{
      id: string;
      capabilityId: string;
      kind: GapKind;
      summary: string;
      support: number;
    }>;
  };
  challenge?: {
    requests: number;
    generated: number;
    stored: number;
    duplicates: number;
    contaminated: number;
    reasons: string[];
  };
  selfPlay?: {
    configs: Array<{
      id: string;
      difficulty: number;
      instances: number;
      held: number;
      failed: number;
      novelty: number;
      score: number;
    }>;
    findings: RsiFinding[];
  };
  red?: {
    attacks: Array<{
      id: string;
      level: number;
      instances: number;
      held: number;
      failed: number;
    }>;
    findings: RsiFinding[];
  };
  hypotheses?: { items: RsiHypothesis[] };
  experiment?: {
    order: string | null;
    lane: "live" | "offline" | "none";
    note: string;
  };
  decision?: {
    decided: number;
    promoted: number;
    rejected: number;
    quarantined: number;
    rolledBack: number;
    notes: string[];
  };
  memory?: { written: number; kinds: Record<string, number> };
  meta?: {
    newWeaknesses: string[];
    resolved: string[];
    generatorsRetired: string[];
    rollup: string | null;
  };
};

export type RsiCycle = {
  id: string;
  phases: RsiPhase[];
  cursor: number;
  status: "running" | "completed" | "abandoned";
  leaseOwner: string | null;
  leaseExpiresAt: string | null;
  state: RsiState;
  startedAt: string;
  completedAt: string | null;
  nextDueAt: string | null;
  summary: Record<string, unknown>;
};

export type RsiTickReport = {
  ran: boolean;
  reason: string | null;
  cycleId: string | null;
  phasesRun: RsiPhase[];
  completedCycle: boolean;
  continueChain: boolean;
};
