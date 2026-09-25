import { env, serverKeys } from "../env";
import type { CapacityPriority } from "./capacity";
import { FailureReportBuilder, type FailureReport } from "./failure-report";
import { FREE_MODELS } from "./free";
import {
  estimateTokens,
  isFreeId,
  type FailureCategory,
} from "./free-registry";
import { modelRuntime, type ModelRuntime } from "./model-runtime";
import type {
  ModelProvider,
  ModelRole,
  ModelStreamEvent,
  Usage,
  Sampling,
} from "./provider";

type OpenAIChunk = {
  choices?: Array<{ delta?: { content?: string | null } }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    input_tokens?: number;
    output_tokens?: number;
    cost?: number;
    total_cost?: number;
  };
};

type OpenAICompletion = {
  choices?: Array<{ message?: { content?: string | null } }>;
  usage?: OpenAIChunk["usage"];
};

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status?: number,
    readonly retryable = false,
    /** For a rate limit: how long the provider asked the caller to wait. */
    readonly retryAfterMs?: number,
    /**
     * Every model attempt behind this failure (M49). The error itself is
     * always the failure that stopped completion.
     */
    readonly report?: FailureReport,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

/** The wait a 429 asks for: Retry-After, or "retry in Ns" in the body. */
export function rateLimitWaitMs(headers: Headers, body: string) {
  const header = Number(headers.get("retry-after"));
  if (Number.isFinite(header) && header > 0) return header * 1000;
  const match = body.match(/retry in (\d+(?:\.\d+)?)\s*s/i);
  return match ? Math.ceil(Number(match[1]) * 1000) : undefined;
}

/**
 * The longest this process waits out a rate limit before failing. Waiting on
 * the same key is honouring the limit, not evading it; the ceiling keeps a
 * web request from hanging, and the eval runner raises it.
 */
function maxRateLimitWaitMs() {
  const configured = Number(process.env.OSIRUS_RATE_LIMIT_MAX_WAIT_SECONDS);
  return (
    (Number.isFinite(configured) && configured >= 0 ? configured : 20) * 1000
  );
}

const RETRYABLE_STATUS = new Set([408, 500, 502, 503, 504]);

/**
 * Turn a non-OK provider response into a categorised ProviderError. The body
 * is kept (truncated) as the message for operators; it never contains the
 * request's credentials.
 */
export async function classifyFailure(response: Response) {
  const status = response.status;
  const retryable = RETRYABLE_STATUS.has(status) || status >= 500;
  const credentialFailure = status === 401 || status === 403;
  const rateLimited = status === 429;
  const body = (await response.text()).slice(0, 500);
  // A refused paid request (no balance, exhausted quota) is its own
  // category so it can be reported as such; it is never retried on another
  // key.
  const noCredit =
    !rateLimited &&
    (status === 402 ||
      /insufficient|balance|credit|quota exceeded|billing|payment required/i.test(
        body,
      ));
  // A model the provider does not serve is a configuration fact about that
  // model.
  const unknownModel =
    !rateLimited &&
    !noCredit &&
    (status === 404 ||
      /model[^\n]{0,40}not[^\n]{0,20}(found|exist)/i.test(body));
  return new ProviderError(
    body || `Provider request failed with ${status}`,
    rateLimited
      ? "rate_limited"
      : noCredit
        ? "insufficient_credit"
        : unknownModel
          ? "model_not_configured"
          : credentialFailure
            ? "credential_rejected"
            : retryable
              ? status === 408
                ? "timeout"
                : "provider_unavailable"
              : "provider_error",
    status,
    !noCredit && (retryable || credentialFailure),
    rateLimited ? rateLimitWaitMs(response.headers, body) : undefined,
  );
}

/**
 * The non-evasion rule, in one place: another key may be tried only for a
 * rejected credential or a provider-side failure. Never for a rate limit,
 * never for an exhausted quota or credit, never for a model the provider
 * does not serve.
 */
export function keyFailoverAllowed(error: ProviderError) {
  return (
    error.code === "credential_rejected" ||
    error.code === "provider_unavailable" ||
    error.code === "timeout"
  );
}

function sleep(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
      },
      { once: true },
    );
  });
}

export function parseSseFrame(frame: string): OpenAIChunk | null {
  const payload = frame
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim())
    .join("\n");
  if (!payload || payload === "[DONE]") return null;
  try {
    return JSON.parse(payload) as OpenAIChunk;
  } catch {
    throw new ProviderError("Malformed streaming response", "invalid_stream");
  }
}

export type UnoRouterOptions = {
  /**
   * One model for every role. The Foundry runs its trials on a single named
   * model (the free one, by operator decision); product runs leave this unset
   * and use the free-model-first policy.
   */
  model?: string;
  /**
   * M48: a model per role for a trial, from the free-model allowlist only
   * (see models/free.ts); a role without an entry uses `model`.
   */
  roleModels?: Partial<Record<ModelRole, string>>;
  /** Longest wait for a rate limit, overriding the environment default. */
  maxRateLimitWaitSeconds?: number;
  /**
   * M49 capacity priority. P0 interactive chat (default), P1 user background
   * work, P2 verification, P3 capability probes, P4 RSI / self-play /
   * Foundry. P3/P4 are deferred while free capacity is scarce.
   */
  priority?: CapacityPriority;
  /** Tests: the shared runtime (pool, key health, capacity) to use. */
  runtime?: ModelRuntime;
  /** Tests: skip /v1/models discovery and use the runtime's pool as is. */
  discover?: boolean;
};

/** Role values that mean "use the verified free-model pool". */
const POOL_SENTINELS = new Set(["", "free", "auto", "free-first"]);

type RequestInput = {
  requestId: string;
  role: ModelRole;
  messages: unknown[];
  stream: boolean;
  signal?: AbortSignal;
  sampling?: Sampling;
};

function categoryOf(code: string): FailureCategory {
  switch (code) {
    case "rate_limited":
    case "provider_unavailable":
    case "timeout":
    case "insufficient_credit":
    case "model_not_configured":
    case "credential_rejected":
      return code;
    case "invalid_stream":
    case "invalid_json":
      return "invalid_response";
    default:
      return "provider_error";
  }
}

function maxModelAttempts() {
  const configured = Number(process.env.OSIRUS_FREE_MODEL_MAX_ATTEMPTS);
  return Number.isFinite(configured) && configured >= 1
    ? Math.min(8, Math.floor(configured))
    : 4;
}

function poolSize() {
  const configured = Number(process.env.OSIRUS_FREE_MODEL_POOL_SIZE);
  return Number.isFinite(configured) && configured >= 1
    ? Math.min(16, Math.floor(configured))
    : undefined;
}

export class UnoRouterProvider implements ModelProvider {
  private readonly controllers = new Map<string, AbortController>();
  private readonly served = new Map<string, string>();

  constructor(private readonly options: UnoRouterOptions = {}) {}

  servedModel(requestId: string) {
    return this.served.get(requestId);
  }

  private noteServed(requestId: string, model: string) {
    this.served.set(requestId, model);
    // Bounded: a provider lives for one stage, but never grows unbounded.
    if (this.served.size > 256) {
      const oldest = this.served.keys().next().value;
      if (oldest !== undefined) this.served.delete(oldest);
    }
  }

  private runtime() {
    return this.options.runtime ?? modelRuntime();
  }

  private rateLimitCeilingMs() {
    return this.options.maxRateLimitWaitSeconds !== undefined
      ? this.options.maxRateLimitWaitSeconds * 1000
      : maxRateLimitWaitMs();
  }

  private configuredRoleModel(role: ModelRole) {
    const models: Record<ModelRole, string | undefined> = {
      FAST: env.OSIRUS_MODEL_FAST,
      STRONG: env.OSIRUS_MODEL_STRONG,
      THINKING: env.OSIRUS_MODEL_THINKING ?? env.OSIRUS_MODEL_STRONG,
      CODING: env.OSIRUS_MODEL_CODING,
      RESEARCH: env.OSIRUS_MODEL_RESEARCH,
      MATH: env.OSIRUS_MODEL_MATH,
      VERIFY: env.OSIRUS_MODEL_VERIFY,
    };
    const value = models[role]?.trim();
    return value && !POOL_SENTINELS.has(value.toLowerCase()) ? value : null;
  }

  /** A trial pin (Foundry / M48 role map), if this provider has one. */
  private pinnedModel(role: ModelRole) {
    return this.options.roleModels?.[role] ?? this.options.model ?? null;
  }

  /**
   * The model tried before the free pool, or null to go straight to the
   * pool. Under the default free-first policy a configured *paid* model
   * (e.g. a stale OSIRUS_MODEL_STRONG=grok-4.6) is ignored: basic operation
   * never depends on paid credit. It is honoured only with
   * OSIRUS_MODEL_POLICY=configured-first.
   */
  private primaryFor(role: ModelRole) {
    const pinned = this.pinnedModel(role);
    if (pinned) return pinned;
    const configured = this.configuredRoleModel(role);
    if (!configured) return null;
    if (isFreeId(configured)) return null; // a preference inside the pool
    return env.OSIRUS_MODEL_POLICY === "configured-first" ? configured : null;
  }

  /** Free models an operator prefers; only used if discovery lists them. */
  private preferredFree() {
    const roles: ModelRole[] = [
      "STRONG",
      "FAST",
      "THINKING",
      "CODING",
      "RESEARCH",
      "MATH",
      "VERIFY",
    ];
    const hints = [
      env.OSIRUS_FREE_MODEL_PRIMARY,
      env.OSIRUS_FREE_MODEL_SECONDARY,
      env.OSIRUS_FREE_MODEL_TERTIARY,
      ...roles.map((role) => this.configuredRoleModel(role) ?? undefined),
    ];
    return [
      ...new Set(
        hints.filter(
          (id): id is string => typeof id === "string" && isFreeId(id),
        ),
      ),
    ];
  }

  private modelFor(role: ModelRole) {
    const primary = this.primaryFor(role);
    if (primary) return primary;
    const configured = this.configuredRoleModel(role);
    const runtime = this.runtime();
    if (configured && isFreeId(configured) && runtime.pool.has(configured))
      return configured;
    const model =
      runtime.tiers().PRIMARY_FREE ?? this.preferredFree()[0] ?? FREE_MODELS[0];
    if (!model)
      throw new ProviderError(
        `Model role ${role} is not configured`,
        "model_not_configured",
      );
    return model;
  }

  /**
   * Whether a failure of the model tried first may be answered by the
   * verified free pool. A permanent refusal (no credit, unknown model) is a
   * property of that model; the free models consume no credit, so using
   * them is not evading a limit. A temporarily unavailable configured model
   * may also be answered by a free one -- except for a trial pin, whose
   * comparison must stay on its own model. A rate limit is waited out, not
   * sidestepped, and a rejected credential must surface: another model on
   * the same broken key cannot fix it.
   */
  private fallbackEligible(error: ProviderError, pinned: boolean) {
    if (
      error.code === "insufficient_credit" ||
      error.code === "model_not_configured"
    )
      return true;
    return (
      !pinned &&
      (error.code === "provider_unavailable" || error.code === "timeout")
    );
  }

  private reasoningEffort(model: string) {
    // Only Grok 4.6's OpenAI-compatible reasoning contract is verified. Do
    // not send a provider-specific reasoning field to another model family.
    return model === "grok-4.6"
      ? (env.OSIRUS_REASONING_EFFORT ?? "high")
      : undefined;
  }

  modelId(role: ModelRole) {
    return this.modelFor(role);
  }

  private endpoint() {
    if (!env.UNOROUTER_BASE_URL) {
      throw new ProviderError(
        "UNOROUTER_BASE_URL is not configured",
        "provider_not_configured",
      );
    }
    return env.UNOROUTER_BASE_URL;
  }

  private eligibleKeys() {
    const keys = serverKeys();
    if (!keys.length) {
      throw new ProviderError(
        "No UNOROUTER API key is configured",
        "provider_not_configured",
      );
    }
    return keys;
  }

  private combineSignal(
    requestId: string,
    signal?: AbortSignal,
    timeoutMs = 90_000,
  ) {
    const controller = new AbortController();
    this.controllers.set(requestId, controller);
    const timeout = setTimeout(
      () =>
        controller.abort(
          new ProviderError("Model request timed out", "timeout", 408, true),
        ),
      timeoutMs,
    );
    const abort = () => controller.abort(signal?.reason);
    signal?.addEventListener("abort", abort, { once: true });
    return {
      signal: controller.signal,
      cleanup: () => {
        clearTimeout(timeout);
        signal?.removeEventListener("abort", abort);
        if (this.controllers.get(requestId) === controller) {
          this.controllers.delete(requestId);
        }
      },
    };
  }

  /** The request that stopped completion, carrying every attempt's failure. */
  private finalize(error: ProviderError, report: FailureReportBuilder) {
    return new ProviderError(
      error.message,
      error.code,
      error.status,
      error.retryable,
      error.retryAfterMs,
      report.build(error.code),
    );
  }

  private async request(input: RequestInput) {
    const runtime = this.runtime();
    const priority = this.options.priority ?? "P0";
    const admission = runtime.capacity.admit(
      priority,
      runtime.capacitySignal(Date.now()),
    );
    if (!admission.admitted) {
      // Transient by design: the caller keeps its offline work and asks
      // again later; user requests keep the free capacity meanwhile.
      throw new ProviderError(
        `Model capacity deferred for ${priority}: ${admission.reason}`,
        "capacity_deferred",
        undefined,
        true,
        admission.retryAfterMs,
      );
    }
    const release = runtime.capacity.begin(priority);
    try {
      const { response, cleanup } = await this.route(input, runtime);
      return {
        response,
        cleanup: () => {
          cleanup();
          release();
        },
      };
    } catch (error) {
      release();
      throw error;
    }
  }

  private async ensurePool(runtime: ModelRuntime) {
    if (this.options.discover === false) return;
    if (runtime.pool.size > 0 && !runtime.needsDiscovery(Date.now())) return;
    let keys: string[];
    let endpoint: string;
    try {
      keys = this.eligibleKeys();
      endpoint = this.endpoint();
    } catch {
      return; // surfaced by the request itself
    }
    await runtime.discover({
      endpoint,
      keys,
      preferred: this.preferredFree(),
      seed: FREE_MODELS,
      maxPoolSize: poolSize(),
    });
  }

  private async route(input: RequestInput, runtime: ModelRuntime) {
    const report = new FailureReportBuilder();
    const pinned = Boolean(this.pinnedModel(input.role));
    const primary = this.primaryFor(input.role);
    let primaryError: ProviderError | undefined;
    if (primary) {
      report.attempting(primary);
      try {
        const result = await this.requestWithModel(input, primary);
        this.noteServed(input.requestId, primary);
        return result;
      } catch (error) {
        if (!(error instanceof ProviderError) || error.code === "cancelled")
          throw error;
        report.record(primary, error);
        if (!this.fallbackEligible(error, pinned))
          throw this.finalize(error, report);
        primaryError = error;
      }
    }

    await this.ensurePool(runtime);
    const lastError = await this.fromPool(input, runtime, report, primary);
    if ("response" in lastError) return lastError;
    const final = lastError.error ?? primaryError;
    if (final) throw this.finalize(final, report);
    throw this.finalize(
      new ProviderError(
        "No verified free model is available to the configured key",
        "model_not_configured",
      ),
      report,
    );
  }

  /**
   * Serve the request from the verified free pool.
   * - 429 on a free model: that *model* cools down for Retry-After (or an
   *   exponential backoff) and this request WAITS for it when the wait is
   *   within the ceiling. Only when the wait is longer may another verified
   *   free model that is ready take the request. Keys are never rotated.
   * - A temporarily unavailable free model (5xx, timeout) or one that
   *   refuses permanently: another verified free model is tried.
   * - A rejected credential ends the request: no model can fix a key.
   */
  private async fromPool(
    input: RequestInput,
    runtime: ModelRuntime,
    report: FailureReportBuilder,
    primary: string | null,
  ): Promise<
    | { response: Response; cleanup: () => void }
    | { error: ProviderError | undefined }
  > {
    const pool = runtime.pool;
    const tried = new Set<string>(primary ? [primary] : []);
    const ceiling = this.rateLimitCeilingMs();
    const minContextTokens = estimateTokens(input.messages);
    let lastError: ProviderError | undefined;
    let modelsAttempted = 0;
    let waits = 0;

    while (modelsAttempted < maxModelAttempts()) {
      const selection = pool.select({
        now: Date.now(),
        minContextTokens,
        exclude: tried,
      });
      if (selection.kind === "none") break;
      if (selection.kind === "wait") {
        if (selection.waitMs > ceiling || waits >= 6) {
          const retryAfterMs = Math.max(1, selection.waitMs);
          return {
            error: new ProviderError(
              lastError?.code === "rate_limited"
                ? lastError.message
                : "Every verified free model is cooling down after rate limits",
              "rate_limited",
              429,
              true,
              retryAfterMs,
            ),
          };
        }
        waits += 1;
        await sleep(selection.waitMs, input.signal);
        continue;
      }

      const model = selection.candidate.id;
      modelsAttempted += 1;
      for (let rateLimitWaits = 0; ; rateLimitWaits += 1) {
        report.attempting(model);
        pool.markUsed(model, Date.now());
        const started = Date.now();
        try {
          const result = await this.requestOnce({ ...input, model });
          const now = Date.now();
          pool.recordSuccess(model, now, now - started);
          runtime.noteSuccess(model, now, now - started);
          this.noteServed(input.requestId, model);
          return result;
        } catch (error) {
          if (!(error instanceof ProviderError) || error.code === "cancelled")
            throw error;
          const now = Date.now();
          const until = pool.recordFailure(
            model,
            categoryOf(error.code),
            now,
            error.retryAfterMs,
          );
          report.record(model, error);
          lastError = error;
          if (error.code === "credential_rejected") return { error };
          if (error.code === "rate_limited") {
            runtime.noteRateLimit(now);
            const wait = until ? until - now : undefined;
            if (wait !== undefined && wait <= ceiling && rateLimitWaits < 2) {
              await sleep(wait + 250, input.signal);
              continue; // same model, same key: honouring the limit
            }
          }
          tried.add(model);
          break;
        }
      }
    }
    return { error: lastError };
  }

  /** One model, with rate limits waited out on the same key, as asked. */
  private async requestWithModel(input: RequestInput, model: string) {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await this.requestOnce({ ...input, model });
      } catch (error) {
        const wait =
          error instanceof ProviderError && error.code === "rate_limited"
            ? error.retryAfterMs
            : undefined;
        if (error instanceof ProviderError && error.code === "rate_limited")
          this.runtime().noteRateLimit(Date.now());
        if (
          wait === undefined ||
          wait > this.rateLimitCeilingMs() ||
          attempt >= 3
        )
          throw error;
        await sleep(wait + 250, input.signal);
      }
    }
  }

  /**
   * One model, one request, with key failover limited to credential and
   * provider failures (M49 section 8, audited):
   * - 429: thrown at once on the same key. Never answered by another key.
   * - insufficient credit / quota: thrown at once. Keys 2/3 are not tried --
   *   the free tier is per user, and more keys are not more quota.
   * - 401/403: the next key is tried (revoked or rotated credential), and
   *   the rejected key is tried last for a while.
   * - 5xx / 408 / network: the next key is tried (provider-side failure).
   */
  private async requestOnce(input: RequestInput & { model: string }) {
    const keys = this.eligibleKeys();
    const runtime = this.runtime();
    const order = runtime.keyOrder(keys.length, Date.now());
    let lastError: Error | undefined;

    for (let position = 0; position < order.length; position += 1) {
      const index = order[position];
      const last = position === order.length - 1;
      const { signal, cleanup } = this.combineSignal(
        input.requestId,
        input.signal,
      );
      try {
        const response = await fetch(this.endpoint(), {
          method: "POST",
          headers: {
            Authorization: `Bearer ${keys[index]}`,
            "Content-Type": "application/json",
            Accept: input.stream ? "text/event-stream" : "application/json",
          },
          body: JSON.stringify({
            model: input.model,
            messages: input.messages,
            stream: input.stream,
            reasoning_effort: this.reasoningEffort(input.model),
            // M48: only when a strategy set them; otherwise the defaults.
            temperature: input.sampling?.temperature,
            top_p: input.sampling?.topP,
            stream_options: input.stream ? { include_usage: true } : undefined,
          }),
          signal,
          cache: "no-store",
        });

        if (response.ok) {
          runtime.markKeyAccepted(index);
          return { response, cleanup };
        }

        const error = await classifyFailure(response);
        cleanup();
        if (error.code === "credential_rejected")
          runtime.markKeyRejected(index, Date.now());

        // Keys are a resilience failover, not a way to evade provider limits.
        if (!keyFailoverAllowed(error) || last) throw error;

        lastError = error;
        await sleep(Math.min(250 * 2 ** position, 1500), input.signal);
      } catch (error) {
        cleanup();
        if (error instanceof ProviderError) {
          if (!keyFailoverAllowed(error) || last) throw error;
          lastError = error;
          continue;
        }
        if (input.signal?.aborted || signal.aborted) {
          throw this.normalizeError(
            input.signal?.reason ?? signal.reason ?? error,
          );
        }
        lastError = new ProviderError(
          "The model provider could not be reached",
          "provider_unavailable",
          undefined,
          true,
        );
        if (last) throw lastError;
      }
    }

    throw (
      lastError ??
      new ProviderError("Provider request failed", "provider_error")
    );
  }

  async *stream(input: {
    requestId: string;
    role: ModelRole;
    messages: unknown[];
    signal?: AbortSignal;
    sampling?: Sampling;
  }): AsyncIterable<ModelStreamEvent> {
    const { response, cleanup } = await this.request({
      ...input,
      stream: true,
    });
    if (!response.body) {
      cleanup();
      throw new ProviderError(
        "Streaming response body is missing",
        "invalid_stream",
      );
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const frames = buffer.split(/\r?\n\r?\n/);
        buffer = frames.pop() ?? "";

        for (const frame of frames) {
          const chunk = parseSseFrame(frame);
          if (!chunk) continue;
          const text = chunk.choices?.[0]?.delta?.content;
          if (text) yield { type: "delta", text };
          if (chunk.usage) {
            yield { type: "usage", usage: this.normalizeUsage(chunk.usage) };
          }
        }
      }

      if (buffer.trim()) {
        const chunk = parseSseFrame(buffer);
        const text = chunk?.choices?.[0]?.delta?.content;
        if (text) yield { type: "delta", text };
        if (chunk?.usage) {
          yield { type: "usage", usage: this.normalizeUsage(chunk.usage) };
        }
      }
    } finally {
      cleanup();
      reader.releaseLock();
    }
  }

  async complete(input: {
    requestId: string;
    role: ModelRole;
    messages: unknown[];
    signal?: AbortSignal;
    sampling?: Sampling;
  }) {
    const { response, cleanup } = await this.request({
      ...input,
      stream: false,
    });
    try {
      const body = (await response.json()) as OpenAICompletion;
      return {
        text: body.choices?.[0]?.message?.content ?? "",
        usage: this.normalizeUsage(body.usage),
      };
    } finally {
      cleanup();
    }
  }

  async structured<T>(input: {
    requestId: string;
    role: ModelRole;
    messages: unknown[];
    validate: (value: unknown) => T;
    signal?: AbortSignal;
    sampling?: Sampling;
  }) {
    const result = await this.complete(input);
    const start = result.text.indexOf("{");
    const end = result.text.lastIndexOf("}");
    if (start < 0 || end < start) {
      throw new ProviderError(
        "Structured model response did not contain JSON",
        "invalid_json",
      );
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(result.text.slice(start, end + 1));
    } catch {
      throw new ProviderError(
        "Structured model response was invalid JSON",
        "invalid_json",
      );
    }
    return { value: input.validate(parsed), usage: result.usage };
  }

  async capabilities() {
    return {
      streaming: true,
      cancellation: true,
      roles: ["FAST", "STRONG", "CODING", "RESEARCH", "MATH", "VERIFY"],
    };
  }

  async healthCheck() {
    // Free-model-first: a configured model role is not required.
    return Boolean(env.UNOROUTER_BASE_URL && serverKeys().length > 0);
  }

  async cancel(id: string) {
    this.controllers
      .get(id)
      ?.abort(new ProviderError("Model request cancelled", "cancelled"));
  }

  normalizeUsage(raw: unknown): Usage {
    if (!raw || typeof raw !== "object") return {};
    const usage = raw as Record<string, unknown>;
    const number = (value: unknown) =>
      typeof value === "number" && Number.isFinite(value) ? value : undefined;
    return {
      inputTokens: number(usage.prompt_tokens) ?? number(usage.input_tokens),
      outputTokens:
        number(usage.completion_tokens) ?? number(usage.output_tokens),
      cost: number(usage.cost) ?? number(usage.total_cost),
    };
  }

  normalizeError(error: unknown) {
    if (error instanceof Error) return error;
    return new ProviderError(String(error), "provider_error");
  }
}
