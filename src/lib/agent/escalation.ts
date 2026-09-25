import type { TeamTopology } from "./team";
import type { StrategyGenome } from "../strategy/runtime";

// Adaptive compute (M47): maximum verified intelligence per model call.
//
// Static compute spends the same on every task. Adaptive compute starts a
// task at a cheap tier and, after the draft, asks one question: would one
// more rung of compute -- an independent critic, an adversary whose attacks
// must be confirmed by a check, or a team settled by a discriminating test
// -- buy a verified result for less than it costs? A verified draft stops
// there. The estimate is explicit and small: a prior for how often each
// rung repairs a draft, times how uncertain the draft still is, over the
// calls the rung costs. What the cycle learns per arm (the genome's
// `table`) overrides the start tier and can switch escalation off where it
// never paid. Verification is never skipped to save calls: it is part of
// the evaluation, not of the compute budget.

export type Rung = "critic" | "adversary" | "team";

export type ComputePlan = {
  mode: "static" | "adaptive";
  start: "FAST" | "STANDARD";
  ladder: Rung[];
  minGainPerCall: number;
  table: Record<
    string,
    { start: "FAST" | "STANDARD" | "DEEP"; escalate: boolean }
  >;
};

export const DEFAULT_COMPUTE: ComputePlan = {
  mode: "static",
  start: "FAST",
  ladder: ["critic", "adversary", "team"],
  minGainPerCall: 0.05,
  table: {},
};

export function computePlanOf(genome: StrategyGenome | undefined): ComputePlan {
  const compute = genome?.compute;
  return {
    mode: compute?.mode ?? DEFAULT_COMPUTE.mode,
    start: compute?.start ?? DEFAULT_COMPUTE.start,
    ladder: compute?.ladder?.length ? compute.ladder : DEFAULT_COMPUTE.ladder,
    minGainPerCall: compute?.minGainPerCall ?? DEFAULT_COMPUTE.minGainPerCall,
    table: compute?.table ?? {},
  };
}

/** The tier a stage starts at: static keeps the genome's; adaptive starts cheap. */
export function startTier(
  genome: StrategyGenome | undefined,
  armId: string,
): NonNullable<StrategyGenome["computeTier"]> {
  const plan = computePlanOf(genome);
  if (plan.mode === "static") return genome?.computeTier ?? "STANDARD";
  return plan.table[armId]?.start ?? plan.start;
}

/** Priors: how often a rung turns an unverified draft into a verified one. */
export const RUNG_REPAIR_PRIOR: Record<Rung, number> = {
  critic: 0.2,
  adversary: 0.3,
  team: 0.4,
};

/** Model calls a rung costs beyond the draft (reviewer, attacker, solvers + judge). */
export const RUNG_CALLS: Record<Rung, number> = {
  critic: 2,
  adversary: 2,
  team: 3,
};

const UNCERTAINTY: Record<
  "unverified" | "partial" | "verified" | "rejected",
  number
> = {
  verified: 0,
  partial: 0.5,
  unverified: 0.7,
  rejected: 0.9,
};

export type EscalationDecision = {
  rung: Rung | null;
  topology: TeamTopology;
  reason: string;
  gainPerCall: number;
};

const TOPOLOGY: Record<Rung, TeamTopology> = {
  critic: "solver_critic",
  adversary: "solver_adversary",
  team: "parallel_solvers_judge",
};

export function nextEscalation(input: {
  genome: StrategyGenome | undefined;
  armId: string;
  verification: "unverified" | "partial" | "verified" | "rejected";
  openHypotheses: number;
  remainingCalls: number;
}): EscalationDecision {
  const plan = computePlanOf(input.genome);
  const none = (reason: string): EscalationDecision => ({
    rung: null,
    topology: "single",
    reason,
    gainPerCall: 0,
  });
  if (plan.mode === "static") return none("static compute");
  if (plan.table[input.armId]?.escalate === false)
    return none(`escalation never paid for ${input.armId} (learned)`);
  if (input.verification === "verified")
    return none("draft verified; more compute adds cost, not evidence");
  // An open hypothesis means the draft rests on something unsettled.
  const uncertainty = Math.min(
    0.95,
    UNCERTAINTY[input.verification] +
      Math.min(0.2, input.openHypotheses * 0.05),
  );
  const options = plan.ladder
    .filter((rung) => RUNG_CALLS[rung] <= input.remainingCalls)
    .map((rung) => ({
      rung,
      gainPerCall: (RUNG_REPAIR_PRIOR[rung] * uncertainty) / RUNG_CALLS[rung],
    }))
    .sort((a, b) => b.gainPerCall - a.gainPerCall);
  const best = options[0];
  if (!best) return none("no rung fits the calls left");
  if (best.gainPerCall < plan.minGainPerCall)
    return {
      ...none(
        `best rung ${best.rung} gains ${best.gainPerCall.toFixed(3)}/call < ${plan.minGainPerCall}`,
      ),
      gainPerCall: best.gainPerCall,
    };
  return {
    rung: best.rung,
    topology: TOPOLOGY[best.rung],
    reason: `${input.verification} draft: ${best.rung} expected +${best.gainPerCall.toFixed(3)} verified per call`,
    gainPerCall: best.gainPerCall,
  };
}
