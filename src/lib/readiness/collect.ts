import "server-only";
import { authConfigured } from "../auth/server";
import { querySystem, db } from "../db/client";
import { env, serverKeys } from "../env";
import { FREE_MODELS } from "../models/free";
import { modelRuntime } from "../models/model-runtime";
import { EvidenceCache, type ReadinessEvidence } from "./assess";

// Collects readiness evidence cheaply: one SELECT 1, one JWKS GET, two
// indexed reads of recent rows, the in-process model runtime, and -- at most
// every ten minutes -- the /v1/models discovery (a listing, not inference).
// No model inference is ever run here.

const cache = new EvidenceCache<ReadinessEvidence>(30_000);

async function timed<T>(promise: Promise<T>, ms: number, fallback: T) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((resolve) => {
        timer = setTimeout(() => resolve(fallback), ms);
      }),
    ]);
  } catch {
    return fallback;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function collect(): Promise<ReadinessEvidence> {
  const collectedAt = Date.now();
  const runtime = modelRuntime();
  const providerConfigured = Boolean(
    env.UNOROUTER_BASE_URL && serverKeys().length > 0,
  );

  const database = env.DATABASE_URL
    ? timed(
        db()
          .query("select 1 as ok")
          .then(() => true),
        3_000,
        false,
      )
    : Promise.resolve(false);

  const jwks: Promise<ReadinessEvidence["auth"]["jwksStatus"]> =
    env.NEON_AUTH_JWKS_URL
      ? timed(
          fetch(env.NEON_AUTH_JWKS_URL, {
            cache: "no-store",
            signal: AbortSignal.timeout(3_000),
          }).then((response) => response.status),
          3_500,
          "network_error" as const,
        )
      : Promise.resolve("not_configured" as const);

  const discovery =
    providerConfigured && runtime.needsDiscovery(collectedAt)
      ? timed(
          runtime.discover({
            endpoint: env.UNOROUTER_BASE_URL!,
            keys: serverKeys(),
            preferred: [
              env.OSIRUS_FREE_MODEL_PRIMARY,
              env.OSIRUS_FREE_MODEL_SECONDARY,
              env.OSIRUS_FREE_MODEL_TERTIARY,
            ].filter((id): id is string => Boolean(id)),
            seed: FREE_MODELS,
          }),
          10_000,
          undefined,
        )
      : Promise.resolve(undefined);

  type Row = { model: string; at: Date | string | null };
  const lastFree = env.DATABASE_URL
    ? timed(
        querySystem<Row>(
          `select coalesce(response_metadata->>'servedModel', model) as model,
                  completed_at as at
             from osirus.model_calls
            where status = 'completed'
              and coalesce(response_metadata->>'servedModel', model) like '%:free'
            order by completed_at desc nulls last limit 1`,
        ),
        3_000,
        [] as Row[],
      )
    : Promise.resolve([] as Row[]);
  const lastAny = env.DATABASE_URL
    ? timed(
        querySystem<Row>(
          `select coalesce(response_metadata->>'servedModel', model) as model,
                  completed_at as at
             from osirus.model_calls
            where status = 'completed'
            order by completed_at desc nulls last limit 1`,
        ),
        3_000,
        [] as Row[],
      )
    : Promise.resolve([] as Row[]);
  const lastActivity = env.DATABASE_URL
    ? timed(
        querySystem<{ at: Date | string | null }>(
          "select max(created_at) as at from osirus.runs",
        ),
        3_000,
        [] as Array<{ at: Date | string | null }>,
      )
    : Promise.resolve([] as Array<{ at: Date | string | null }>);

  const { sandboxAvailability } = await import("../sandbox");
  const sandbox = timed(
    sandboxAvailability().then((s) => ({
      configured: s.configured,
      driver: s.configured ? String(s.driver) : "NOT_CONFIGURED",
      reason: s.reason ?? null,
    })),
    3_000,
    { configured: false, driver: "UNKNOWN", reason: "timed out" },
  );

  const [dbOk, jwksStatus, , freeRows, anyRows, activityRows, sandboxState] =
    await Promise.all([
      database,
      jwks,
      discovery,
      lastFree,
      lastAny,
      lastActivity,
      sandbox,
    ]);

  const toMs = (value: Date | string | null | undefined) =>
    value ? new Date(value).getTime() : null;
  const fromRow = (rows: Row[]) => {
    const at = toMs(rows[0]?.at);
    return rows[0] && at ? { model: rows[0].model, at } : null;
  };
  const inProcess = runtime.lastSuccess;
  const dbFree = fromRow(freeRows);
  const lastFreeSuccess =
    inProcess &&
    /:free$/i.test(inProcess.model) &&
    (!dbFree || inProcess.at > dbFree.at)
      ? { model: inProcess.model, at: inProcess.at }
      : dbFree;
  const signal = runtime.capacitySignal(collectedAt);

  return {
    collectedAt,
    database: { ok: dbOk },
    auth: {
      configured: authConfigured,
      jwksStatus,
      lastAuthenticatedActivityAt: toMs(activityRows[0]?.at),
    },
    model: {
      providerConfigured,
      poolSource: runtime.discovery.source,
      poolSize: runtime.pool.size,
      tiers: runtime.tiers(),
      coolingDown: signal.coolingDown,
      keyStatus: { ...runtime.discovery.keyStatus },
      lastFreeSuccess,
      lastAnySuccess: fromRow(anyRows),
    },
    sandbox: sandboxState,
    runtime: {
      schedulerSecret: Boolean(env.OSIRUS_SCHEDULER_SECRET),
      connectorKey: Boolean(process.env.OSIRUS_CONNECTOR_KEY),
    },
  };
}

export function readinessEvidence(schedule?: (task: Promise<unknown>) => void) {
  return cache.get(collect, Date.now(), schedule);
}
