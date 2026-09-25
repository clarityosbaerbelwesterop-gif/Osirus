import type { IntelStore } from "../store/store";
import type {
  FoundrySettings,
  StrategyStatus,
  StrategyVersion,
} from "../types";

// Promotion and rollback.
//
// Inside the Intelligence Plane, promotion is automatic once the decision
// rule passes: draft → experimental → verified → champion. Towards the
// Product Plane, only low-risk assets move, only when verified on the model
// the product actually uses, only when the operator enabled auto-canary, and
// then in steps (1 → 5 → 20 → 50 → 100 %) that advance on healthy evidence
// and roll back on a strong regression, without a human click per step.
// High-risk assets (auth, RLS, secrets, billing, DNS, destructive database
// work) are not strategy assets at all: no code path here can create one,
// and the database refuses canary/active for a high-risk row.

export const CANARY_STEPS = [1, 5, 20, 50, 100] as const;

/** Assets the Foundry is never allowed to change, whatever a genome says. */
export const HIGH_RISK_SURFACES = [
  "authentication",
  "authorization",
  "row_level_security",
  "secrets",
  "credentials",
  "billing",
  "payments",
  "dns",
  "destructive_database_operations",
] as const;

const ALLOWED: Record<StrategyStatus, StrategyStatus[]> = {
  draft: ["experimental", "rejected"],
  experimental: ["verified", "rejected"],
  verified: ["champion", "rejected", "deprecated"],
  champion: ["canary", "deprecated", "degraded", "quarantined"],
  canary: ["active", "degraded", "champion", "quarantined"],
  active: ["degraded", "deprecated", "quarantined"],
  degraded: ["champion", "deprecated", "quarantined"],
  rejected: [],
  deprecated: [],
  // M43: taken out of service with its evidence; only retirement follows.
  quarantined: ["deprecated"],
};

export async function transition(
  store: IntelStore,
  version: StrategyVersion,
  to: StrategyStatus,
  evidence: Record<string, unknown>,
  canaryPercent?: number,
) {
  if (!ALLOWED[version.status].includes(to))
    throw new Error(`illegal_transition:${version.status}->${to}`);
  if (version.riskClass === "high" && (to === "canary" || to === "active"))
    throw new Error("high_risk_asset_not_promotable");
  await store.updateVersion(version.id, {
    status: to,
    ...(canaryPercent !== undefined ? { canaryPercent } : {}),
  });
  await store.insertPromotion({
    strategyVersionId: version.id,
    fromStatus: version.status,
    toStatus: to,
    canaryPercent: canaryPercent ?? null,
    evidence,
  });
  return {
    ...version,
    status: to,
    canaryPercent: canaryPercent ?? version.canaryPercent,
  };
}

/**
 * Make a verified winner the Intelligence-Plane champion of its strategy; the
 * previous champion is deprecated but kept, so a rollback is one transition.
 */
export async function crownChampion(
  store: IntelStore,
  winner: StrategyVersion,
  evidence: Record<string, unknown>,
) {
  let current = winner;
  if (current.status === "experimental")
    current = await transition(store, current, "verified", evidence);
  const previous = (await store.listVersions(winner.strategyId)).filter(
    (version) => version.status === "champion" && version.id !== winner.id,
  );
  for (const version of previous)
    await transition(store, version, "deprecated", {
      reason: "superseded",
      by: winner.id,
    });
  return transition(store, current, "champion", evidence);
}

export type CanaryEvidence = {
  versionId: string;
  runs: number;
  verifiedRate: number | null;
  baselineRate: number | null;
};

/**
 * One canary step: start, advance, hold, promote to active, or roll back.
 * Pure over the evidence handed in, so it is testable without traffic.
 */
export function canaryDecision(
  version: StrategyVersion,
  evidence: CanaryEvidence,
  minRunsPerStep = 20,
): {
  action: "hold" | "advance" | "activate" | "rollback";
  percent: number;
  reason: string;
} {
  const percent = version.canaryPercent;
  if (
    evidence.runs >= minRunsPerStep &&
    evidence.verifiedRate !== null &&
    evidence.baselineRate !== null &&
    evidence.verifiedRate < evidence.baselineRate - 0.1
  )
    return {
      action: "rollback",
      percent: 0,
      reason: `Canary verified rate ${evidence.verifiedRate.toFixed(2)} is more than 10 points below the baseline ${evidence.baselineRate.toFixed(2)}.`,
    };
  if (evidence.runs < minRunsPerStep)
    return {
      action: "hold",
      percent,
      reason: `Waiting for ${minRunsPerStep} runs at ${percent}%.`,
    };
  const next = CANARY_STEPS.find((step) => step > percent);
  if (!next)
    return { action: "activate", percent: 100, reason: "Healthy at 100%." };
  return {
    action: "advance",
    percent: next,
    reason: `Healthy at ${percent}%; moving to ${next}%.`,
  };
}

/** Whether a champion may start a product canary at all. */
export function canaryEligible(
  version: StrategyVersion,
  settings: FoundrySettings,
) {
  if (!settings.flags.autoCanary)
    return { eligible: false, reason: "Auto-canary is off." };
  if (version.riskClass !== "low")
    return { eligible: false, reason: "Not a low-risk asset." };
  if (version.status !== "champion")
    return { eligible: false, reason: "Only a verified champion may canary." };
  if (!settings.productModel)
    return {
      eligible: false,
      reason: "No product model is configured to compare against.",
    };
  if (version.model !== settings.productModel)
    return {
      eligible: false,
      reason: `Verified on ${version.model ?? "an unknown model"}, but product runs use ${settings.productModel}; a result on one model is not evidence for another.`,
    };
  return { eligible: true, reason: null };
}
