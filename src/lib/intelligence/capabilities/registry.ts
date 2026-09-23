import type { IntelStore } from "../store/store";
import type { Capability, CapabilityStatus, Experience } from "../types";
import { CAPABILITY_SEEDS } from "./taxonomy";

// The Capability Registry: seeded once, then re-measured from experience at
// the start of every research cycle. A capability's numbers are only ever
// computed from recorded outcomes; with too few samples it stays "unmeasured"
// rather than inheriting an optimistic default.

export const MIN_SAMPLES = 3;

export async function seedCapabilities(store: IntelStore) {
  const existing = new Set((await store.listCapabilities()).map((c) => c.id));
  for (const seed of CAPABILITY_SEEDS) {
    if (existing.has(seed.id)) continue;
    await store.upsertCapability({
      id: seed.id,
      domain: seed.domain,
      name: seed.name,
      description: seed.description,
      status: "unmeasured",
      verifiedSuccessRate: null,
      sampleCount: 0,
      failurePatterns: [],
      preferred: {},
      costProfile: {},
      latencyProfile: {},
      version: 1,
      lastEvaluatedAt: null,
    });
  }
  for (const seed of CAPABILITY_SEEDS)
    for (const dependency of seed.dependsOn ?? [])
      await store.addDependency(seed.id, dependency);
}

export function statusFor(
  rate: number | null,
  samples: number,
): CapabilityStatus {
  if (rate === null || samples < MIN_SAMPLES) return "unmeasured";
  if (rate < 0.4) return "weak";
  if (rate < 0.75) return "developing";
  return "strong";
}

/** Metrics of one capability from its experience rows. */
export function measure(
  capability: Capability,
  rows: Experience[],
): Capability {
  // Only outcomes an independent judge produced count toward the rate;
  // product rows carry the agent's own verdict and are reported separately.
  // Provider outages (rate limits, an empty balance) say nothing about what
  // the agent can do and are left out of the rate as well.
  const judged = rows.filter(
    (row) =>
      row.source !== "product" && !row.failureClass?.startsWith("provider:"),
  );
  const verified = judged.filter(
    (row) => row.outcome === "verified_success",
  ).length;
  const rate = judged.length ? verified / judged.length : null;
  const failures = new Map<string, number>();
  for (const row of judged)
    if (row.failureClass)
      failures.set(row.failureClass, (failures.get(row.failureClass) ?? 0) + 1);
  const mean = (values: number[]) =>
    values.length
      ? values.reduce((a, b) => a + b, 0) / values.length
      : undefined;
  const byVersion = new Map<string, { verified: number; n: number }>();
  for (const row of judged) {
    if (!row.strategyVersionId) continue;
    const entry = byVersion.get(row.strategyVersionId) ?? { verified: 0, n: 0 };
    entry.n += 1;
    if (row.outcome === "verified_success") entry.verified += 1;
    byVersion.set(row.strategyVersionId, entry);
  }
  const bestVersion = [...byVersion.entries()]
    .filter(([, entry]) => entry.n >= MIN_SAMPLES)
    .sort((a, b) => b[1].verified / b[1].n - a[1].verified / a[1].n)[0]?.[0];
  const models = new Map<string, number>();
  for (const row of judged)
    if (row.model && row.outcome === "verified_success")
      models.set(row.model, (models.get(row.model) ?? 0) + 1);
  return {
    ...capability,
    verifiedSuccessRate: rate === null ? null : Number(rate.toFixed(4)),
    sampleCount: judged.length,
    status: statusFor(rate, judged.length),
    failurePatterns: [...failures.entries()]
      .map(([failureClass, count]) => ({ failureClass, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8),
    preferred: {
      ...capability.preferred,
      ...(bestVersion ? { strategyVersionId: bestVersion } : {}),
      ...(models.size
        ? { model: [...models.entries()].sort((a, b) => b[1] - a[1])[0]![0] }
        : {}),
    },
    costProfile: {
      meanUsd: mean(judged.map((row) => row.costUsd)),
      meanTokens: mean(judged.map((row) => row.tokens)),
    },
    latencyProfile: { meanMs: mean(judged.map((row) => row.latencyMs)) },
    version: capability.version + 1,
    lastEvaluatedAt: new Date().toISOString(),
  };
}

/** Re-measure every capability; returns the ones whose status changed. */
export async function remeasureAll(store: IntelStore, windowDays = 30) {
  const since = new Date(Date.now() - windowDays * 86_400_000).toISOString();
  const changes: Array<{
    id: string;
    from: CapabilityStatus;
    to: CapabilityStatus;
    rate: number | null;
  }> = [];
  for (const capability of await store.listCapabilities()) {
    const rows = await store.listExperience({
      capabilityId: capability.id,
      since,
      limit: 1000,
    });
    const measured = measure(capability, rows);
    if (
      measured.sampleCount === capability.sampleCount &&
      measured.verifiedSuccessRate === capability.verifiedSuccessRate
    )
      continue;
    await store.upsertCapability(measured);
    if (measured.status !== capability.status)
      changes.push({
        id: capability.id,
        from: capability.status,
        to: measured.status,
        rate: measured.verifiedSuccessRate,
      });
  }
  return changes;
}

/**
 * Explain a weak capability through its dependencies: the weakest measured
 * dependency is the first place to look.
 */
export async function weakestDependency(
  store: IntelStore,
  capabilityId: string,
) {
  const edges = (await store.dependencies()).filter(
    (edge) => edge.capabilityId === capabilityId,
  );
  const capabilities = new Map(
    (await store.listCapabilities()).map((capability) => [
      capability.id,
      capability,
    ]),
  );
  return (
    edges
      .map((edge) => capabilities.get(edge.dependsOn))
      .filter((capability): capability is Capability => !!capability)
      .filter((capability) => capability.verifiedSuccessRate !== null)
      .sort(
        (a, b) => (a.verifiedSuccessRate ?? 1) - (b.verifiedSuccessRate ?? 1),
      )[0] ?? null
  );
}
