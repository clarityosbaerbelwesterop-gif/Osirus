import { ProviderError } from "@/lib/models/unorouter";
import type {
  ModelProvider,
  ModelRole,
  ModelStreamEvent,
  Sampling,
  Usage,
} from "@/lib/models/provider";
import { extractJsonObject } from "./json";
import { parseModelRef } from "./providers";
import {
  completeGateway,
  streamGateway,
  type GatewayMessage,
  type GatewayUsage,
} from "./stream";

// The runtime's ModelProvider on top of the gateway: one gateway model for
// every role (or one per role), so Rouge Agent and Code can run on any
// model a configured key can call.

function toUsage(usage: GatewayUsage): Usage {
  return {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cost: usage.costUsd,
  };
}

function asMessages(messages: unknown[]): GatewayMessage[] {
  return messages.filter(
    (message): message is GatewayMessage =>
      Boolean(message) &&
      typeof message === "object" &&
      typeof (message as GatewayMessage).role === "string",
  );
}

const JSON_REPAIR =
  "Your previous reply could not be read as JSON. Reply again with exactly one JSON object and nothing else: no prose, no code fence.";

export class GatewayProvider implements ModelProvider {
  private readonly controllers = new Map<string, AbortController>();

  constructor(
    private readonly options: {
      /** Gateway reference used for every role without its own entry. */
      ref: string;
      roleRefs?: Partial<Record<ModelRole, string>>;
      fetchImpl?: typeof fetch;
    },
  ) {
    if (!parseModelRef(options.ref)) {
      throw new ProviderError(
        "Unknown model reference",
        "model_not_configured",
        400,
      );
    }
  }

  modelId(role: ModelRole) {
    return this.options.roleRefs?.[role] ?? this.options.ref;
  }

  servedModel() {
    return undefined;
  }

  private signalFor(requestId: string, outer?: AbortSignal) {
    const controller = new AbortController();
    this.controllers.set(requestId, controller);
    const forward = () => controller.abort(outer?.reason);
    if (outer?.aborted) forward();
    outer?.addEventListener("abort", forward, { once: true });
    return {
      signal: controller.signal,
      done: () => {
        outer?.removeEventListener("abort", forward);
        this.controllers.delete(requestId);
      },
    };
  }

  async *stream(input: {
    requestId: string;
    role: ModelRole;
    messages: unknown[];
    signal?: AbortSignal;
    sampling?: Sampling;
  }): AsyncIterable<ModelStreamEvent> {
    const { signal, done } = this.signalFor(input.requestId, input.signal);
    try {
      for await (const event of streamGateway({
        ref: this.modelId(input.role),
        messages: asMessages(input.messages),
        signal,
        temperature: input.sampling?.temperature,
        topP: input.sampling?.topP,
        fetchImpl: this.options.fetchImpl,
      })) {
        // The runtime's stream carries answer text only; reasoning stays out.
        if (event.type === "text") yield { type: "delta", text: event.text };
        else if (event.type === "usage")
          yield { type: "usage", usage: toUsage(event.usage) };
      }
    } finally {
      done();
    }
  }

  async complete(input: {
    requestId: string;
    role: ModelRole;
    messages: unknown[];
    signal?: AbortSignal;
    sampling?: Sampling;
  }) {
    const { signal, done } = this.signalFor(input.requestId, input.signal);
    try {
      const result = await completeGateway({
        ref: this.modelId(input.role),
        messages: asMessages(input.messages),
        signal,
        temperature: input.sampling?.temperature,
        topP: input.sampling?.topP,
        fetchImpl: this.options.fetchImpl,
      });
      if (!result.text.trim()) {
        throw new ProviderError(
          "The model returned an empty answer",
          "empty_response",
          502,
          true,
        );
      }
      return { text: result.text, usage: toUsage(result.usage) };
    } finally {
      done();
    }
  }

  /**
   * Structured output: the JSON object anywhere in the reply; when there is
   * none, one repair turn asks for the object alone.
   */
  async structured<T>(input: {
    requestId: string;
    role: ModelRole;
    messages: unknown[];
    validate: (value: unknown) => T;
    signal?: AbortSignal;
    sampling?: Sampling;
  }) {
    const first = await this.complete(input);
    const parsed = extractJsonObject(first.text);
    if (parsed !== undefined) {
      return { value: input.validate(parsed), usage: first.usage };
    }
    const repaired = await this.complete({
      ...input,
      requestId: `${input.requestId}:repair`,
      messages: [
        ...input.messages,
        { role: "assistant", content: first.text.slice(0, 4000) },
        { role: "user", content: JSON_REPAIR },
      ],
    });
    const second = extractJsonObject(repaired.text);
    if (second === undefined) {
      throw new ProviderError(
        "Structured model response did not contain JSON",
        "invalid_json",
      );
    }
    return {
      value: input.validate(second),
      usage: {
        inputTokens:
          (first.usage.inputTokens ?? 0) + (repaired.usage.inputTokens ?? 0),
        outputTokens:
          (first.usage.outputTokens ?? 0) + (repaired.usage.outputTokens ?? 0),
        cost:
          first.usage.cost === undefined && repaired.usage.cost === undefined
            ? undefined
            : (first.usage.cost ?? 0) + (repaired.usage.cost ?? 0),
      },
    };
  }

  async capabilities() {
    return {
      streaming: true,
      cancellation: true,
      gateway: true,
      model: this.options.ref,
    };
  }

  async healthCheck() {
    return true;
  }

  async cancel(id: string) {
    this.controllers
      .get(id)
      ?.abort(new DOMException("Cancelled", "AbortError"));
  }

  normalizeUsage(raw: unknown): Usage {
    if (!raw || typeof raw !== "object") return {};
    const usage = raw as Record<string, unknown>;
    const n = (value: unknown) =>
      typeof value === "number" && Number.isFinite(value) ? value : undefined;
    return {
      inputTokens: n(usage.prompt_tokens) ?? n(usage.inputTokens),
      outputTokens: n(usage.completion_tokens) ?? n(usage.outputTokens),
      cost: n(usage.cost) ?? n(usage.costUsd),
    };
  }

  normalizeError(error: unknown): Error {
    if (error instanceof Error) return error;
    return new ProviderError(String(error), "provider_error");
  }
}
