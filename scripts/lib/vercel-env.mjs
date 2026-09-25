// Pure helpers for the Vercel runtime-configuration sync.
// Extracted so the coverage rules can be unit tested: a false negative here
// silently blocks every runtime secret from reaching production.

/**
 * Vercel returns `target` as an array on modern API versions and as a bare
 * string on older ones. Normalise both into an array.
 */
export function environmentTargets(environment) {
  if (Array.isArray(environment.target)) return environment.target;
  return environment.target ? [environment.target] : [];
}

/**
 * True when `environment` applies to `target` for the deployment we care about.
 *
 * Vercel stores one row per target, and a row may additionally be pinned to a
 * single git branch. A branch-pinned row only applies to preview deployments of
 * that branch, so it must not be counted as covering preview in general.
 */
export function environmentApplies(environment, key, target, gitBranch) {
  if (environment.key !== key) return false;
  if (!environmentTargets(environment).includes(target)) return false;
  if (!environment.gitBranch) return true;
  return target === "preview" && environment.gitBranch === gitBranch;
}

/**
 * Targets from `targets` that no row in `environments` covers for `key`.
 *
 * Coverage is evaluated per target across the union of rows. The previous
 * implementation asked whether a *single* row covered *every* target, which no
 * correctly-configured Vercel project can ever satisfy once more than one
 * target is requested.
 */
export function uncoveredTargets(environments, key, targets, gitBranch) {
  return targets.filter(
    (target) =>
      !environments.some((environment) =>
        environmentApplies(environment, key, target, gitBranch),
      ),
  );
}

/** True when every requested target is covered for `key`. */
export function coversTargets(environments, key, targets, gitBranch) {
  return uncoveredTargets(environments, key, targets, gitBranch).length === 0;
}

/** True when at least one row exists for `key`, on any target or branch. */
export function hasAnyValue(environments, key) {
  return environments.some((environment) => environment.key === key);
}

/** The UnoRouter keys the runtime sync manages, all three, always. */
export const UNOROUTER_KEY_NAMES = [
  "UNOROUTER_API_KEY_1",
  "UNOROUTER_API_KEY_2",
  "UNOROUTER_API_KEY_3",
];

export const MODEL_ROLE_KEYS = [
  "FAST",
  "STRONG",
  "THINKING",
  "CODING",
  "RESEARCH",
  "MATH",
  "VERIFY",
].map((role) => `OSIRUS_MODEL_${role}`);

/** Role value meaning "serve this role from the verified free-model pool". */
export const FREE_POOL_SENTINEL = "free";

export function parseModelPolicy(value) {
  const policy = (value ?? "").trim() || "free-first";
  if (policy === "free-first" || policy === "configured-first") return policy;
  throw new Error("OSIRUS_MODEL_POLICY must be free-first or configured-first");
}

/**
 * M49 free-model-first policy. Every role is written as the pool sentinel
 * unless an operator explicitly supplied a model ID that the key actually
 * lists. A paid model is only used together with configured-first; under
 * free-first it is ignored (the runtime would ignore it too), so the legacy
 * grok-4.6 default can never be written again. Model IDs are never
 * invented: `listedIds` is /v1/models.
 */
export function resolveRoleModel({ requested, policy, listedIds }) {
  const model = (requested ?? "").trim();
  if (!model || model.toLowerCase() === FREE_POOL_SENTINEL)
    return FREE_POOL_SENTINEL;
  // Under free-first a paid ID is ignored, not an error: the pre-M49 workflow
  // still passes its legacy `grok-4.6` default, and that must not stop the
  // keys and the free-pool roles from being synced.
  if (!/:free$/i.test(model) && policy !== "configured-first")
    return FREE_POOL_SENTINEL;
  if (!listedIds.has(model))
    throw new Error(
      "The requested primary model is not listed by UnoRouter for the configured key",
    );
  return model;
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

/**
 * Free, chat-capable model IDs from /v1/models, ranked with the public
 * catalog (if available) like the runtime registry: known working first,
 * then tool support, then larger context. Only listed IDs are returned.
 */
export function rankFreeModels(listedIds, catalogBody, known = []) {
  const catalog = new Map();
  const data = Array.isArray(catalogBody?.data) ? catalogBody.data : [];
  for (const entry of data) {
    if (typeof entry?.model_name !== "string") continue;
    let metadata = {};
    try {
      metadata =
        typeof entry.metadata === "string" && entry.metadata
          ? JSON.parse(entry.metadata)
          : (entry.metadata ?? {});
    } catch {
      metadata = {};
    }
    catalog.set(entry.model_name, { entry, metadata });
  }
  const candidates = [];
  for (const id of listedIds) {
    const annotated = catalog.get(id);
    const free = annotated
      ? annotated.entry.is_free === true || /:free$/i.test(id)
      : /:free$/i.test(id);
    if (!free) continue;
    if (annotated) {
      const { entry, metadata } = annotated;
      const endpoints = Array.isArray(entry.supported_endpoint_types)
        ? entry.supported_endpoint_types
        : null;
      if (
        typeof metadata.mode === "string" &&
        NON_CHAT_MODES.has(metadata.mode)
      )
        continue;
      if (endpoints && !endpoints.includes("openai")) continue;
      if (entry.online === false) continue;
      if (/(^|,)Deprecated(,|$)/.test(entry.tags ?? "")) continue;
    } else if (
      /(embed|whisper|tts|speech|transcri|rerank|flux|sdxl|image|moderation)/i.test(
        id,
      )
    ) {
      continue;
    }
    candidates.push({
      id,
      known: known.indexOf(id),
      tools: annotated?.metadata?.supportsTools === true ? 0 : 1,
      context: Number(annotated?.metadata?.contextWindow) || 0,
    });
  }
  candidates.sort(
    (a, b) =>
      (a.known < 0 ? Infinity : a.known) - (b.known < 0 ? Infinity : b.known) ||
      a.tools - b.tools ||
      b.context - a.context ||
      a.id.localeCompare(b.id),
  );
  return candidates.map((c) => c.id);
}

/**
 * Targets where no applicable row for `key` was updated at or after
 * `sinceMs`: proof a value was actually rewritten, not merely present.
 */
export function staleTargets(environments, key, targets, sinceMs, gitBranch) {
  return targets.filter(
    (target) =>
      !environments.some(
        (environment) =>
          environmentApplies(environment, key, target, gitBranch) &&
          Number(environment.updatedAt ?? 0) >= sinceMs,
      ),
  );
}

/** Branch-pinned preview rows for `key`: they override the general row. */
export function branchPinnedRows(environments, key) {
  return environments
    .filter(
      (environment) =>
        environment.key === key &&
        environment.gitBranch &&
        environmentTargets(environment).includes("preview"),
    )
    .map((environment) => environment.gitBranch);
}

export function parseTargetList(value) {
  const target = value ?? "both";
  if (target === "preview") return ["preview"];
  if (target === "production") return ["production"];
  if (target === "both") return ["preview", "production"];
  throw new Error("OSIRUS_SYNC_TARGET must be preview, production, or both");
}

/**
 * Read an optional secret from the environment, treating blank as absent.
 *
 * A GitHub secret that exists but is empty arrives as "". That is falsy but not
 * nullish, so `??` will not fall back past it -- an empty secret would be
 * synced verbatim, or silently suppress the value meant to replace it.
 */
export function optionalSecret(value) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}
