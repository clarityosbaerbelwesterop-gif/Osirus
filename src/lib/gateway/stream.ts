import {
  classifyFailure,
  keyFailoverAllowed,
  ProviderError,
} from "@/lib/models/unorouter";
import { hideModel, noteNoCredit } from "./models";
import {
  authorizationFor,
  formatModelRef,
  parseModelRef,
  providerById,
  type ProviderSpec,
} from "./providers";

// One OpenAI-compatible streaming call through the gateway.
//
// - Key failover only for rejected credentials and provider-side failures;
//   a rate limit or exhausted credit is reported, never evaded with another
//   key (same rule as the UNOROUTER provider).
// - Reasoning arrives as its own events: from delta.reasoning(_content), or
//   from a leading <think>...</think> block in the text.
// - A model the provider does not serve (404) is hidden from the pickers.

export type ChatContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

export type GatewayMessage = {
  role: "system" | "user" | "assistant";
  content: string | ChatContentPart[];
};

export type GatewayUsage = {
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
};

export type GatewayEvent =
  | { type: "text"; text: string }
  | { type: "reasoning"; text: string }
  | { type: "usage"; usage: GatewayUsage };

export type StreamOptions = {
  ref: string;
  messages: GatewayMessage[];
  signal?: AbortSignal;
  maxTokens?: number;
  temperature?: number;
  topP?: number;
  fetchImpl?: typeof fetch;
  /** Waits for the first byte and between chunks. */
  firstByteTimeoutMs?: number;
  idleTimeoutMs?: number;
};

type Delta = {
  content?: string | null;
  reasoning?: string | null;
  reasoning_content?: string | null;
};

type Chunk = {
  choices?: Array<{
    delta?: Delta;
    message?: Delta;
    finish_reason?: string | null;
  }>;
  usage?: Record<string, unknown> | null;
  error?: { message?: string; code?: string | number } | null;
};

function num(value: unknown) {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

export function normalizeGatewayUsage(raw: unknown): GatewayUsage {
  if (!raw || typeof raw !== "object") return {};
  const usage = raw as Record<string, unknown>;
  return {
    inputTokens: num(usage.prompt_tokens) ?? num(usage.input_tokens),
    outputTokens: num(usage.completion_tokens) ?? num(usage.output_tokens),
    costUsd: num(usage.cost) ?? num(usage.total_cost),
  };
}

/**
 * Splits a leading <think>...</think> block out of streamed text. Only a
 * block at the very start counts, so an answer that talks about the tag
 * is left alone.
 */
export class ThinkSplitter {
  private pending = "";
  private state: "start" | "thinking" | "answer" = "start";

  push(text: string): GatewayEvent[] {
    this.pending += text;
    return this.drain(false);
  }

  flush(): GatewayEvent[] {
    return this.drain(true);
  }

  private drain(final: boolean): GatewayEvent[] {
    const out: GatewayEvent[] = [];
    for (;;) {
      if (this.state === "answer") {
        if (this.pending) out.push({ type: "text", text: this.pending });
        this.pending = "";
        return out;
      }
      if (this.state === "start") {
        const trimmed = this.pending.trimStart();
        if (trimmed.startsWith("<think>")) {
          this.pending = trimmed.slice("<think>".length);
          this.state = "thinking";
          continue;
        }
        if (
          !final &&
          trimmed.length < "<think>".length &&
          "<think>".startsWith(trimmed)
        ) {
          return out;
        }
        this.state = "answer";
        continue;
      }
      // thinking
      const end = this.pending.indexOf("</think>");
      if (end >= 0) {
        const thought = this.pending.slice(0, end);
        if (thought) out.push({ type: "reasoning", text: thought });
        this.pending = this.pending
          .slice(end + "</think>".length)
          .replace(/^\s+/, "");
        this.state = "answer";
        continue;
      }
      if (final) {
        if (this.pending) out.push({ type: "reasoning", text: this.pending });
        this.pending = "";
        return out;
      }
      // Keep a possible partial "</think>" for the next chunk.
      let keep = 0;
      for (let size = Math.min(7, this.pending.length); size > 0; size -= 1) {
        if ("</think>".startsWith(this.pending.slice(-size))) {
          keep = size;
          break;
        }
      }
      const emit = this.pending.slice(0, this.pending.length - keep);
      if (emit) out.push({ type: "reasoning", text: emit });
      this.pending = this.pending.slice(this.pending.length - keep);
      return out;
    }
  }
}

function parseFrame(frame: string): Chunk | "done" | null {
  const payload = frame
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim())
    .join("\n");
  if (!payload) return null;
  if (payload === "[DONE]") return "done";
  try {
    return JSON.parse(payload) as Chunk;
  } catch {
    throw new ProviderError("Malformed streaming response", "invalid_stream");
  }
}

function requestBody(
  model: string,
  provider: ProviderSpec,
  options: StreamOptions,
  minimal: boolean,
) {
  return JSON.stringify({
    model,
    messages: options.messages,
    stream: true,
    max_tokens: options.maxTokens,
    temperature: options.temperature,
    top_p: options.topP,
    ...(minimal
      ? {}
      : {
          stream_options: { include_usage: true },
          ...(provider.id === "openrouter" ? { usage: { include: true } } : {}),
        }),
  });
}

function timeoutError(phase: "first" | "idle") {
  return new ProviderError(
    phase === "first"
      ? "The model did not start answering in time"
      : "The model stopped sending its answer",
    "timeout",
    408,
    true,
  );
}

async function openStream(
  provider: ProviderSpec,
  model: string,
  options: StreamOptions,
  signal: AbortSignal,
) {
  const fetchImpl = options.fetchImpl ?? fetch;
  let lastError: ProviderError | undefined;
  for (let index = 0; index < provider.keys.length; index += 1) {
    const last = index === provider.keys.length - 1;
    let minimal = false;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      let response: Response;
      try {
        response = await fetchImpl(provider.chatUrl, {
          method: "POST",
          headers: {
            Authorization: authorizationFor(provider, provider.keys[index]),
            "Content-Type": "application/json",
            Accept: "text/event-stream",
            ...provider.headers,
          },
          body: requestBody(model, provider, options, minimal),
          signal,
          cache: "no-store",
        });
      } catch (error) {
        if (signal.aborted) throw error;
        lastError = new ProviderError(
          "The model provider could not be reached",
          "provider_unavailable",
          undefined,
          true,
        );
        break;
      }
      if (response.ok) return response;
      const failure = await classifyFailure(response);
      // Some OpenAI-compatible servers refuse the optional usage fields:
      // ask once more without them.
      if (
        !minimal &&
        response.status === 400 &&
        /stream_options|include_usage|usage|unrecognized|extra (inputs|fields)/i.test(
          failure.message,
        )
      ) {
        minimal = true;
        continue;
      }
      if (failure.code === "model_not_configured") {
        hideModel(formatModelRef({ provider: provider.id, model }));
      }
      if (failure.code === "insufficient_credit") {
        noteNoCredit(formatModelRef({ provider: provider.id, model }));
      }
      if (!keyFailoverAllowed(failure) || last) throw failure;
      lastError = failure;
      break;
    }
  }
  throw (
    lastError ??
    new ProviderError(
      "The model provider could not be reached",
      "provider_unavailable",
    )
  );
}

/** Streams one answer. Throws ProviderError (name "ProviderError") on refusal. */
export async function* streamGateway(
  options: StreamOptions,
): AsyncGenerator<GatewayEvent> {
  const ref = parseModelRef(options.ref);
  if (!ref) {
    throw new ProviderError(
      "Unknown model reference",
      "model_not_configured",
      400,
    );
  }
  const provider = providerById(ref.provider);
  if (!provider) {
    throw new ProviderError(
      `${ref.provider} has no API key in this deployment`,
      "provider_not_configured",
      503,
    );
  }

  const controller = new AbortController();
  const abort = () => controller.abort(options.signal?.reason);
  if (options.signal?.aborted) abort();
  options.signal?.addEventListener("abort", abort, { once: true });
  const watch: { timedOut: "first" | "idle" | null } = { timedOut: null };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const arm = (phase: "first" | "idle") => {
    clearTimeout(timer);
    timer = setTimeout(
      () => {
        watch.timedOut = phase;
        controller.abort(timeoutError(phase));
      },
      phase === "first"
        ? (options.firstByteTimeoutMs ?? 60_000)
        : (options.idleTimeoutMs ?? 90_000),
    );
  };

  arm("first");
  const splitter = new ThinkSplitter();
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    let response: Response;
    try {
      response = await openStream(
        provider,
        ref.model,
        options,
        controller.signal,
      );
    } catch (error) {
      if (watch.timedOut) throw timeoutError(watch.timedOut);
      throw error;
    }
    if (!response.body) {
      throw new ProviderError(
        "Streaming response body is missing",
        "invalid_stream",
      );
    }
    reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let finished = false;
    while (!finished) {
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try {
        chunk = await reader.read();
      } catch (error) {
        if (watch.timedOut) throw timeoutError(watch.timedOut);
        throw error;
      }
      if (chunk.done) break;
      arm("idle");
      buffer += decoder.decode(chunk.value, { stream: true });
      const frames = buffer.split(/\r?\n\r?\n/);
      buffer = frames.pop() ?? "";
      for (const frame of frames) {
        const parsed = parseFrame(frame);
        if (parsed === "done") {
          finished = true;
          break;
        }
        if (!parsed) continue;
        yield* handleChunk(parsed, splitter);
      }
    }
    if (buffer.trim()) {
      const parsed = parseFrame(buffer);
      if (parsed && parsed !== "done") yield* handleChunk(parsed, splitter);
    }
    for (const event of splitter.flush()) yield event;
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", abort);
    if (reader) {
      try {
        await reader.cancel();
      } catch {
        // already closed
      }
    }
  }
}

function* handleChunk(
  chunk: Chunk,
  splitter: ThinkSplitter,
): Generator<GatewayEvent> {
  if (chunk.error) {
    const message =
      chunk.error.message || "The provider reported an error mid-answer";
    const code = String(chunk.error.code ?? "");
    throw new ProviderError(
      message,
      code === "429" || /rate/i.test(message)
        ? "rate_limited"
        : /credit|balance|insufficient/i.test(message)
          ? "insufficient_credit"
          : "provider_error",
      Number(code) || undefined,
    );
  }
  const choice = chunk.choices?.[0];
  const delta = choice?.delta ?? choice?.message;
  const thought = delta?.reasoning_content ?? delta?.reasoning;
  if (thought) yield { type: "reasoning", text: thought };
  if (delta?.content) {
    for (const event of splitter.push(delta.content)) yield event;
  }
  if (chunk.usage)
    yield { type: "usage", usage: normalizeGatewayUsage(chunk.usage) };
}

/** The whole answer at once (built on the stream). */
export async function completeGateway(options: StreamOptions) {
  let text = "";
  let reasoning = "";
  let usage: GatewayUsage = {};
  for await (const event of streamGateway(options)) {
    if (event.type === "text") text += event.text;
    else if (event.type === "reasoning") reasoning += event.text;
    else usage = { ...usage, ...event.usage };
  }
  return { text, reasoning, usage };
}
