import { env } from "@/lib/env";

// The model gateway: every OpenAI-compatible provider whose key is set.
// A provider without a key is not offered anywhere -- no placeholders.
//
// A model is addressed as "<provider>:<model id>", e.g.
// "openrouter:anthropic/claude-sonnet-4.5" or "nvidia:meta/llama-3.3-70b-instruct".
// Provider ids contain no colon, so the first colon splits the reference
// (model ids such as "...:free" keep theirs).

export const PROVIDER_IDS = [
  "openrouter",
  "nvidia",
  "unorouter",
  "lightning",
  "bytez",
] as const;

export type ProviderId = (typeof PROVIDER_IDS)[number];

export type ProviderSpec = {
  id: ProviderId;
  label: string;
  /** Full chat completions URL. */
  chatUrl: string;
  /** GET model list URL, or null when the provider has no usable list. */
  modelsUrl: string | null;
  keys: string[];
  /** Extra request headers (attribution). */
  headers?: Record<string, string>;
  /** Every model of this provider costs the operator nothing per call. */
  freeByDefault?: boolean;
  /** "raw": the key alone in Authorization (Bytez); else "Bearer <key>". */
  authScheme?: "bearer" | "raw";
};

/** The Authorization header value for one key of a provider. */
export function authorizationFor(
  provider: Pick<ProviderSpec, "authScheme">,
  key: string,
) {
  return provider.authScheme === "raw" ? key : `Bearer ${key}`;
}

const DEFAULTS: Record<ProviderId, string> = {
  openrouter: "https://openrouter.ai/api/v1/chat/completions",
  nvidia: "https://integrate.api.nvidia.com/v1/chat/completions",
  unorouter: "https://api.unorouter.com/v1/chat/completions",
  lightning: "https://lightning.ai/api/v1/chat/completions",
  bytez: "https://api.bytez.com/models/v2/openai/v1/chat/completions",
};

const LABELS: Record<ProviderId, string> = {
  openrouter: "OpenRouter",
  nvidia: "NVIDIA",
  unorouter: "UnoRouter",
  lightning: "Lightning AI",
  bytez: "Bytez",
};

/** "https://host/v1" or ".../v1/chat/completions" -> the chat completions URL. */
export function chatCompletionsUrl(base: string): string | null {
  let url: URL;
  try {
    url = new URL(base);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const path = url.pathname.replace(/\/+$/, "");
  if (!path.endsWith("/chat/completions")) {
    url.pathname = `${path}/chat/completions`;
  } else {
    url.pathname = path;
  }
  url.search = "";
  url.hash = "";
  return url.toString();
}

/** The sibling GET /models URL of a chat completions URL. */
export function modelsUrlFor(chatUrl: string): string | null {
  let url: URL;
  try {
    url = new URL(chatUrl);
  } catch {
    return null;
  }
  const path = url.pathname.replace(/\/+$/, "");
  if (!path.endsWith("/chat/completions")) return null;
  url.pathname = `${path.slice(0, -"/chat/completions".length)}/models`;
  return url.toString();
}

function unique(values: Array<string | undefined>) {
  return values.filter(
    (value, index, all): value is string =>
      typeof value === "string" &&
      value.trim().length > 0 &&
      all.indexOf(value) === index,
  );
}

function siteUrl() {
  return (
    process.env.NEXT_PUBLIC_SITE_URL ||
    env.OSIRUS_PUBLIC_URL ||
    "https://osirus-ai.vercel.app"
  );
}

function spec(
  id: ProviderId,
  base: string | undefined,
  keys: string[],
  extra: Partial<ProviderSpec> = {},
): ProviderSpec | null {
  if (keys.length === 0) return null;
  const chatUrl = chatCompletionsUrl(base ?? DEFAULTS[id]);
  if (!chatUrl) return null;
  return {
    id,
    label: LABELS[id],
    chatUrl,
    modelsUrl: modelsUrlFor(chatUrl),
    keys,
    ...extra,
  };
}

/** Every provider with at least one key, in display order. */
export function configuredProviders(): ProviderSpec[] {
  const all = [
    spec(
      "openrouter",
      env.OPENROUTER_BASE_URL ?? process.env.OPENROUTER_BASE_URL,
      unique([env.OPENROUTER_API_KEY, process.env.OPENROUTER_API_KEY]),
      { headers: { "HTTP-Referer": siteUrl(), "X-Title": "Osirus" } },
    ),
    spec(
      "nvidia",
      env.NVIDIA_BASE_URL ?? process.env.NVIDIA_BASE_URL,
      unique([
        env.NVIDIA_API_KEY,
        env.NVIDIA_API_KEY_1,
        env.NVIDIA_API_KEY_2,
        env.NVIDIA_API_KEY_3,
        process.env.NVIDIA_API_KEY,
        process.env.NVIDIA_API_KEY_1,
      ]),
      // NVIDIA's API catalog bills trial credits, not money per call.
      { freeByDefault: true },
    ),
    spec(
      "unorouter",
      env.UNOROUTER_BASE_URL ?? process.env.UNOROUTER_BASE_URL,
      unique([
        env.UNOROUTER_API_KEY_1,
        env.UNOROUTER_API_KEY_2,
        env.UNOROUTER_API_KEY_3,
        env.UNOROUTER_API_KEY,
        process.env.UNOROUTER_API_KEY_1,
        process.env.UNOROUTER_API_KEY,
      ]),
    ),
    spec(
      "lightning",
      env.LIGHTNING_BASE_URL ?? process.env.LIGHTNING_BASE_URL,
      unique([env.LIGHTNING_AI_API_KEY, process.env.LIGHTNING_AI_API_KEY]),
    ),
    spec(
      "bytez",
      env.BYTEZ_BASE_URL ?? process.env.BYTEZ_BASE_URL,
      unique([env.BYTEZ_API_KEY, process.env.BYTEZ_API_KEY]),
      // Bytez takes the key itself, without "Bearer".
      { authScheme: "raw" },
    ),
  ];
  return all.filter((provider): provider is ProviderSpec => provider !== null);
}

export function providerById(id: string): ProviderSpec | null {
  return configuredProviders().find((provider) => provider.id === id) ?? null;
}

export function isProviderId(value: string): value is ProviderId {
  return (PROVIDER_IDS as readonly string[]).includes(value);
}

export function providerLabel(id: ProviderId) {
  return LABELS[id];
}

export type ModelRef = { provider: ProviderId; model: string };

/** "nvidia:meta/llama-3.3-70b-instruct" -> { provider, model }; else null. */
export function parseModelRef(ref: string | null | undefined): ModelRef | null {
  if (typeof ref !== "string") return null;
  const trimmed = ref.trim();
  const colon = trimmed.indexOf(":");
  if (colon <= 0) return null;
  const provider = trimmed.slice(0, colon);
  const model = trimmed.slice(colon + 1).trim();
  if (!isProviderId(provider) || !model || model.length > 200) return null;
  return { provider, model };
}

export function formatModelRef(ref: ModelRef) {
  return `${ref.provider}:${ref.model}`;
}

/** True for a gateway reference, false for a bare UNOROUTER catalog id. */
export function isGatewayRef(value: string | null | undefined) {
  return parseModelRef(value) !== null;
}
