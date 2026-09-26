// Process-wide state of the free-model-first runtime: the verified free-model
// pool, when it was discovered, key credential health, the capacity
// scheduler, and the evidence readiness reports (last successful free-model
// inference). One instance per server process.
//
// Key handling is deliberately narrow (M49 section 8). A key is skipped only
// after it was *rejected as a credential* (401/403). Nothing here moves a
// request to another key because of a rate limit or an exhausted quota.

import { CapacityScheduler, type CapacitySignal } from "./capacity";
import {
  buildFreeRegistry,
  FreeModelPool,
  emptyCandidate,
  parseCatalog,
  parseModelList,
  type CatalogEntry,
  type FreeModelCandidate,
  type PoolOptions,
} from "./free-registry";

export type DiscoveryState = {
  source: "discovered" | "seed" | "none";
  discoveredAt: number | null;
  lastAttemptAt: number | null;
  /** HTTP status of the last /v1/models call per key label, never the key. */
  keyStatus: Record<string, number | "network_error">;
  catalogStatus: number | "network_error" | "skipped" | null;
  listedModels: number;
  freeModels: number;
};

export type InferenceEvidence = {
  model: string;
  at: number;
  latencyMs: number | null;
};

const REFRESH_MS = 10 * 60_000;
const RETRY_DISCOVERY_MS = 60_000;
const CATALOG_REFRESH_MS = 60 * 60_000;
const KEY_REJECTION_MS = 10 * 60_000;

function numberEnv(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

export function poolOptionsFromEnv(): PoolOptions {
  return {
    minIntervalMs: numberEnv("OSIRUS_FREE_MODEL_MIN_INTERVAL_MS", 2_000),
  };
}

export function modelsUrlFor(chatEndpoint: string) {
  return chatEndpoint.replace(/\/chat\/completions\/?$/, "/models");
}

/** The public catalog lives on the API origin and needs no key. */
export function catalogUrlFor(chatEndpoint: string) {
  try {
    const url = new URL(chatEndpoint);
    if (url.hostname !== "api.unorouter.com") return null;
    return `${url.origin}/api/pricing`;
  } catch {
    return null;
  }
}

export class ModelRuntime {
  readonly pool: FreeModelPool;
  readonly capacity = new CapacityScheduler();
  discovery: DiscoveryState = {
    source: "none",
    discoveredAt: null,
    lastAttemptAt: null,
    keyStatus: {},
    catalogStatus: null,
    listedModels: 0,
    freeModels: 0,
  };
  lastSuccess: InferenceEvidence | null = null;
  lastRateLimitAt: number | null = null;
  private catalog: Map<string, CatalogEntry> | null = null;
  private catalogAt: number | null = null;
  private inflight: Promise<void> | null = null;
  private readonly keyRejectedUntil = new Map<number, number>();

  constructor(poolOptions: PoolOptions = poolOptionsFromEnv()) {
    this.pool = new FreeModelPool([], poolOptions);
  }

  /** Key indexes in the order to try: credential-rejected keys last. */
  keyOrder(count: number, now: number) {
    const indexes = Array.from({ length: count }, (_, i) => i);
    const rejected = (i: number) => (this.keyRejectedUntil.get(i) ?? 0) > now;
    return [
      ...indexes.filter((i) => !rejected(i)),
      ...indexes.filter(rejected),
    ];
  }

  markKeyRejected(index: number, now: number) {
    this.keyRejectedUntil.set(index, now + KEY_REJECTION_MS);
  }

  markKeyAccepted(index: number) {
    this.keyRejectedUntil.delete(index);
  }

  noteRateLimit(now: number) {
    this.lastRateLimitAt = now;
  }

  noteSuccess(model: string, now: number, latencyMs: number | null) {
    this.lastSuccess = { model, at: now, latencyMs };
  }

  capacitySignal(now: number): CapacitySignal {
    const snapshot = this.pool.snapshot();
    const cooling = snapshot.filter((c) => (c.cooldownUntil ?? 0) > now).length;
    return {
      poolSize: snapshot.length,
      coolingDown: cooling,
      ready: snapshot.length - cooling,
      msSinceRateLimit:
        this.lastRateLimitAt === null ? null : now - this.lastRateLimitAt,
    };
  }

  needsDiscovery(now: number) {
    if (this.inflight) return false;
    if (this.discovery.source === "discovered" && this.discovery.discoveredAt)
      return now - this.discovery.discoveredAt > REFRESH_MS;
    return (
      this.discovery.lastAttemptAt === null ||
      now - this.discovery.lastAttemptAt > RETRY_DISCOVERY_MS
    );
  }

  /**
   * Discover the verified free models. `/v1/models` is authoritative for
   * which IDs exist; the public catalog only annotates them. A key is tried
   * after the previous one only when that one failed as a credential or the
   * provider failed (5xx / network); a 429 stops discovery -- keys are not a
   * way around a limit.
   */
  async discover(input: {
    endpoint: string;
    keys: string[];
    preferred: string[];
    seed: readonly string[];
    fetchImpl?: typeof fetch;
    now?: () => number;
    maxPoolSize?: number;
  }) {
    if (this.inflight) return this.inflight;
    const run = async () => {
      const now = input.now ?? Date.now;
      const doFetch = input.fetchImpl ?? fetch;
      const started = now();
      this.discovery.lastAttemptAt = started;
      const keyStatus: DiscoveryState["keyStatus"] = {};
      const listedByKey: Array<{
        label: string;
        models: ReturnType<typeof parseModelList>;
      }> = [];
      for (const index of this.keyOrder(input.keys.length, started)) {
        const label = `KEY_${index + 1}`;
        try {
          const response = await doFetch(modelsUrlFor(input.endpoint), {
            headers: { Authorization: `Bearer ${input.keys[index]}` },
            cache: "no-store",
            signal: AbortSignal.timeout(8_000),
          });
          keyStatus[label] = response.status;
          if (response.ok) {
            listedByKey.push({
              label,
              models: parseModelList(await response.json()),
            });
            this.markKeyAccepted(index);
            break;
          }
          if (response.status === 401 || response.status === 403) {
            this.markKeyRejected(index, now());
            continue;
          }
          if (response.status >= 500 || response.status === 408) continue;
          break; // 429 or another client error: no key rotation.
        } catch {
          keyStatus[label] = "network_error";
        }
      }

      const catalogUrl = catalogUrlFor(input.endpoint);
      let catalogStatus: DiscoveryState["catalogStatus"] = catalogUrl
        ? this.discovery.catalogStatus
        : "skipped";
      if (
        catalogUrl &&
        listedByKey.length &&
        (!this.catalogAt || started - this.catalogAt > CATALOG_REFRESH_MS)
      ) {
        try {
          // Public, unauthenticated: no key is ever sent to the catalog.
          const response = await doFetch(catalogUrl, {
            cache: "no-store",
            signal: AbortSignal.timeout(8_000),
          });
          catalogStatus = response.status;
          if (response.ok) {
            this.catalog = parseCatalog(await response.json());
            this.catalogAt = started;
          }
        } catch {
          catalogStatus = "network_error";
        }
      }

      if (listedByKey.length) {
        const registry = buildFreeRegistry({
          listedByKey,
          catalog: this.catalog,
          preferred: input.preferred,
          known: input.seed,
          previous: this.pool.snapshot(),
          maxPoolSize: input.maxPoolSize,
        });
        this.pool.replace(registry);
        this.discovery = {
          source: "discovered",
          discoveredAt: started,
          lastAttemptAt: started,
          keyStatus,
          catalogStatus,
          listedModels: listedByKey[0].models.length,
          freeModels: registry.length,
        };
        return;
      }
      // Discovery failed: keep a previously discovered pool; otherwise fall
      // back to IDs Osirus has run before (unverified until they answer).
      if (this.discovery.source !== "discovered") {
        const seedIds = [
          ...new Set([...input.preferred, ...input.seed]),
        ].filter((id) => /:free$/i.test(id));
        const previous = new Map(this.pool.snapshot().map((c) => [c.id, c]));
        this.pool.replace(
          seedIds.map((id) => previous.get(id) ?? emptyCandidate(id)),
        );
        this.discovery = {
          ...this.discovery,
          source: seedIds.length ? "seed" : "none",
          keyStatus,
          catalogStatus,
          freeModels: seedIds.length,
        };
      } else {
        this.discovery = { ...this.discovery, keyStatus, catalogStatus };
      }
    };
    this.inflight = run().finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }

  /** PRIMARY_FREE / SECONDARY_FREE / TERTIARY_FREE, from the verified pool. */
  tiers() {
    const ids = this.pool.ids();
    return {
      PRIMARY_FREE: ids[0] ?? null,
      SECONDARY_FREE: ids[1] ?? null,
      TERTIARY_FREE: ids[2] ?? null,
    };
  }

  /** A snapshot for operators and readiness: IDs and states only. */
  describe(now: number) {
    return {
      discovery: { ...this.discovery },
      tiers: this.tiers(),
      pool: this.pool.snapshot().map((c: FreeModelCandidate) => ({
        id: c.id,
        availableToKeys: c.availableToKeys,
        freeEvidence: c.freeEvidence,
        contextLength: c.contextLength,
        maxOutputTokens: c.maxOutputTokens,
        lastHealth: c.lastHealth,
        lastSuccessAt: c.lastSuccessAt,
        lastFailureAt: c.lastFailureAt,
        failureCategory: c.failureCategory,
        coolingDownForMs:
          c.cooldownUntil && c.cooldownUntil > now ? c.cooldownUntil - now : 0,
      })),
      lastSuccess: this.lastSuccess,
      capacity: this.capacitySignal(now),
    };
  }
}

let shared: ModelRuntime | null = null;

export function modelRuntime() {
  shared ??= new ModelRuntime();
  return shared;
}

/** Tests only. */
export function resetModelRuntime(runtime?: ModelRuntime) {
  shared = runtime ?? null;
}
