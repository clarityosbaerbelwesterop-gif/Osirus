import { randomUUID } from "node:crypto";
import type { ArmId } from "../../arms/types";
import {
  TEAM_TOPOLOGIES,
  topologyOf,
  type TeamTopology,
} from "../../agent/team";
import { COMPUTE_TIERS, type StrategyGenome } from "../../strategy/runtime";
import type {
  Experience,
  Hypothesis,
  LearningArtifact,
  StrategyVersion,
} from "../types";

// Value of compute: would spending more calls on this kind of task buy a
// verified result? Learned from judged trial experience only, per
// capability and compute tier, with a Beta(1, 1) prior so a tier with two
// samples does not look perfect. The estimator does not route anything by
// itself: what it recommends becomes a hypothesis, and a hypothesis reaches
// the product only through an experiment and a canary like any other.

export type Tier = (typeof COMPUTE_TIERS)[number];

export type TierEstimate = {
  tier: Tier;
  n: number;
  verified: number;
  /** Posterior mean P(verified). */
  p: number;
  /** Mean loop steps per judged run, where the trajectory recorded them. */
  meanSteps: number | null;
};

export const MIN_TIER_SAMPLES = 3;

export function tierOf(genome: StrategyGenome | undefined): Tier {
  return genome?.computeTier ?? "STANDARD";
}

export function estimateTiers(
  experience: Experience[],
  versions: Map<string, StrategyVersion>,
  capabilityId: string,
): TierEstimate[] {
  const rows = experience.filter(
    (row) =>
      row.source !== "product" &&
      row.outcome !== "error" &&
      row.capabilityIds.includes(capabilityId) &&
      row.strategyVersionId &&
      versions.has(row.strategyVersionId),
  );
  return COMPUTE_TIERS.map((tier) => {
    const mine = rows.filter(
      (row) => tierOf(versions.get(row.strategyVersionId!)?.genome) === tier,
    );
    const verified = mine.filter(
      (row) => row.outcome === "verified_success",
    ).length;
    const calls = mine
      .map((row) => (row.trajectory.actions ?? []).length)
      .filter((value) => value > 0);
    return {
      tier,
      n: mine.length,
      verified,
      p: (verified + 1) / (mine.length + 2),
      meanSteps: calls.length
        ? calls.reduce((a, b) => a + b, 0) / calls.length
        : null,
    };
  });
}

/**
 * The tier with the best verified rate, unless a cheaper tier is within a
 * few points of it: extra compute has to pay for itself. Null until two
 * tiers each have enough judged runs to compare.
 */
export function recommendTier(estimates: TierEstimate[], margin = 0.05) {
  const measured = estimates.filter((entry) => entry.n >= MIN_TIER_SAMPLES);
  if (measured.length < 2) return null;
  const best = [...measured].sort((a, b) => b.p - a.p)[0]!;
  const order = COMPUTE_TIERS as readonly Tier[];
  const cheaper = measured
    .filter(
      (entry) =>
        order.indexOf(entry.tier) < order.indexOf(best.tier) &&
        best.p - entry.p <= margin,
    )
    .sort((a, b) => order.indexOf(a.tier) - order.indexOf(b.tier))[0];
  return cheaper ?? best;
}

/** A hypothesis from the estimator, when it disagrees with the champion. */
export function computeHypothesis(
  estimates: TierEstimate[],
  champion: StrategyGenome,
): Hypothesis | null {
  const pick = recommendTier(estimates);
  if (!pick || pick.tier === tierOf(champion)) return null;
  const current = estimates.find((entry) => entry.tier === tierOf(champion));
  return {
    id: randomUUID(),
    gap: "execution",
    statement: `Value of compute favours ${pick.tier}: ${pick.verified}/${pick.n} verified there vs ${current?.verified ?? 0}/${current?.n ?? 0} at ${tierOf(champion)}.`,
    intervention: { computeTier: pick.tier },
    expected: "The verified rate of the better tier, at its cost.",
  };
}

/**
 * Skill evolution: a skill candidate compiled from an earlier verified win
 * (a directive) is tried on this strategy, if its arm matches and the
 * champion does not already carry it.
 */
export function skillHypothesis(
  candidates: LearningArtifact[],
  arm: ArmId,
  champion: StrategyGenome,
  armOf: (capabilityId: string) => string,
): Hypothesis | null {
  const have = new Set(champion.directives ?? []);
  const candidate = candidates.find(
    (artifact) =>
      artifact.kind === "skill_candidate" &&
      artifact.status !== "rejected" &&
      typeof artifact.content.instruction === "string" &&
      !have.has(artifact.content.instruction) &&
      (!artifact.capabilityId || armOf(artifact.capabilityId) === arm),
  );
  if (!candidate) return null;
  const instruction = candidate.content.instruction as string;
  return {
    id: randomUUID(),
    gap: "knowledge",
    statement: `Skill candidate from ${String(candidate.content.source ?? "an earlier cycle")}: "${instruction.slice(0, 160)}"`,
    intervention: { directives: [...(champion.directives ?? []), instruction] },
    expected: "The verified skill carries over to this strategy's tasks.",
  };
}

// ----- value of delegation (M41) --------------------------------------------

export type TopologyEstimate = {
  topology: TeamTopology;
  n: number;
  verified: number;
  /** Posterior mean P(verified), Beta(1, 1) prior. */
  p: number;
  /** Posterior variance: how unsure the estimate still is. */
  variance: number;
  /** Mean tokens per judged run, where recorded: what a team costs. */
  meanTokens: number | null;
};

export const MIN_TOPOLOGY_SAMPLES = 3;

/** Verified rate per team topology for a capability, from judged trials. */
export function estimateTopologies(
  experience: Experience[],
  versions: Map<string, StrategyVersion>,
  capabilityId: string,
): TopologyEstimate[] {
  const rows = experience.filter(
    (row) =>
      row.source !== "product" &&
      row.outcome !== "error" &&
      row.capabilityIds.includes(capabilityId) &&
      row.strategyVersionId &&
      versions.has(row.strategyVersionId),
  );
  return TEAM_TOPOLOGIES.map((topology) => {
    const mine = rows.filter(
      (row) =>
        topologyOf(versions.get(row.strategyVersionId!)?.genome) === topology,
    );
    const verified = mine.filter(
      (row) => row.outcome === "verified_success",
    ).length;
    const a = verified + 1;
    const b = mine.length - verified + 1;
    const tokens = mine.map((row) => row.tokens).filter((value) => value > 0);
    return {
      topology,
      n: mine.length,
      verified,
      p: a / (a + b),
      variance: (a * b) / ((a + b) ** 2 * (a + b + 1)),
      meanTokens: tokens.length
        ? tokens.reduce((sum, value) => sum + value, 0) / tokens.length
        : null,
    };
  });
}

/**
 * Expected value of delegating to a team instead of one worker:
 * (P_team - P_single), less a cost term per extra thousand tokens. A team
 * is recommended only when both sides are measured and the gain clears the
 * margin; the extra tokens have to buy verified results.
 */
export function delegationValue(
  single: TopologyEstimate,
  team: TopologyEstimate,
  options: { costPerKTokens?: number; margin?: number } = {},
) {
  const extraKTokens =
    Math.max(0, (team.meanTokens ?? 0) - (single.meanTokens ?? 0)) / 1000;
  const gain =
    team.p - single.p - (options.costPerKTokens ?? 0.01) * extraKTokens;
  const measured =
    single.n >= MIN_TOPOLOGY_SAMPLES && team.n >= MIN_TOPOLOGY_SAMPLES;
  return {
    gain,
    extraKTokens,
    measured,
    worthwhile: measured && gain > (options.margin ?? 0.05),
  };
}

/** The topology to try next for a capability, as a Foundry hypothesis. */
export function topologyHypothesis(
  estimates: TopologyEstimate[],
  champion: StrategyGenome,
  armOfCapability: ArmId,
): Hypothesis | null {
  const current = topologyOf(champion);
  const here = estimates.find((entry) => entry.topology === current);
  if (!here) return null;
  // Exploit a measured win; otherwise explore the least-measured topology
  // that fits the arm (discriminating tests need compute, a sandbox or a
  // source), so each topology gets its paired comparison.
  const fits: TeamTopology[] =
    armOfCapability === "coding" || armOfCapability === "building"
      ? ["solver_adversary", "parallel_solvers_judge"]
      : armOfCapability === "research"
        ? ["solver_adversary", "solver_critic"]
        : ["parallel_solvers_judge", "solver_adversary", "solver_critic"];
  const measuredWin = estimates
    .filter(
      (entry) => entry.topology !== current && fits.includes(entry.topology),
    )
    .map((entry) => ({ entry, value: delegationValue(here, entry) }))
    .filter((row) => row.value.worthwhile)
    .sort((a, b) => b.value.gain - a.value.gain)[0];
  const explore = fits
    .map((topology) => estimates.find((entry) => entry.topology === topology)!)
    .filter(
      (entry) =>
        entry && entry.topology !== current && entry.n < MIN_TOPOLOGY_SAMPLES,
    )
    .sort((a, b) => a.n - b.n)[0];
  const pick = measuredWin?.entry ?? explore;
  if (!pick) return null;
  return {
    id: randomUUID(),
    gap: "verification",
    statement: measuredWin
      ? `Value of delegation favours ${pick.topology}: ${pick.verified}/${pick.n} verified vs ${here.verified}/${here.n} with ${current}, gain ${measuredWin.value.gain.toFixed(2)} after ${measuredWin.value.extraKTokens.toFixed(1)}k extra tokens.`
      : `Topology ${pick.topology} is unmeasured for this capability (${pick.n} judged runs); a paired trial measures whether it beats ${current}.`,
    intervention: {
      team: {
        topology: pick.topology,
        ...(pick.topology === "parallel_solvers_judge" ? { solvers: 2 } : {}),
      },
    },
    expected:
      "A team is kept only if its verified rate beats one worker by more than its extra tokens cost.",
  };
}

/**
 * M47: learn the adaptive-compute table for an arm from judged experience.
 * The start tier is the cheapest tier within the margin of the best
 * measured one; escalation stays on only if some team topology measurably
 * beat a single worker for its extra cost. Null until something is measured
 * -- an unmeasured arm keeps the plan's defaults, it is not guessed.
 */
export function learnComputeEntry(
  experience: Experience[],
  versions: Map<string, StrategyVersion>,
  capabilityId: string,
): {
  start: "FAST" | "STANDARD" | "DEEP";
  escalate: boolean;
  evidence: string;
} | null {
  const tier = recommendTier(estimateTiers(experience, versions, capabilityId));
  const topologies = estimateTopologies(experience, versions, capabilityId);
  const single = topologies.find((entry) => entry.topology === "single")!;
  const teams = topologies
    .filter((entry) => entry.topology !== "single")
    .map((entry) => ({ entry, value: delegationValue(single, entry) }))
    .filter((row) => row.value.measured);
  if (!tier && !teams.length) return null;
  const start =
    tier && tier.tier !== "EXTREME" ? tier.tier : ("STANDARD" as const);
  const escalate = teams.length
    ? teams.some((row) => row.value.worthwhile)
    : true;
  return {
    start,
    escalate,
    evidence: [
      tier
        ? `tier ${tier.tier}: ${tier.verified}/${tier.n} verified`
        : "tiers unmeasured",
      teams.length
        ? teams
            .map(
              (row) =>
                `${row.entry.topology} gain ${row.value.gain.toFixed(2)}`,
            )
            .join(", ")
        : "teams unmeasured",
    ].join("; "),
  };
}

/** The adaptive-compute hypothesis for a strategy, learned or from the prior. */
export function adaptiveComputeHypothesis(input: {
  experience: Experience[];
  versions: Map<string, StrategyVersion>;
  capabilityId: string;
  arm: ArmId;
  champion: StrategyGenome;
}): Hypothesis | null {
  if (input.champion.compute?.mode === "adaptive" && !input.experience.length)
    return null;
  const learned = learnComputeEntry(
    input.experience,
    input.versions,
    input.capabilityId,
  );
  const table = learned
    ? { [input.arm]: { start: learned.start, escalate: learned.escalate } }
    : undefined;
  if (
    input.champion.compute?.mode === "adaptive" &&
    JSON.stringify(input.champion.compute.table ?? {}) ===
      JSON.stringify(table ?? {})
  )
    return null;
  return {
    id: randomUUID(),
    gap: "execution",
    statement: learned
      ? `Learned adaptive compute for ${input.arm}: start ${learned.start}, escalate ${learned.escalate} (${learned.evidence}).`
      : `The same compute on every ${input.arm} task wastes calls: start cheap, escalate only drafts that are not verified.`,
    intervention: {
      compute: { mode: "adaptive", ...(table ? { table } : {}) },
    },
    expected:
      "At least as many verified results for fewer model calls per verified success.",
    origin: learned ? "learned_compute" : "compute_prior",
  };
}
