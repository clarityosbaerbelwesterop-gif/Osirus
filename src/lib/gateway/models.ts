import { createHmac } from "node:crypto";
import { env } from "@/lib/env";
import { catalogModel } from "@/lib/models/catalog";
import { tierOf, type ModelTier } from "./routing";
import {
  configuredProviders,
  formatModelRef,
  parseModelRef,
  providerById,
  type ProviderId,
  type ProviderSpec,
} from "./providers";

// Live model lists of every configured provider, cached per instance.
// A list is fresh for 10 minutes; after that the stale list is served while
// one refresh runs. A provider whose list cannot be read contributes no
// models, and a model that answered "not found" is hidden for an hour.

export type GatewayModel = {
  /** "<provider>:<model id>" -- the value pickers send. */
  ref: string;
  provider: ProviderId;
  providerLabel: string;
  id: string;
  name: string;
  vendor: string;
  /** No money per call (":free" variants, zero-priced, NVIDIA trial credits). */
  free: boolean;
  /** Thinks before answering (shows a reasoning trace). */
  reasoning: boolean;
  contextLength: number | null;
  inputPerMillionUsd: number | null;
  outputPerMillionUsd: number | null;
  /** Lower is better; drives order and the default. */
  rank: number;
};

const FRESH_MS = 10 * 60 * 1000;
const STALE_MS = 6 * 60 * 60 * 1000;
const LIST_TIMEOUT_MS = 6000;
const HIDE_MS = 60 * 60 * 1000;

const NON_CHAT =
  /(embed|rerank|whisper|\btts\b|text-to-speech|speech|\basr\b|audio|transcri|stable-diffusion|sdxl|\bsd3|flux|dall-?e|imagen|image-gen|\bclip\b|nvclip|moderation|guard|safety|parakeet|canary|riva|fastpitch|paligemma|kosmos|deplot|\bocr\b|bge-|\be5-|gte-|retriever|reward|cosmos|video|segment|detect|depth|upscal|inpaint|controlnet|nv-yolox|grounding-dino|ai-synthetic|tokenizer|voyage|lyria|music|[-/]parse\b|nemotron-parse|\bvila\b|\bneva\b|fuyu|diffusion|calibration|apnea|router\b|-router|auto-router)/i;

const REASONING =
  /(\br1\b|-r1|reasoner|thinking|\bo1\b|\bo3\b|\bo4\b|qwq|grok-4|gpt-5|-think|magistral|nemotron-ultra|nemotron-super|deepseek-v3\.1|kimi-k2-thinking|qwen3-235b|phi-4-reasoning)/i;

/** Ordered families: earlier is ranked higher in pickers and defaults. */
const FAMILY_RANK: Array<[RegExp, number]> = [
  [/claude[-.]?(opus|sonnet)[-.]?4|claude-(opus|sonnet)/i, 10],
  [/gpt-5/i, 12],
  [/gemini[-.]?(3|2\.5)[-.]?pro/i, 14],
  [/grok-4/i, 16],
  [/\bo3\b|\bo4\b/i, 18],
  [/deepseek[-.]?(v3|r1|chat|reasoner)/i, 20],
  [/qwen3/i, 22],
  [/kimi[-.]?k2/i, 24],
  [/glm[-.]?(4\.[5-9]|5)/i, 26],
  [/gemini/i, 28],
  [/claude/i, 30],
  [/gpt-4\.1|gpt-4o/i, 32],
  [/llama[-.]?4|llama-3\.[13]-(70|405)b|nemotron/i, 34],
  [/mistral[-.]?(large|medium)|codestral|devstral/i, 36],
  [/gpt-oss/i, 38],
  [/qwen/i, 40],
  [/llama/i, 50],
  [/mistral|mixtral/i, 52],
  [/gemma|phi/i, 60],
];

const VENDORS: Record<string, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  google: "Google",
  "x-ai": "xAI",
  xai: "xAI",
  "meta-llama": "Meta",
  meta: "Meta",
  "deepseek-ai": "DeepSeek",
  deepseek: "DeepSeek",
  qwen: "Qwen",
  moonshotai: "Moonshot",
  "z-ai": "Zhipu",
  thudm: "Zhipu",
  mistralai: "Mistral",
  nvidia: "NVIDIA",
  microsoft: "Microsoft",
  ibm: "IBM",
};

const UPPER = new Set([
  "gpt",
  "glm",
  "qwq",
  "r1",
  "vl",
  "it",
  "ai",
  "oss",
  "moe",
]);

const BRANDS: Record<string, string> = {
  deepseek: "DeepSeek",
  openai: "OpenAI",
  chatgpt: "ChatGPT",
  nemotron: "Nemotron",
  minimax: "MiniMax",
  phi: "Phi",
};

export function prettyModelName(id: string) {
  const base = (id.split("/").pop() ?? id).replace(/:free$/i, "");
  return base
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((word) => {
      if (/^\d+(\.\d+)?[bmkt]$/i.test(word)) return word.toUpperCase();
      if (/^v\d/i.test(word)) return word.toUpperCase();
      if (UPPER.has(word.toLowerCase())) return word.toUpperCase();
      const brand = BRANDS[word.toLowerCase()];
      if (brand) return brand;
      return word[0].toUpperCase() + word.slice(1);
    })
    .join(" ");
}

function vendorOf(id: string, fallback: string) {
  const prefix = id.includes("/") ? id.split("/")[0].toLowerCase() : "";
  if (prefix && VENDORS[prefix]) return VENDORS[prefix];
  if (prefix) return prefix[0].toUpperCase() + prefix.slice(1);
  return fallback;
}

export function familyRank(id: string) {
  for (const [pattern, rank] of FAMILY_RANK) {
    if (pattern.test(id)) return rank;
  }
  return 80;
}

export function isChatModelId(id: string) {
  return !NON_CHAT.test(id);
}

export function isReasoningModelId(id: string) {
  return REASONING.test(id);
}

function num(value: unknown): number | null {
  const parsed = typeof value === "string" ? Number(value) : value;
  return typeof parsed === "number" && Number.isFinite(parsed) ? parsed : null;
}

type RawEntry = Record<string, unknown>;

function entries(body: unknown): RawEntry[] {
  if (Array.isArray(body)) return body.filter(isObject);
  if (isObject(body) && Array.isArray(body.data))
    return body.data.filter(isObject);
  if (isObject(body) && Array.isArray(body.models))
    return body.models.filter(isObject);
  return [];
}

function isObject(value: unknown): value is RawEntry {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function textOutput(entry: RawEntry) {
  const architecture = isObject(entry.architecture) ? entry.architecture : null;
  if (!architecture) return true;
  const outputs = architecture.output_modalities;
  if (Array.isArray(outputs)) return outputs.includes("text");
  const modality = architecture.modality;
  return typeof modality !== "string" || /->.*text/.test(modality);
}

/** One provider's /models body -> gateway models (chat models only). */
export function parseProviderModels(
  provider: Pick<ProviderSpec, "id" | "label" | "freeByDefault">,
  body: unknown,
): GatewayModel[] {
  const seen = new Set<string>();
  const models: GatewayModel[] = [];
  for (const entry of entries(body)) {
    const id = typeof entry.id === "string" ? entry.id.trim() : "";
    if (!id || seen.has(id) || id.length > 200) continue;
    seen.add(id);
    if (!isChatModelId(id) || !textOutput(entry)) continue;

    let input: number | null = null;
    let output: number | null = null;
    const pricing = isObject(entry.pricing) ? entry.pricing : null;
    if (pricing) {
      const prompt = num(pricing.prompt);
      const completion = num(pricing.completion);
      input = prompt === null ? null : prompt * 1_000_000;
      output = completion === null ? null : completion * 1_000_000;
    }
    if (provider.id === "unorouter") {
      const row = catalogModel(id);
      if (row && !row.chat) continue;
      if (row) {
        input = row.inputPerMillionUsd;
        output = row.outputPerMillionUsd;
      }
    }
    const zeroPriced = input === 0 && output === 0;
    const free =
      Boolean(provider.freeByDefault) || /:free$/i.test(id) || zeroPriced;
    const rawName = typeof entry.name === "string" ? entry.name.trim() : "";
    const name =
      rawName && rawName.length <= 80
        ? rawName.replace(/^[^:]{1,40}:\s*/, "").replace(/\s*\(free\)$/i, "")
        : prettyModelName(id);
    const rank =
      familyRank(id) +
      (free ? 1 : 0) +
      (/(mini|nano|small|lite|flash|8b|7b|3b|1b|instruct-1b)/i.test(id)
        ? 4
        : 0);
    models.push({
      ref: formatModelRef({ provider: provider.id, model: id }),
      provider: provider.id,
      providerLabel: provider.label,
      id,
      name,
      vendor: vendorOf(id, provider.label),
      free,
      reasoning: isReasoningModelId(id),
      contextLength:
        num(entry.context_length) ??
        num(entry.context_window) ??
        num(entry.max_model_len),
      inputPerMillionUsd: input,
      outputPerMillionUsd: output,
      rank,
    });
  }
  return models;
}

const DEFAULT_BYTEZ_MODELS = [
  "Qwen/Qwen3.8-27B",
  "Qwen/Qwen3-4B",
  "meta-llama/Llama-3.1-8B-Instruct",
  "microsoft/Phi-4-mini-instruct",
  "google/gemma-3-4b-it",
];

/**
 * Bytez models the runtime sync tries with a real question; those that answer
 * become OSIRUS_BYTEZ_MODELS, so the lists only offer what Bytez serves.
 */
export const BYTEZ_CANDIDATES = [
  ...DEFAULT_BYTEZ_MODELS,
  "Qwen/Qwen3.8-27B-FP8",
  "Qwen/Qwen3.8-Flash-Next",
];

function bytezModels(provider: ProviderSpec) {
  const ids = (env.OSIRUS_BYTEZ_MODELS ?? process.env.OSIRUS_BYTEZ_MODELS)
    ?.split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  // "none": the runtime sync found no Bytez model that answers.
  if (ids?.length === 1 && ids[0] === "none") return [];
  return parseProviderModels(
    provider,
    (ids?.length ? ids : DEFAULT_BYTEZ_MODELS).map((id) => ({ id })),
  );
}

type CacheEntry = { at: number; models: GatewayModel[]; ok: boolean };

const cache = new Map<ProviderId, CacheEntry>();
const inflight = new Map<ProviderId, Promise<CacheEntry>>();
const hidden = new Map<string, number>();
// Providers that refused a paid model for missing credit, until when.
const unfunded = new Map<ProviderId, number>();

// How each model behaved lately on this instance: failures and time to the
// first token. Routing puts slow or failing models behind the others.
const HEALTH_MS = 10 * 60 * 1000;
const health = new Map<string, { at: number; ok: boolean; ms: number }[]>();

export function noteModelResult(
  ref: string,
  result: { ok: boolean; firstTokenMs: number },
  now = Date.now(),
) {
  const list = (health.get(ref) ?? []).filter(
    (row) => now - row.at < HEALTH_MS,
  );
  list.push({ at: now, ok: result.ok, ms: result.firstTokenMs });
  health.set(ref, list.slice(-12));
}

/** Rank penalty for a model that failed or answered slowly in the last minutes. */
export function modelPenalty(ref: string, now = Date.now()) {
  const list = (health.get(ref) ?? []).filter(
    (row) => now - row.at < HEALTH_MS,
  );
  if (!list.length) return 0;
  const failures = list.filter((row) => !row.ok).length;
  const ok = list.filter((row) => row.ok);
  const average = ok.length
    ? ok.reduce((sum, row) => sum + row.ms, 0) / ok.length
    : 0;
  return (
    Math.min(failures, 3) * 20 +
    (average > 15_000 ? 20 : average > 8_000 ? 10 : 0)
  );
}

async function fetchList(
  provider: ProviderSpec,
  fetchImpl: typeof fetch,
  now: number,
): Promise<CacheEntry> {
  if (provider.id === "bytez" || !provider.modelsUrl) {
    return {
      at: now,
      models: provider.id === "bytez" ? bytezModels(provider) : [],
      ok: provider.id === "bytez",
    };
  }
  for (const key of provider.keys) {
    try {
      const response = await fetchImpl(provider.modelsUrl, {
        headers: {
          Authorization: `Bearer ${key}`,
          Accept: "application/json",
          ...provider.headers,
        },
        cache: "no-store",
        signal: AbortSignal.timeout(LIST_TIMEOUT_MS),
      });
      if (!response.ok) continue;
      const models = parseProviderModels(provider, await response.json());
      return { at: now, models, ok: true };
    } catch {
      // next key
    }
  }
  return { at: now, models: [], ok: false };
}

async function providerModels(
  provider: ProviderSpec,
  fetchImpl: typeof fetch,
  now: number,
): Promise<CacheEntry> {
  const cached = cache.get(provider.id);
  const refresh = () => {
    const running = inflight.get(provider.id);
    if (running) return running;
    const next = fetchList(provider, fetchImpl, now)
      .then((entry) => {
        const previous = cache.get(provider.id);
        // Keep the last good list through a failed refresh, for a while.
        if (!entry.ok && previous?.ok && now - previous.at < STALE_MS) {
          const kept = { ...previous, at: now - FRESH_MS + 60_000 };
          cache.set(provider.id, kept);
          return kept;
        }
        cache.set(provider.id, entry);
        return entry;
      })
      .finally(() => inflight.delete(provider.id));
    inflight.set(provider.id, next);
    return next;
  };
  if (cached && now - cached.at < FRESH_MS) return cached;
  if (cached && cached.ok && now - cached.at < STALE_MS) {
    void refresh().catch(() => undefined);
    return cached;
  }
  return refresh();
}

export type ProviderStatus = {
  id: ProviderId;
  label: string;
  ok: boolean;
  models: number;
};

/** Every chat model the configured keys can call, best first. */
export async function listGatewayModels(options?: {
  fetchImpl?: typeof fetch;
  now?: number;
}): Promise<{ models: GatewayModel[]; providers: ProviderStatus[] }> {
  const now = options?.now ?? Date.now();
  const fetchImpl = options?.fetchImpl ?? fetch;
  const providers = configuredProviders();
  const lists = await Promise.all(
    providers.map((provider) => providerModels(provider, fetchImpl, now)),
  );
  const models: GatewayModel[] = [];
  const status: ProviderStatus[] = [];
  providers.forEach((provider, index) => {
    const paidBlocked = noCredit(provider.id, now);
    const list = lists[index].models.filter((model) => {
      if (paidBlocked && !model.free) return false;
      const until = hidden.get(model.ref);
      return !until || until < now;
    });
    models.push(...list);
    status.push({
      id: provider.id,
      label: provider.label,
      ok: lists[index].ok,
      models: list.length,
    });
  });
  models.sort(
    (a, b) =>
      a.rank - b.rank ||
      a.name.localeCompare(b.name) ||
      a.ref.localeCompare(b.ref),
  );
  return { models, providers: status };
}

/**
 * The listed model for a reference. When the provider is configured but its
 * list could not be read, a well-formed reference is accepted as is: the
 * call itself then reports what the provider says.
 */
export async function resolveGatewayModel(
  ref: string,
  options?: { fetchImpl?: typeof fetch },
): Promise<GatewayModel | null> {
  const parsed = parseModelRef(ref);
  if (!parsed) return null;
  const { models, providers } = await listGatewayModels(options);
  const listed = models.find((model) => model.ref === ref);
  if (listed) return listed;
  const status = providers.find((provider) => provider.id === parsed.provider);
  const spec = providerById(parsed.provider);
  if (!status || status.ok || !spec) return null;
  return parseProviderModels(spec, [{ id: parsed.model }])[0] ?? null;
}

/**
 * Providers without credit for paid models: measured by the runtime sync
 * (OSIRUS_UNFUNDED_PROVIDERS, "none" when all are funded) or refused here
 * within the last hour. Their paid models are not offered; free ones stay.
 */
function noCredit(provider: ProviderId, now: number) {
  const until = unfunded.get(provider);
  if (until && until > now) return true;
  const measured =
    env.OSIRUS_UNFUNDED_PROVIDERS ?? process.env.OSIRUS_UNFUNDED_PROVIDERS;
  return Boolean(
    measured
      ?.split(",")
      .map((id) => id.trim())
      .includes(provider),
  );
}

/**
 * A call was refused for missing credit: a paid model takes its provider's
 * paid models off the lists for an hour, a free one is hidden by itself.
 */
export function noteNoCredit(ref: string, now = Date.now()) {
  const parsed = parseModelRef(ref);
  if (!parsed) return;
  const listed = cache
    .get(parsed.provider)
    ?.models.find((model) => model.ref === ref);
  if (listed?.free) hideModel(ref, now);
  else unfunded.set(parsed.provider, now + HIDE_MS);
}

/** Hide a model the provider said does not exist (404), for an hour. */
export function hideModel(ref: string, now = Date.now()) {
  hidden.set(ref, now + HIDE_MS);
}

/** The default model: OSIRUS_DEFAULT_CHAT_MODEL when listed, else the best listed. */
export function pickDefaultModel(
  models: readonly GatewayModel[],
  options: { freeOnly?: boolean; preferReasoning?: boolean } = {},
): GatewayModel | null {
  const pool = options.freeOnly ? models.filter((model) => model.free) : models;
  const configured = env.OSIRUS_DEFAULT_CHAT_MODEL;
  if (configured) {
    const match = pool.find((model) => model.ref === configured);
    if (match) return match;
  }
  if (options.preferReasoning) {
    const thinker = pool.find((model) => model.reasoning);
    if (thinker) return thinker;
  }
  return pool.find((model) => !model.reasoning) ?? pool[0] ?? null;
}

/** Test hook: forget cached lists and hidden models. */
export function resetGatewayModelCache() {
  cache.clear();
  inflight.clear();
  hidden.clear();
  health.clear();
  unfunded.clear();
}

/**
 * The id a browser sees for a model: an HMAC of its reference, so the page
 * never learns which service runs it. Stable across instances (same secret).
 */
export function publicModelId(ref: string) {
  const secret =
    env.OSIRUS_CONNECTOR_KEY ??
    env.NEON_AUTH_COOKIE_SECRET ??
    "osirus-public-model-id";
  return `m_${createHmac("sha256", secret).update(ref).digest("base64url").slice(0, 16)}`;
}

/**
 * A model chosen in the browser (public id) or by server code (reference).
 * Null when it is not listed or not well formed.
 */
export async function resolveModelSelection(
  value: string,
  options?: { fetchImpl?: typeof fetch },
): Promise<GatewayModel | null> {
  if (value.startsWith("m_")) {
    const { models } = await listGatewayModels(options);
    return models.find((model) => publicModelId(model.ref) === value) ?? null;
  }
  return resolveGatewayModel(value, options);
}

/** What pickers receive: a name and a class, never the service behind it. */
export type PublicModel = {
  id: string;
  name: string;
  tier: ModelTier;
  free: boolean;
  reasoning: boolean;
  contextLength: number | null;
};

/**
 * The free models the runtime sync verified with a chat probe
 * (OSIRUS_FREE_MODEL_PRIMARY/SECONDARY/TERTIARY), in that order, when they
 * are among the given models.
 */
export function verifiedFastModels(models: readonly GatewayModel[]) {
  const ids = [
    env.OSIRUS_FREE_MODEL_PRIMARY,
    env.OSIRUS_FREE_MODEL_SECONDARY,
    env.OSIRUS_FREE_MODEL_TERTIARY,
  ].filter((id): id is string => Boolean(id));
  return ids
    .map((id) =>
      models.find((model) => model.provider === "unorouter" && model.id === id),
    )
    .filter((model): model is GatewayModel => Boolean(model));
}

/**
 * The top-class models the runtime sync verified with a real question
 * (OSIRUS_VERIFIED_TOP_MODELS), in that order, when they are among the given
 * models.
 */
export function verifiedTopModels(models: readonly GatewayModel[]) {
  const refs = (
    env.OSIRUS_VERIFIED_TOP_MODELS ??
    process.env.OSIRUS_VERIFIED_TOP_MODELS ??
    ""
  )
    .split(",")
    .map((ref) => ref.trim())
    .filter(Boolean);
  return refs
    .map((ref) => models.find((model) => model.ref === ref))
    .filter((model): model is GatewayModel => Boolean(model));
}

/**
 * The measured models that lead a class: the probed top models for "top",
 * the probed fast free ones otherwise. One that failed or was slow recently
 * steps back into the ranked list; `reasoning` keeps only thinking models.
 */
export function verifiedLead(
  models: readonly GatewayModel[],
  tier: ModelTier,
  options: { reasoning?: boolean } = {},
) {
  const verified =
    tier === "top" ? verifiedTopModels(models) : verifiedFastModels(models);
  return verified.filter(
    (model) =>
      modelPenalty(model.ref) === 0 && (!options.reasoning || model.reasoning),
  );
}

/** One entry per model name (the best-ranked copy), as Code's picker lists them. */
export function uniqueByName<T extends { name: string }>(models: readonly T[]) {
  const seen = new Set<string>();
  return models.filter((model) => {
    const key = model.name.toLowerCase().replace(/[^a-z0-9.]+/g, "");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function publicModel(model: GatewayModel): PublicModel {
  return {
    id: publicModelId(model.ref),
    name: model.name,
    tier: tierOf(model),
    free: model.free,
    reasoning: model.reasoning,
    contextLength: model.contextLength,
  };
}
