import { env, serverKeys } from "../env";
import type {
  ModelProvider,
  ModelRole,
  ModelStreamEvent,
  Usage,
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
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

const RETRYABLE_STATUS = new Set([408, 500, 502, 503, 504]);

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

export class UnoRouterProvider implements ModelProvider {
  private readonly controllers = new Map<string, AbortController>();

  private modelFor(role: ModelRole) {
    const models: Record<ModelRole, string | undefined> = {
      FAST: env.OSIRUS_MODEL_FAST,
      STRONG: env.OSIRUS_MODEL_STRONG,
      CODING: env.OSIRUS_MODEL_CODING,
      RESEARCH: env.OSIRUS_MODEL_RESEARCH,
      MATH: env.OSIRUS_MODEL_MATH,
      VERIFY: env.OSIRUS_MODEL_VERIFY,
    };
    const model = models[role];
    if (!model)
      throw new ProviderError(
        `Model role ${role} is not configured`,
        "model_not_configured",
      );
    return model;
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

  private async request(input: {
    requestId: string;
    role: ModelRole;
    messages: unknown[];
    stream: boolean;
    signal?: AbortSignal;
  }) {
    const keys = this.eligibleKeys();
    let lastError: Error | undefined;

    for (let index = 0; index < keys.length; index += 1) {
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
            model: this.modelFor(input.role),
            messages: input.messages,
            stream: input.stream,
            stream_options: input.stream ? { include_usage: true } : undefined,
          }),
          signal,
          cache: "no-store",
        });

        if (response.ok) {
          return { response, cleanup };
        }

        const status = response.status;
        const retryable = RETRYABLE_STATUS.has(status);
        const credentialFailure = status === 401 || status === 403;
        const rateLimited = status === 429;
        const body = (await response.text()).slice(0, 500);
        const error = new ProviderError(
          body || `Provider request failed with ${status}`,
          rateLimited
            ? "rate_limited"
            : credentialFailure
              ? "credential_rejected"
              : retryable
                ? "provider_unavailable"
                : "provider_error",
          status,
          retryable || credentialFailure,
        );
        cleanup();

        // Keys are a resilience failover, not a way to evade provider rate limits.
        if (rateLimited) throw error;
        if (!(retryable || credentialFailure) || index === keys.length - 1)
          throw error;

        lastError = error;
        await sleep(Math.min(250 * 2 ** index, 1500), input.signal);
      } catch (error) {
        cleanup();
        if (error instanceof ProviderError) {
          if (!error.retryable || index === keys.length - 1) throw error;
          lastError = error;
          continue;
        }
        if (input.signal?.aborted || signal.aborted) {
          throw this.normalizeError(
            input.signal?.reason ?? signal.reason ?? error,
          );
        }
        lastError = this.normalizeError(error);
        if (index === keys.length - 1) throw lastError;
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
    return Boolean(
      env.UNOROUTER_BASE_URL &&
      serverKeys().length > 0 &&
      env.OSIRUS_MODEL_STRONG,
    );
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
