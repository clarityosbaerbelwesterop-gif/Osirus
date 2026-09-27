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
import { checkContract, describeContract } from "./kernel/contract";
import { understand, type AnswerContract } from "./kernel/understand";
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
    const kernel = this.policy.kernel;
    const kernelOn = kernel.contracts || kernel.quickSmallTalk;
    // M57: understand the request before spending a call on it.
    const understanding = kernelOn
      ? understand(request.messages.at(-1)!.content)
      : null;
    const autoEffort = !request.effort || request.effort === "auto";
    const effort: RougeEffort =
      kernel.quickSmallTalk && understanding?.smallTalk && autoEffort
        ? "quick"
        : this.effortFor(request);
    const reasoning = reasoningFor(
      this.policy,
      effort,
      foundation.core.reasoningLevels,
    );
    const contract: AnswerContract =
      kernel.contracts && understanding
        ? understanding.contract
        : { kind: "free" };
    const contractText = describeContract(contract);
    // A reply with a fixed shape is checked before anyone sees it.
    const buffered = contract.kind !== "free";
    let contractMet: boolean | null = buffered ? false : null;
    let repairs = 0;
    let answeredBy = request.requestId;
    const allowSubstitute =
      this.options.allowCoreSubstitute ?? this.policy.allowCoreSubstitute;

    const started = this.now();
    let firstTokenAt: number | null = null;
    let text = "";
    const usage: RougeUsage = { inputTokens: 0, outputTokens: 0, cost: null };
    const coreOf = (): RougeCoreServed => {
      const served =
        foundation.servedModel(answeredBy) ??
        foundation.servedModel(request.requestId) ??
        foundation.core.id;
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
          ...(kernelOn
            ? { contract: contract.kind, contractMet, repairs }
            : {}),
        }),
      ).catch(() => undefined);

    yield {
      type: "status",
      label:
        effort === "deep" || effort === "ultra"
          ? "Thinking deeply"
          : buffered
            ? "Working it out"
            : "Thinking",
    };

    const system = [
      identityInstruction({
        version,
        foundation: foundation.core.id,
        now: new Date(started),
      }),
      ...(contractText
        ? [`Required reply format for this message: ${contractText}`]
        : []),
    ].join("\n");
    const addUsage = (event: { usage: RougeUsage }) => {
      usage.inputTokens += event.usage.inputTokens;
      usage.outputTokens += event.usage.outputTokens;
      if (event.usage.cost !== null)
        usage.cost = (usage.cost ?? 0) + event.usage.cost;
    };

    try {
      for await (const event of foundation.stream({
        requestId: request.requestId,
        system,
        messages: request.messages,
        reasoning,
        allowSubstitute,
        signal: request.signal,
      })) {
        if (event.type === "delta") {
          if (!event.text) continue;
          if (firstTokenAt === null) firstTokenAt = this.now();
          text += event.text;
          if (!buffered) yield event;
        } else {
          addUsage(event);
        }
      }

      if (buffered) {
        let verdict = checkContract(contract, text);
        while (!verdict.ok && repairs < kernel.repairRounds) {
          // Self-correction: one short round with the reason stated. The
          // draft stays the answer unless the repair meets the contract.
          repairs += 1;
          yield { type: "status", label: "Refining" };
          const repairId = `${request.requestId}:repair-${repairs}`;
          let repaired = "";
          try {
            for await (const event of foundation.stream({
              requestId: repairId,
              system,
              messages: [
                ...request.messages,
                { role: "assistant", content: text },
                {
                  role: "user",
                  content: `Your reply did not follow the required format: ${verdict.reason}. ${contractText} Reply again with only that.`,
                },
              ],
              reasoning: reasoningFor(
                this.policy,
                "quick",
                foundation.core.reasoningLevels,
              ),
              allowSubstitute,
              signal: request.signal,
            })) {
              if (event.type === "delta") repaired += event.text;
              else addUsage(event);
            }
          } catch (error) {
            if (request.signal?.aborted) throw error;
            break; // keep the draft
          }
          const next = checkContract(contract, repaired);
          if (next.ok) {
            text = repaired;
            answeredBy = repairId;
          }
          verdict = next;
        }
        contractMet = verdict.ok;
        if (text.trim()) yield { type: "delta", text };
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
      ...(kernelOn
        ? { kernel: { contract: contract.kind, contractMet, repairs } }
        : {}),
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
