// THINKING is the structured task-analysis role. It is separate from STRONG
// because analysis is asked for as schema-validated JSON, not prose, and may
// be pointed at a different model without changing how answers are written.
export type ModelRole =
  "FAST" | "STRONG" | "THINKING" | "CODING" | "RESEARCH" | "MATH" | "VERIFY";

export type Usage = {
  inputTokens?: number;
  outputTokens?: number;
  cost?: number;
};

export type ModelStreamEvent =
  { type: "delta"; text: string } | { type: "usage"; usage: Usage };

export interface ModelProvider {
  stream(input: {
    requestId: string;
    role: ModelRole;
    messages: unknown[];
    signal?: AbortSignal;
  }): AsyncIterable<ModelStreamEvent>;
  complete(input: {
    requestId: string;
    role: ModelRole;
    messages: unknown[];
    signal?: AbortSignal;
  }): Promise<{ text: string; usage: Usage }>;
  structured<T>(input: {
    requestId: string;
    role: ModelRole;
    messages: unknown[];
    validate: (value: unknown) => T;
    signal?: AbortSignal;
  }): Promise<{ value: T; usage: Usage }>;
  /** The configured model identifier for a role. */
  modelId(role: ModelRole): string;
  capabilities(): Promise<Record<string, unknown>>;
  healthCheck(): Promise<boolean>;
  cancel(id: string): Promise<void>;
  normalizeUsage(raw: unknown): Usage;
  normalizeError(error: unknown): Error;
}

/**
 * A provider refusal that says nothing about the work: a rate limit, an
 * outage, no credit, a rejected or missing credential. Such an error must end
 * the step honestly -- never be retried as if the model had answered badly,
 * and never be counted against the strategy that happened to be running.
 * Recognised by shape so callers need not import a concrete provider.
 */
export type ProviderRefusal = {
  code: string;
  /** Worth trying again later (rate limit, outage), not a config problem. */
  transient: boolean;
  retryAfterMs: number | null;
};

const TRANSIENT_REFUSALS = new Set(["rate_limited", "provider_unavailable"]);
const PERMANENT_REFUSALS = new Set([
  "insufficient_credit",
  "credential_rejected",
  "provider_not_configured",
  "model_not_configured",
]);

export function providerRefusalOf(error: unknown): ProviderRefusal | null {
  if (!error || typeof error !== "object") return null;
  const { name, code, retryAfterMs } = error as {
    name?: unknown;
    code?: unknown;
    retryAfterMs?: unknown;
  };
  if (name !== "ProviderError" || typeof code !== "string") return null;
  if (!TRANSIENT_REFUSALS.has(code) && !PERMANENT_REFUSALS.has(code))
    return null;
  return {
    code,
    transient: TRANSIENT_REFUSALS.has(code),
    retryAfterMs:
      typeof retryAfterMs === "number" && retryAfterMs > 0
        ? retryAfterMs
        : null,
  };
}

/** How long a stage parks after a transient refusal: 1 min to 6 h. */
export function refusalDelaySeconds(refusal: ProviderRefusal) {
  const seconds = Math.ceil((refusal.retryAfterMs ?? 60_000) / 1000);
  return Math.min(6 * 60 * 60, Math.max(60, seconds));
}
