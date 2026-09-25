import { topologyOf } from "../../agent/team";
import type { StrategyGenome } from "../../strategy/runtime";

// Cognitive telemetry (M42): how a run thought, measured from what it did.
//
// Every signal comes from the operational record -- loop actions, the
// mission's hypothesis statuses, verdicts, cost -- never from reasoning
// text. A signal the record cannot support is null, not a guess.

export type CognitiveTelemetry = {
  /** Confirmed / (confirmed + rejected) hypotheses. */
  hypothesisPrecision: number | null;
  /** Share of rejected hypotheses that carried counter-evidence. */
  rejectionQuality: number | null;
  /** 1 if the run replanned and still verified, 0 if it replanned and did not. */
  replanUsefulness: number | null;
  /** Successful tool actions per action taken. */
  evidenceEfficiency: number | null;
  /** Tool calls that returned rather than failed. */
  toolChoiceQuality: number | null;
  /** Memory retrievals followed by a verified result. */
  memoryUsefulness: number | null;
  /** 1 if a capability switch was followed by a verified result. */
  switchQuality: number | null;
  /** VERIFY steps per FINISH, capped at 1. */
  verificationCoverage: number | null;
  /** 1 if the run did not declare done against its evidence. */
  falseCompletionAvoided: number;
  /** Tokens per verified success (null when not verified). */
  tokensPerVerifiedSuccess: number | null;
};

export type TelemetryInput = {
  actions: Array<{ action: string; toolId?: string; outcome: string }>;
  verified: boolean;
  falseCompletion: boolean;
  tokens: number;
  hypotheses?: {
    confirmed: number;
    rejected: number;
    rejectedWithCounter: number;
  };
  switches?: number;
};

const ratio = (a: number, b: number) =>
  b > 0 ? Number((a / b).toFixed(4)) : null;

export function cognitiveTelemetry(input: TelemetryInput): CognitiveTelemetry {
  const count = (action: string) =>
    input.actions.filter((step) => step.action === action).length;
  const tools = input.actions.filter((step) => step.action === "USE_TOOL");
  const toolsOk = tools.filter((step) => step.outcome === "ok").length;
  const replans = count("REPLAN");
  const memory = count("RETRIEVE_MEMORY");
  const finishes = count("FINISH") + count("RESPOND");
  const verifies = count("VERIFY");
  const h = input.hypotheses;
  return {
    hypothesisPrecision: h
      ? ratio(h.confirmed, h.confirmed + h.rejected)
      : null,
    rejectionQuality: h ? ratio(h.rejectedWithCounter, h.rejected) : null,
    replanUsefulness: replans ? (input.verified ? 1 : 0) : null,
    evidenceEfficiency: ratio(toolsOk, input.actions.length),
    toolChoiceQuality: ratio(toolsOk, tools.length),
    memoryUsefulness: memory ? (input.verified ? 1 : 0) : null,
    switchQuality: input.switches ? (input.verified ? 1 : 0) : null,
    verificationCoverage: finishes
      ? Math.min(1, Number((verifies / finishes).toFixed(4)))
      : null,
    falseCompletionAvoided: input.falseCompletion ? 0 : 1,
    tokensPerVerifiedSuccess: input.verified ? input.tokens : null,
  };
}

/**
 * The configuration a run ran under, one value per dimension, so credit can
 * be assigned to exactly one of them (credit.ts).
 */
export type ConfigurationVector = Record<string, string>;

export function configurationVector(input: {
  genome: StrategyGenome | undefined;
  model: string | null;
  skills: string[];
  assignment?: string | null;
}): ConfigurationVector {
  const genome = input.genome ?? {};
  return {
    model: input.model ?? "default",
    tier: genome.computeTier ?? "STANDARD",
    topology: topologyOf(genome),
    context: String(genome.contextTokens ?? "default"),
    memory: String(genome.memory?.limit ?? "default"),
    skillsMax: String(genome.skills?.maxActive ?? "default"),
    skills: [...input.skills].sort().join(",") || "none",
    directives: String(genome.directives?.length ?? 0),
    coding: JSON.stringify(genome.coding ?? {}),
    math: JSON.stringify(genome.math ?? {}),
    research: JSON.stringify(genome.research ?? {}),
    tools: [...(genome.tools?.include ?? [])].sort().join(",") || "none",
  };
}
