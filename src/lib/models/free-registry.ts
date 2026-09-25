// M49: the free-model-first runtime policy.
//
// Osirus must answer without paid credit. The models it may answer with are
// the free models UnoRouter actually lists for the configured key -- never an
// invented ID. This module is pure (no fetch, no env, no clock of its own) so
// discovery, selection, pacing and cooldowns are unit tested exactly as they
// run in production.
//
// Rules this module enforces:
// - A candidate exists only if GET /v1/models returned its ID for a key. The
//   public catalog (GET /api/pricing, no key) may only *annotate* a listed ID
//   (free flag, context window, max output, chat capability); it never adds
//   one.
// - Resilience rotates across verified free models, not across keys. A 429 on
//   free model A cools down *model A* (honouring Retry-After) and the next
//   request goes to free model B. Keys are never touched by this module.
// - Pacing: repeated requests are spread across the pool (least recently
//   used first among equally healthy models) and a model is not sent a new
//   request inside its minimum interval while another model is ready.

export type FailureCategory =
  | "rate_limited"
  | "provider_unavailable"
  | "timeout"
  | "insufficient_credit"
  | "model_not_configured"
  | "credential_rejected"
  | "invalid_response"
  | "provider_error";

export type ModelHealth = "unknown" | "healthy" | "degraded" | "failing";

export type FreeModelCandidate = {
  id: string;
  /** Labels (KEY_1, KEY_2, ...) of the keys whose /v1/models listed it. */
  availableToKeys: string[];
  free: boolean;
  /** Why the model counts as free: the public catalog flag or the ID suffix. */
  freeEvidence: "catalog" | "id_suffix";
  contextLength: number | null;
  maxOutputTokens: number | null;
  supportsTools: boolean | null;
  lastHealth: ModelHealth;
  lastHealthAt: number | null;
  lastSuccessAt: number | null;
  lastFailureAt: number | null;
  failureCategory: FailureCategory | null;
  cooldownUntil: number | null;
  consecutiveFailures: number;
  consecutiveRateLimits: number;
  successes: number;
  failures: number;
  lastUsedAt: number | null;
  /** Exponentially weighted latency of successful calls. */
  latencyMs: number | null;
};

export type ListedModel = {
  id: string;
  contextLength: number | null;
  maxOutputTokens: number | null;
};

export type CatalogEntry = {
  id: string;
  isFree: boolean;
  online: boolean;
  chatCapable: boolean;
  deprecated: boolean;
  contextLength: number | null;
  maxOutputTokens: number | null;
  supportsTools: boolean | null;
};

function dataArray(body: unknown): unknown[] {
  if (!body || typeof body !== "object") return [];
  const data = (body as { data?: unknown }).data;
  return Array.isArray(data) ? data : [];
}

const num = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : null;

/** Model entries from an OpenAI-compatible GET /v1/models body. */
export function parseModelList(body: unknown): ListedModel[] {
  const data = dataArray(body);
  const seen = new Set<string>();
  const models: ListedModel[] = [];
  for (const raw of data) {
    if (!raw || typeof raw !== "object") continue;
    const entry = raw as Record<string, unknown>;
    const id = typeof entry.id === "string" ? entry.id.trim() : "";
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const topProvider =
      entry.top_provider && typeof entry.top_provider === "object"
        ? (entry.top_provider as Record<string, unknown>)
        : {};
    models.push({
      id,
      contextLength:
        num(entry.context_length) ??
        num(entry.context_window) ??
        num(topProvider.context_length),
      maxOutputTokens:
        num(entry.max_output_tokens) ??
        num(entry.max_completion_tokens) ??
        num(topProvider.max_completion_tokens),
    });
  }
  return models;
}

const NON_CHAT_MODES = new Set([
  "embedding",
  "image",
  "image_generation",
  "audio_transcription",
  "audio_speech",
  "rerank",
  "moderation",
  "video",
]);

/** Entries from the public UnoRouter catalog (GET /api/pricing). */
export function parseCatalog(body: unknown): Map<string, CatalogEntry> {
  const data = dataArray(body);
  const entries = new Map<string, CatalogEntry>();
  for (const raw of data) {
    if (!raw || typeof raw !== "object") continue;
    const entry = raw as Record<string, unknown>;
    const id = typeof entry.model_name === "string" ? entry.model_name : "";
    if (!id) continue;
    let metadata: Record<string, unknown> = {};
    if (typeof entry.metadata === "string" && entry.metadata) {
      try {
        const parsed = JSON.parse(entry.metadata);
        if (parsed && typeof parsed === "object") metadata = parsed;
      } catch {
        metadata = {};
      }
    } else if (entry.metadata && typeof entry.metadata === "object") {
      metadata = entry.metadata as Record<string, unknown>;
    }
    const tags = typeof entry.tags === "string" ? entry.tags : "";
    const endpoints = Array.isArray(entry.supported_endpoint_types)
      ? (entry.supported_endpoint_types as unknown[])
      : null;
    const mode = typeof metadata.mode === "string" ? metadata.mode : null;
    const deprecation =
      typeof metadata.deprecationDate === "string"
        ? Date.parse(metadata.deprecationDate)
        : NaN;
    entries.set(id, {
      id,
      isFree: entry.is_free === true,
      online: entry.online !== false,
      chatCapable:
        (mode === null || !NON_CHAT_MODES.has(mode)) &&
        (endpoints === null || endpoints.includes("openai")) &&
        !/\b(Embedding|Image)\b/.test(tags.split(",")[0] ?? ""),
      deprecated:
        /(^|,)Deprecated(,|$)/.test(tags) ||
        (Number.isFinite(deprecation) && deprecation < Date.now()),
      contextLength:
        num(metadata.contextWindow) ?? num(metadata.maxInputTokens),
      maxOutputTokens: num(metadata.maxOutputTokens),
      supportsTools:
        typeof metadata.supportsTools === "boolean"
          ? metadata.supportsTools
          : null,
    });
  }
  return entries;
}

/** Heuristic used only when the catalog is unavailable. */
const NON_CHAT_ID =
  /(embed|whisper|tts|speech|transcri|rerank|flux|sdxl|diffusion-xl|image|moderation|guard-only)/i;

export function isFreeId(id: string) {
  return /:free$/i.test(id);
}

export type BuildRegistryInput = {
  /** /v1/models results per key label; only these IDs can become candidates. */
  listedByKey: Array<{ label: string; models: ListedModel[] }>;
  catalog?: Map<string, CatalogEntry> | null;
  /** Free models an operator prefers, e.g. OSIRUS_MODEL_STRONG=x:free. */
  preferred?: string[];
  /** IDs Osirus has previously run successfully (models/free.ts). */
  known?: readonly string[];
  maxPoolSize?: number;
  /** Carry health/cooldown state over from the previous registry. */
  previous?: FreeModelCandidate[];
};

export const DEFAULT_POOL_SIZE = 8;

export function emptyCandidate(
  id: string,
  partial: Partial<FreeModelCandidate> = {},
): FreeModelCandidate {
  return {
    id,
    availableToKeys: [],
    free: true,
    freeEvidence: "id_suffix",
    contextLength: null,
    maxOutputTokens: null,
    supportsTools: null,
    lastHealth: "unknown",
    lastHealthAt: null,
    lastSuccessAt: null,
    lastFailureAt: null,
    failureCategory: null,
    cooldownUntil: null,
    consecutiveFailures: 0,
    consecutiveRateLimits: 0,
    successes: 0,
    failures: 0,
    lastUsedAt: null,
    latencyMs: null,
    ...partial,
  };
}

/**
 * The verified free-model registry: every free, chat-capable model a key
 * listed, annotated from the catalog, bounded to `maxPoolSize`.
 */
export function buildFreeRegistry(
  input: BuildRegistryInput,
): FreeModelCandidate[] {
  const catalog = input.catalog ?? null;
  const previous = new Map((input.previous ?? []).map((c) => [c.id, c]));
  const byId = new Map<string, FreeModelCandidate>();

  for (const { label, models } of input.listedByKey) {
    for (const model of models) {
      const existing = byId.get(model.id);
      if (existing) {
        if (!existing.availableToKeys.includes(label))
          existing.availableToKeys.push(label);
        continue;
      }
      const entry = catalog?.get(model.id);
      const free = entry
        ? entry.isFree || isFreeId(model.id)
        : isFreeId(model.id);
      if (!free) continue;
      if (entry && (!entry.chatCapable || !entry.online || entry.deprecated))
        continue;
      if (!entry && NON_CHAT_ID.test(model.id)) continue;
      const prior = previous.get(model.id);
      byId.set(
        model.id,
        emptyCandidate(model.id, {
          ...(prior ?? {}),
          availableToKeys: [label],
          free: true,
          freeEvidence: entry?.isFree ? "catalog" : "id_suffix",
          contextLength: model.contextLength ?? entry?.contextLength ?? null,
          maxOutputTokens:
            model.maxOutputTokens ?? entry?.maxOutputTokens ?? null,
          supportsTools: entry?.supportsTools ?? null,
        }),
      );
    }
  }

  const preferred = input.preferred ?? [];
  const known = input.known ?? [];
  const rank = (candidate: FreeModelCandidate) => {
    const preferredIndex = preferred.indexOf(candidate.id);
    const knownIndex = known.indexOf(candidate.id);
    return [
      preferredIndex >= 0 ? preferredIndex : Number.MAX_SAFE_INTEGER,
      candidate.lastSuccessAt ? 0 : 1,
      knownIndex >= 0 ? knownIndex : Number.MAX_SAFE_INTEGER,
      candidate.supportsTools === true ? 0 : 1,
      // Larger context first; unknown context last.
      -(candidate.contextLength ?? 0),
    ];
  };
  const ordered = [...byId.values()].sort((a, b) => {
    const ra = rank(a);
    const rb = rank(b);
    for (let i = 0; i < ra.length; i += 1)
      if (ra[i] !== rb[i]) return ra[i] - rb[i];
    return a.id.localeCompare(b.id);
  });
  const size = Math.max(1, input.maxPoolSize ?? DEFAULT_POOL_SIZE);
  return ordered.slice(0, size);
}

export type PoolOptions = {
  /** Minimum gap between two requests to the same free model. */
  minIntervalMs?: number;
  /** Cooldown after a 429 without Retry-After; doubles per repeat. */
  rateLimitBaseMs?: number;
  rateLimitMaxMs?: number;
  unavailableBaseMs?: number;
  unavailableMaxMs?: number;
  /** A free model that says "no credit"/"unknown model" is parked this long. */
  permanentCooldownMs?: number;
};

const DEFAULTS: Required<PoolOptions> = {
  minIntervalMs: 2_000,
  rateLimitBaseMs: 30_000,
  rateLimitMaxMs: 15 * 60_000,
  unavailableBaseMs: 15_000,
  unavailableMaxMs: 5 * 60_000,
  permanentCooldownMs: 6 * 60 * 60_000,
};

export type SelectInput = {
  now: number;
  /** Estimated prompt + completion tokens this request needs. */
  minContextTokens?: number;
  /** Models already tried for this request. */
  exclude?: Iterable<string>;
};

export type Selection =
  | { kind: "ready"; candidate: FreeModelCandidate }
  /** Every eligible model is cooling down or paced; the soonest opening. */
  | { kind: "wait"; candidate: FreeModelCandidate; waitMs: number }
  | { kind: "none"; reason: "empty" | "context" | "exhausted" };

/**
 * A bounded pool of verified free models with health, cooldown and pacing.
 * One instance per server process; state is in memory and rebuilt from
 * discovery, which is fine for a serverless fleet: cooldowns are advisory
 * and the provider's own 429 is always the final word.
 */
export class FreeModelPool {
  private readonly options: Required<PoolOptions>;
  private candidates: FreeModelCandidate[] = [];

  constructor(
    candidates: FreeModelCandidate[] = [],
    options: PoolOptions = {},
  ) {
    this.options = { ...DEFAULTS, ...options };
    this.candidates = candidates.map((c) => ({ ...c }));
  }

  replace(candidates: FreeModelCandidate[]) {
    this.candidates = candidates.map((c) => ({ ...c }));
  }

  snapshot(): FreeModelCandidate[] {
    return this.candidates.map((c) => ({
      ...c,
      availableToKeys: [...c.availableToKeys],
    }));
  }

  ids() {
    return this.candidates.map((c) => c.id);
  }

  has(id: string) {
    return this.candidates.some((c) => c.id === id);
  }

  get size() {
    return this.candidates.length;
  }

  private get(id: string) {
    return this.candidates.find((c) => c.id === id);
  }

  private fits(candidate: FreeModelCandidate, minContextTokens?: number) {
    if (!minContextTokens) return true;
    // Unknown context is allowed; it is ranked below a known fit.
    return (
      candidate.contextLength === null ||
      candidate.contextLength >= minContextTokens
    );
  }

  private score(candidate: FreeModelCandidate, now: number) {
    const health: Record<ModelHealth, number> = {
      healthy: 3,
      unknown: 2,
      degraded: 1,
      failing: 0,
    };
    let score = health[candidate.lastHealth] * 10;
    const attempts = candidate.successes + candidate.failures;
    if (attempts > 0) score += (candidate.successes / attempts) * 10;
    // A recent rate limit is a hint the model is contended even after its
    // cooldown ends: prefer another model while one is available.
    if (candidate.consecutiveRateLimits > 0)
      score -= 5 * candidate.consecutiveRateLimits;
    if (candidate.lastFailureAt && now - candidate.lastFailureAt < 60_000)
      score -= 3;
    return score;
  }

  select(input: SelectInput): Selection {
    if (!this.candidates.length) return { kind: "none", reason: "empty" };
    const excluded = new Set(input.exclude ?? []);
    const pool = this.candidates.filter((c) => !excluded.has(c.id));
    if (!pool.length) return { kind: "none", reason: "exhausted" };
    const fitting = pool.filter((c) => this.fits(c, input.minContextTokens));
    if (!fitting.length) return { kind: "none", reason: "context" };

    const { now } = input;
    const opensAt = (c: FreeModelCandidate) =>
      Math.max(
        c.cooldownUntil ?? 0,
        c.lastUsedAt !== null ? c.lastUsedAt + this.options.minIntervalMs : 0,
      );
    const ready = fitting.filter((c) => opensAt(c) <= now);
    if (ready.length) {
      const knownFit = (c: FreeModelCandidate) =>
        input.minContextTokens && c.contextLength === null ? 0 : 1;
      ready.sort(
        (a, b) =>
          knownFit(b) - knownFit(a) ||
          this.score(b, now) - this.score(a, now) ||
          // Pacing: spread load -- least recently used first.
          (a.lastUsedAt ?? -1) - (b.lastUsedAt ?? -1) ||
          this.candidates.indexOf(a) - this.candidates.indexOf(b),
      );
      return { kind: "ready", candidate: { ...ready[0] } };
    }
    const soonest = [...fitting].sort((a, b) => opensAt(a) - opensAt(b))[0];
    return {
      kind: "wait",
      candidate: { ...soonest },
      waitMs: Math.max(0, opensAt(soonest) - now),
    };
  }

  /** Mark a model as having been sent a request (pacing). */
  markUsed(id: string, now: number) {
    const candidate = this.get(id);
    if (candidate) candidate.lastUsedAt = now;
  }

  recordSuccess(id: string, now: number, latencyMs?: number) {
    const candidate = this.get(id);
    if (!candidate) return;
    candidate.successes += 1;
    candidate.consecutiveFailures = 0;
    candidate.consecutiveRateLimits = 0;
    candidate.lastSuccessAt = now;
    candidate.lastHealth = "healthy";
    candidate.lastHealthAt = now;
    candidate.failureCategory = null;
    candidate.cooldownUntil = null;
    if (latencyMs !== undefined && latencyMs >= 0)
      candidate.latencyMs =
        candidate.latencyMs === null
          ? latencyMs
          : Math.round(candidate.latencyMs * 0.7 + latencyMs * 0.3);
  }

  /**
   * Record a failure and set the model's cooldown. Returns the cooldown end.
   * `retryAfterMs` (from Retry-After or the body) is always honoured as a
   * floor: the pool never sends that model a request before the provider
   * said it may.
   */
  recordFailure(
    id: string,
    category: FailureCategory,
    now: number,
    retryAfterMs?: number,
  ): number | null {
    const candidate = this.get(id);
    if (!candidate) return null;
    const o = this.options;
    candidate.failures += 1;
    candidate.consecutiveFailures += 1;
    candidate.lastFailureAt = now;
    candidate.failureCategory = category;
    candidate.lastHealthAt = now;
    let cooldown = 0;
    switch (category) {
      case "rate_limited": {
        candidate.consecutiveRateLimits += 1;
        // The provider's Retry-After is the cooldown when it gives one; a
        // bare 429 backs off exponentially per consecutive rate limit.
        cooldown =
          retryAfterMs && retryAfterMs > 0
            ? Math.min(o.rateLimitMaxMs * 4, retryAfterMs)
            : Math.min(
                o.rateLimitMaxMs,
                o.rateLimitBaseMs * 2 ** (candidate.consecutiveRateLimits - 1),
              );
        candidate.lastHealth = "degraded";
        break;
      }
      case "provider_unavailable":
      case "timeout":
      case "invalid_response":
      case "provider_error":
        cooldown = Math.min(
          o.unavailableMaxMs,
          o.unavailableBaseMs * 2 ** (candidate.consecutiveFailures - 1),
        );
        candidate.lastHealth =
          candidate.consecutiveFailures >= 3 ? "failing" : "degraded";
        break;
      case "insufficient_credit":
      case "model_not_configured":
        cooldown = o.permanentCooldownMs;
        candidate.lastHealth = "failing";
        break;
      case "credential_rejected":
        // A key problem, not a model problem: do not punish the model.
        cooldown = 0;
        break;
    }
    if (retryAfterMs && retryAfterMs > cooldown) cooldown = retryAfterMs;
    candidate.cooldownUntil =
      cooldown > 0 ? now + cooldown : candidate.cooldownUntil;
    return candidate.cooldownUntil;
  }
}

/** Rough token estimate for context-aware selection (4 chars per token). */
export function estimateTokens(messages: unknown[], reserveOutput = 2_048) {
  let chars = 0;
  for (const message of messages) {
    const content = (message as { content?: unknown } | null)?.content;
    if (typeof content === "string") chars += content.length;
    else if (content !== undefined) chars += JSON.stringify(content).length;
  }
  return Math.ceil(chars / 4) + reserveOutput;
}
