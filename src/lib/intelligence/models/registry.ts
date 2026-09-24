import { MIN_SAMPLES } from "../capabilities/registry";
import type { IntelStore, ModelRecord } from "../store/store";
import type { Experience } from "../types";

// The ModelRegistry and per-capability model competition. A model is never
// ranked globally: it is the champion of a capability only where it has the
// best verified rate on at least MIN_SAMPLES judged runs there.

export function modelRecord(
  modelId: string,
  provider = "unorouter",
): ModelRecord {
  return {
    id: `${provider}:${modelId}`,
    provider,
    modelId,
    family: modelId.split(/[-:]/)[0] ?? null,
    modalities: ["text"],
    contextTokens: null,
    free: /:free$/.test(modelId),
    status: "listed",
  };
}

export async function registerModels(
  store: IntelStore,
  input: { foundryModel: string; productModels: string[] },
) {
  const models = [input.foundryModel, ...input.productModels].filter(
    (model, index, all) => model && all.indexOf(model) === index,
  );
  for (const model of models)
    await store.upsertModel({
      ...modelRecord(model),
      status: model === input.foundryModel ? "available" : "listed",
    });
}

/** Recompute per-capability model statistics and champions. */
export async function updateModelCompetition(
  store: IntelStore,
  experience: Experience[],
) {
  const stats = new Map<
    string,
    {
      modelId: string;
      capabilityId: string;
      trials: number;
      verified: number;
      latency: number[];
      cost: number[];
    }
  >();
  for (const row of experience) {
    if (!row.model || row.source === "product" || row.outcome === "error")
      continue;
    for (const capabilityId of row.capabilityIds) {
      const key = `${row.model}|${capabilityId}`;
      const entry = stats.get(key) ?? {
        modelId: `unorouter:${row.model}`,
        capabilityId,
        trials: 0,
        verified: 0,
        latency: [],
        cost: [],
      };
      entry.trials += 1;
      if (row.outcome === "verified_success") entry.verified += 1;
      entry.latency.push(row.latencyMs);
      entry.cost.push(row.costUsd);
      stats.set(key, entry);
    }
  }
  const known = new Set((await store.listModels()).map((model) => model.id));
  const byCapability = new Map<
    string,
    typeof stats extends Map<string, infer V> ? V[] : never
  >();
  for (const entry of stats.values()) {
    if (!known.has(entry.modelId))
      await store.upsertModel({
        ...modelRecord(entry.modelId.replace(/^unorouter:/, "")),
        status: "available",
      });
    const list = byCapability.get(entry.capabilityId) ?? [];
    list.push(entry);
    byCapability.set(entry.capabilityId, list);
  }
  const mean = (values: number[]) =>
    values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
  for (const [capabilityId, entries] of byCapability) {
    const eligible = entries.filter((entry) => entry.trials >= MIN_SAMPLES);
    const champion = eligible.sort(
      (a, b) => b.verified / b.trials - a.verified / a.trials,
    )[0];
    for (const entry of entries)
      await store.upsertModelStat({
        modelId: entry.modelId,
        capabilityId,
        trials: entry.trials,
        verified: entry.verified,
        meanLatencyMs: mean(entry.latency),
        meanCostUsd: mean(entry.cost),
        champion: entry === champion,
      });
  }
}
