import { z } from "zod";
import { providerRefusalOf } from "../models/provider";
import type { FoundationAdapter } from "./foundation";
import {
  identityInstruction,
  reasoningFor,
  rougePolicySchema,
  versionOf,
  type RougePolicy,
} from "./policy";
import { NO_TELEMETRY, type RougeTelemetrySink } from "./telemetry";
import {
  RougeError,
  type RougeCoreServed,
  type RougeEffort,
  type RougeRequest,
  type RougeResponse,
  type RougeStreamEvent,
  type RougeUsage,
} from "./types";

// RougeRuntime (M56): one request in, one coherent answer out.
//
// M56 is the foundation only: identity, effort policy, the foundation call,
// honest core accounting and telemetry. The cognitive kernel (M57), the
// effort controller (M58), managed context (M59/M60), memory (M61) and the
// verifier (M63) plug in here as later milestones -- each measured against
// the raw core before it stays.

const MAX_MESSAGES = 200;
const MAX_MESSAGE_CHARS = 200_000;

const requestSchema = z.object({
  requestId: z.string().min(1).max(200),
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().max(MAX_MESSAGE_CHARS),
      }),
    )
    .min(1)
    .max(MAX_MESSAGES)
    .refine(
      (messages) =>
        messages.at(-1)?.role === "user" &&
        messages.at(-1)!.content.trim().length > 0,
      { message: "the conversation must end with a non-empty user message" },
    ),
  effort: z.enum(["auto", "quick", "standard", "deep", "ultra"]).optional(),
});

export type RougeRuntimeOptions = {
  foundation: FoundationAdapter;
  policy: RougePolicy;
  telemetry?: RougeTelemetrySink;
  /**
   * Override the policy's substitute rule. Evaluations pass false: a
   * comparison must stay on the core it names.
   */
  allowCoreSubstitute?: boolean;
  now?: () => number;
};

function errorCode(error: unknown, signal?: AbortSignal) {
  if (signal?.aborted) return "cancelled";
  const refusal = providerRefusalOf(error);
  if (refusal) return refusal.code;
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" ? code : "rouge_failed";
}

export class RougeRuntime {
  private readonly policy: RougePolicy;
  private readonly telemetry: RougeTelemetrySink;
  private readonly now: () => number;

  constructor(private readonly options: RougeRuntimeOptions) {
    this.policy = rougePolicySchema.parse(options.policy);
    if (this.policy.core !== options.foundation.core.id)
      throw new RougeError(
        `Policy is for ${this.policy.core}, foundation serves ${options.foundation.core.id}`,
        "core_mismatch",
      );
    this.telemetry = options.telemetry ?? NO_TELEMETRY;
    this.now = options.now ?? Date.now;
  }

  get version() {
    return versionOf(this.policy);
  }

  /** The effort a request runs at. M58 replaces the default with a controller. */
  effortFor(request: Pick<RougeRequest, "effort">): RougeEffort {
    return !request.effort || request.effort === "auto"
      ? this.policy.defaultEffort
      : request.effort;
  }

  async *stream(input: RougeRequest): AsyncIterable<RougeStreamEvent> {
    const parsed = requestSchema.safeParse(input);
    if (!parsed.success)
      throw new RougeError(
        parsed.error.issues[0]?.message ?? "invalid request",
        "invalid_request",
      );
    const request = { ...parsed.data, signal: input.signal };
    const foundation = this.options.foundation;
    const version = this.version;
    const effort = this.effortFor(request);
    const reasoning = reasoningFor(
      this.policy,
      effort,
      foundation.core.reasoningLevels,
    );
    const allowSubstitute =
      this.options.allowCoreSubstitute ?? this.policy.allowCoreSubstitute;

    const started = this.now();
    let firstTokenAt: number | null = null;
    let text = "";
    const usage: RougeUsage = { inputTokens: 0, outputTokens: 0, cost: null };
    const coreOf = (): RougeCoreServed => {
      const served =
        foundation.servedModel(request.requestId) ?? foundation.core.id;
      return {
        requested: foundation.core.id,
        served,
        substituted: served !== foundation.core.id,
      };
    };
    const record = (
      outcome: "completed" | "failed" | "cancelled",
      code: string | null,
      core: RougeCoreServed | null,
    ) =>
      Promise.resolve(
        this.telemetry.record({
          requestId: request.requestId,
          version,
          effort,
          reasoning: reasoning ?? null,
          coreRequested: foundation.core.id,
          coreServed: core?.served ?? null,
          substituted: core?.substituted ?? false,
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          cost: usage.cost,
          latencyMs: this.now() - started,
          firstTokenMs: firstTokenAt === null ? null : firstTokenAt - started,
          outcome,
          errorCode: code,
        }),
      ).catch(() => undefined);

    yield {
      type: "status",
      label:
        effort === "deep" || effort === "ultra"
          ? "Thinking deeply"
          : "Thinking",
    };

    try {
      for await (const event of foundation.stream({
        requestId: request.requestId,
        system: identityInstruction({
          version,
          foundation: foundation.core.id,
          now: new Date(started),
        }),
        messages: request.messages,
        reasoning,
        allowSubstitute,
        signal: request.signal,
      })) {
        if (event.type === "delta") {
          if (!event.text) continue;
          if (firstTokenAt === null) firstTokenAt = this.now();
          text += event.text;
          yield event;
        } else {
          usage.inputTokens += event.usage.inputTokens;
          usage.outputTokens += event.usage.outputTokens;
          if (event.usage.cost !== null)
            usage.cost = (usage.cost ?? 0) + event.usage.cost;
        }
      }
    } catch (error) {
      const code = errorCode(error, request.signal);
      const core = foundation.servedModel(request.requestId) ? coreOf() : null;
      await record(code === "cancelled" ? "cancelled" : "failed", code, core);
      if (error instanceof RougeError) throw error;
      throw new RougeError(
        error instanceof Error ? error.message : "Rouge could not answer",
        code,
        core,
      );
    }

    const core = coreOf();
    if (!text.trim()) {
      await record("failed", "empty_answer", core);
      throw new RougeError("The core returned no answer", "empty_answer", core);
    }
    await record("completed", null, core);
    const response: RougeResponse = {
      requestId: request.requestId,
      text,
      effort,
      version,
      core,
      usage,
      latencyMs: this.now() - started,
      firstTokenMs: firstTokenAt === null ? null : firstTokenAt - started,
    };
    yield { type: "done", response };
  }

  /** The whole answer at once. */
  async respond(request: RougeRequest): Promise<RougeResponse> {
    for await (const event of this.stream(request)) {
      if (event.type === "done") return event.response;
    }
    throw new RougeError("Rouge ended without an answer", "empty_answer");
  }
}
