import { ProviderError } from "@/lib/models/unorouter";
import type {
  ModelProvider,
  ModelRole,
  ModelStreamEvent,
  Sampling,
  Usage,
} from "@/lib/models/provider";
import { callCostUsd } from "./cost";
import {
  hideModel,
  listGatewayModels,
  modelPenalty,
  noteModelResult,
  resolveGatewayModel,
  verifiedBackup,
  type GatewayModel,
} from "./models";
import { parseModelRef } from "./providers";
import {
  candidatesFor,
  FALLBACK_CODES,
  PROVIDER_WIDE_CODES,
  tierOf,
} from "./routing";
import { structuredWithRepair } from "./structured";
import {
  completeGateway,
  streamGateway,
  type GatewayMessage,
  type GatewayUsage,
} from "./stream";

// The runtime's ModelProvider on top of the gateway: one gateway model for
// every role (or one per role), so Rouge Agent and Code can run on any
// model a configured key can call.

/** Usage with the cost the person is charged (same rule as the chat). */
function toUsage(usage: GatewayUsage, model: GatewayModel | null): Usage {
  return {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cost: model ? callCostUsd(model, usage) : usage.costUsd,
  };
}

function codeOf(error: unknown) {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" ? code : "provider_error";
}

/** The service behind a reference ("openrouter" for "openrouter:x/y"). */
function serviceOf(ref: string) {
  return parseModelRef(ref)?.provider ?? ref;
}

function asMessages(messages: unknown[]): GatewayMessage[] {
  return messages.filter(
    (message): message is GatewayMessage =>
      Boolean(message) &&
      typeof message === "object" &&
      typeof (message as GatewayMessage).role === "string",
  );
}

export class GatewayProvider implements ModelProvider {
  private readonly controllers = new Map<string, AbortController>();

  constructor(
    private readonly options: {
      /** Gateway reference used for every role without its own entry. */
      ref: string;
      roleRefs?: Partial<Record<ModelRole, string>>;
      /** Tried in order when the model fails before producing output. */
      fallbackRefs?: string[];
      /** Without fallbackRefs: fall back to listed models of the same class. */
      autoFallback?: boolean;
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

  private readonly models = new Map<string, Promise<GatewayModel | null>>();

  /** The listed model behind a reference (prices), once per reference. */
  private model(ref: string) {
    let found = this.models.get(ref);
    if (!found) {
      found = resolveGatewayModel(ref, {
        fetchImpl: this.options.fetchImpl,
      }).catch(() => null);
      this.models.set(ref, found);
    }
    return found;
  }

  private fallbacks: Promise<string[]> | null = null;

  /**
   * The model for a role, then the fallbacks: the given ones, else (with
   * autoFallback) listed models that cost the same kind of money (a free pin
   * only falls back to free models): the ones the runtime sync measured
   * answering first, then the pin's class, two per service at most.
   */
  private async refsFor(role: ModelRole) {
    const primary = this.modelId(role);
    if (!this.options.fallbackRefs && this.options.autoFallback) {
      this.fallbacks ??= (async () => {
        const pinned = await this.model(this.options.ref);
        if (!pinned) return [];
        const { models } = await listGatewayModels({
          fetchImpl: this.options.fetchImpl,
        });
        const pool = models.filter(
          (model) => model.free === pinned.free && model.ref !== pinned.ref,
        );
        return candidatesFor(pool, tierOf(pinned), {
          limit: 3,
          perProvider: 2,
          penalty: (ref) => modelPenalty(ref),
          lead: verifiedBackup(pool),
        }).map((model) => model.ref);
      })().catch(() => []);
    }
    const extra = this.options.fallbackRefs ?? (await this.fallbacks) ?? [];
    return [primary, ...extra.filter((ref) => ref !== primary)];
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
      const refs = await this.refsFor(input.role);
      const skipped = new Set<string>();
      for (const [index, ref] of refs.entries()) {
        if (skipped.has(serviceOf(ref))) continue;
        let produced = false;
        try {
          for await (const event of streamGateway({
            ref,
            messages: asMessages(input.messages),
            signal,
            temperature: input.sampling?.temperature,
            topP: input.sampling?.topP,
            fetchImpl: this.options.fetchImpl,
          })) {
            // The runtime's stream carries answer text only; reasoning stays out.
            if (event.type === "text") {
              produced = true;
              yield { type: "delta", text: event.text };
            } else if (event.type === "usage")
              yield {
                type: "usage",
                usage: toUsage(event.usage, await this.model(ref)),
              };
          }
          return;
        } catch (error) {
          const code = codeOf(error);
          if (!signal.aborted)
            noteModelResult(ref, { ok: false, firstTokenMs: 0 });
          if (code === "model_not_configured") hideModel(ref);
          if (PROVIDER_WIDE_CODES.has(code)) skipped.add(serviceOf(ref));
          const last = !refs
            .slice(index + 1)
            .some((next) => !skipped.has(serviceOf(next)));
          if (produced || last || signal.aborted || !FALLBACK_CODES.has(code))
            throw error;
        }
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
    /** Only these models, in this order (structured output's retries). */
    refs?: string[];
  }) {
    const { signal, done } = this.signalFor(input.requestId, input.signal);
    try {
      const refs = input.refs ?? (await this.refsFor(input.role));
      const skipped = new Set<string>();
      for (const [index, ref] of refs.entries()) {
        if (skipped.has(serviceOf(ref))) continue;
        try {
          const result = await completeGateway({
            ref,
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
          return {
            text: result.text,
            usage: toUsage(result.usage, await this.model(ref)),
            /** The model that answered. */
            ref,
          };
        } catch (error) {
          const code = codeOf(error);
          if (!signal.aborted)
            noteModelResult(ref, { ok: false, firstTokenMs: 0 });
          if (code === "model_not_configured") hideModel(ref);
          if (PROVIDER_WIDE_CODES.has(code)) skipped.add(serviceOf(ref));
          const last = !refs
            .slice(index + 1)
            .some((next) => !skipped.has(serviceOf(next)));
          if (last || signal.aborted || !FALLBACK_CODES.has(code)) throw error;
        }
      }
      throw new ProviderError("No model answered", "provider_error");
    } finally {
      done();
    }
  }

  /**
   * Structured output (see ./structured): every object in the reply is
   * tried; a bad reply gets one repair turn on the same model, then one fresh
   * attempt on the next candidate model.
   */
  async structured<T>(input: {
    requestId: string;
    role: ModelRole;
    messages: unknown[];
    validate: (value: unknown) => T;
    signal?: AbortSignal;
    sampling?: Sampling;
  }) {
    const refs = await this.refsFor(input.role);
    let answered: string | undefined;
    return structuredWithRepair({
      requestId: input.requestId,
      messages: input.messages,
      validate: input.validate,
      signal: input.signal,
      onUnusable: () => {
        if (answered) noteModelResult(answered, { ok: false, firstTokenMs: 0 });
      },
      call: async (messages, requestId, attempt) => {
        const pool =
          attempt === 0
            ? refs
            : attempt === 1
              ? answered
                ? [answered]
                : refs
              : refs.slice(answered ? refs.indexOf(answered) + 1 : 1);
        if (!pool.length) return null;
        const result = await this.complete({
          ...input,
          messages,
          requestId,
          refs: pool,
        });
        if (attempt === 0) answered = result.ref;
        return result;
      },
    });
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
