// M49 section 8: readiness from recent evidence, not configuration.
//
// /api/health stays a cheap liveness check. Readiness answers "would a real
// user journey work right now?" from evidence collected in the background
// and cached: database round trip, the auth JWKS endpoint answering, recent
// authenticated activity, the verified free-model pool, and the last
// *successful free-model inference* with its timestamp. It never runs a
// model inference itself. Pure: the collector supplies the evidence.

export type Check = {
  ok: boolean;
  detail: string;
  /** When the evidence was observed (ISO), if it has a timestamp. */
  at?: string | null;
};

export type ReadinessEvidence = {
  collectedAt: number;
  database: { ok: boolean };
  auth: {
    configured: boolean;
    jwksStatus: number | "network_error" | "not_configured";
    lastAuthenticatedActivityAt: number | null;
  };
  model: {
    providerConfigured: boolean;
    poolSource: "discovered" | "seed" | "none";
    poolSize: number;
    tiers: {
      PRIMARY_FREE: string | null;
      SECONDARY_FREE: string | null;
      TERTIARY_FREE: string | null;
    };
    coolingDown: number;
    keyStatus: Record<string, number | "network_error">;
    lastFreeSuccess: { model: string; at: number } | null;
    lastAnySuccess: { model: string; at: number } | null;
  };
  sandbox: { configured: boolean; driver: string; reason?: string | null };
  runtime: {
    schedulerSecret: boolean;
    connectorKey: boolean;
  };
};

export const FREE_INFERENCE_FRESH_MS = 6 * 60 * 60_000;

const iso = (value: number | null | undefined) =>
  value ? new Date(value).toISOString() : null;

export function assessReadiness(evidence: ReadinessEvidence, now: number) {
  const database: Check = {
    ok: evidence.database.ok,
    detail: evidence.database.ok
      ? "SELECT 1 succeeded"
      : "database unreachable or not configured",
  };
  const jwksOk = evidence.auth.jwksStatus === 200;
  const auth: Check = {
    ok: evidence.auth.configured && jwksOk,
    detail: !evidence.auth.configured
      ? "Neon Auth is not configured"
      : jwksOk
        ? "auth configured and JWKS endpoint answering (the sign-in round trip itself is not proven by this check)"
        : `JWKS endpoint did not answer (${evidence.auth.jwksStatus})`,
    at: iso(evidence.auth.lastAuthenticatedActivityAt),
  };
  const free = evidence.model.lastFreeSuccess;
  const freeFresh = Boolean(free && now - free.at <= FREE_INFERENCE_FRESH_MS);
  const model: Check = {
    ok:
      evidence.model.providerConfigured &&
      evidence.model.poolSize > 0 &&
      freeFresh,
    detail: !evidence.model.providerConfigured
      ? "model provider is not configured"
      : evidence.model.poolSize === 0
        ? "no verified free model is available to the configured keys"
        : !free
          ? "no successful free-model inference recorded yet"
          : freeFresh
            ? `last successful free-model inference on ${free.model}`
            : `last successful free-model inference on ${free.model} is older than ${FREE_INFERENCE_FRESH_MS / 3_600_000}h`,
    at: iso(free?.at),
  };
  const sandbox: Check = {
    ok: evidence.sandbox.configured,
    detail: evidence.sandbox.configured
      ? `sandbox driver ${evidence.sandbox.driver}`
      : `sandbox not configured${evidence.sandbox.reason ? `: ${evidence.sandbox.reason}` : ""}`,
  };
  const runtime: Check = {
    ok: evidence.runtime.schedulerSecret && evidence.runtime.connectorKey,
    detail:
      [
        evidence.runtime.schedulerSecret ? null : "scheduler secret missing",
        evidence.runtime.connectorKey ? null : "connector key missing",
      ]
        .filter(Boolean)
        .join(", ") || "scheduler secret and connector key configured",
  };
  // Chat readiness needs database, auth and a proven free model. The sandbox
  // and background runtime are reported but do not block chat.
  const ready = database.ok && auth.ok && model.ok;
  return {
    status: ready ? ("ready" as const) : ("not_ready" as const),
    ready,
    collectedAt: iso(evidence.collectedAt),
    ageMs: Math.max(0, now - evidence.collectedAt),
    checks: { database, auth, model, sandbox, runtime },
    model: {
      poolSource: evidence.model.poolSource,
      poolSize: evidence.model.poolSize,
      tiers: evidence.model.tiers,
      coolingDown: evidence.model.coolingDown,
      keyStatus: evidence.model.keyStatus,
      lastFreeSuccessAt: iso(free?.at),
      lastFreeSuccessModel: free?.model ?? null,
      lastAnySuccessAt: iso(evidence.model.lastAnySuccess?.at),
      lastAnySuccessModel: evidence.model.lastAnySuccess?.model ?? null,
    },
  };
}

/** Stale-while-revalidate cache for the collected evidence. */
export class EvidenceCache<T> {
  private value: T | null = null;
  private at = 0;
  private refreshing: Promise<T> | null = null;

  constructor(private readonly ttlMs: number) {}

  /**
   * The cached value when fresh; when stale, the cached value now and a
   * refresh in the background (`schedule`); with nothing cached, awaits one.
   */
  async get(
    collect: () => Promise<T>,
    now: number,
    schedule: (task: Promise<unknown>) => void = () => undefined,
  ): Promise<T> {
    const refresh = () => {
      this.refreshing ??= collect()
        .then((value) => {
          this.value = value;
          this.at = Date.now();
          return value;
        })
        .finally(() => {
          this.refreshing = null;
        });
      return this.refreshing;
    };
    if (this.value === null) return refresh();
    if (now - this.at > this.ttlMs) schedule(refresh().catch(() => undefined));
    return this.value;
  }
}
