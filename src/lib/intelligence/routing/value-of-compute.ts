import { randomUUID } from "node:crypto";
import type { ArmId } from "../../arms/types";
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
