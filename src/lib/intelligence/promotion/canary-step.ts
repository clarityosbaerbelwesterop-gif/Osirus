import type { IntelStore } from "../store/store";
import type { Experience, FoundrySettings, StrategyVersion } from "../types";
import {
  canaryDecision,
  canaryEligible,
  transition,
  type CanaryEvidence,
} from "./promotion";

// One pass of product canaries, run by the Foundry tick.
//
// A lab champion that is eligible (auto-canary on, low risk, verified on the
// product's own model) starts at 1 %. Each pass compares the canary's product
// runs with the baseline's product runs over the same period and moves it
// one step: hold, advance, activate at 100 %, or roll back. Evidence is the
// metrics-only product experience; no content is read.

function rate(rows: Experience[]) {
  const judged = rows.filter((row) => row.outcome !== "error");
  if (!judged.length) return null;
  return (
    judged.filter((row) => row.outcome === "verified_success").length /
    judged.length
  );
}

export async function canaryEvidence(
  store: IntelStore,
  version: StrategyVersion,
  since: string,
): Promise<CanaryEvidence> {
  const capabilityId = `arm.${version.kind}`;
  const rows = await store.listExperience({
    source: "product",
    capabilityId,
    since,
    limit: 2000,
  });
  const mine = rows.filter((row) => row.strategyVersionId === version.id);
  const baseline = rows.filter((row) => row.strategyVersionId !== version.id);
  return {
    versionId: version.id,
    runs: mine.filter((row) => row.outcome !== "error").length,
    verifiedRate: rate(mine),
    baselineRate: rate(baseline),
  };
}

export async function advanceCanaries(
  store: IntelStore,
  settings: FoundrySettings,
  log?: (line: string) => void,
) {
  const versions = await store.listVersions();
  const promotions = await store.listPromotions(500);
  const moved: string[] = [];

  for (const version of versions) {
    if (version.status === "champion") {
      const eligible = canaryEligible(version, settings);
      if (!eligible.eligible) continue;
      await transition(store, version, "canary", { reason: "eligible" }, 1);
      moved.push(`${version.strategyId} v${version.version} canary 1%`);
      continue;
    }
    if (version.status !== "canary") continue;
    if (!settings.flags.autoCanary) continue;
    const since =
      promotions.find(
        (event) =>
          event.strategyVersionId === version.id &&
          event.canaryPercent === version.canaryPercent,
      )?.createdAt ?? new Date(0).toISOString();
    const evidence = await canaryEvidence(store, version, since);
    const step = canaryDecision(version, evidence);
    if (step.action === "hold") continue;
    if (step.action === "rollback") {
      await transition(
        store,
        version,
        "degraded",
        { ...evidence, reason: step.reason },
        0,
      );
    } else if (step.action === "activate") {
      for (const previous of versions.filter(
        (entry) =>
          entry.strategyId === version.strategyId && entry.status === "active",
      ))
        await transition(store, previous, "deprecated", {
          reason: "superseded",
          by: version.id,
        });
      await transition(
        store,
        version,
        "active",
        { ...evidence, reason: step.reason },
        100,
      );
    } else {
      await store.updateVersion(version.id, { canaryPercent: step.percent });
      await store.insertPromotion({
        strategyVersionId: version.id,
        fromStatus: "canary",
        toStatus: "canary",
        canaryPercent: step.percent,
        evidence: { ...evidence, reason: step.reason },
      });
    }
    moved.push(`${version.strategyId} v${version.version}: ${step.reason}`);
  }
  if (moved.length) log?.(`[canary] ${moved.join("; ")}`);
  return moved;
}
