import { budgetFromEnv, LabCostBudget } from "../inference/budget";
import { labKeyPool } from "../inference/key-pool";
import { APIModelProvider } from "../inference/providers";
import { routingDecision, type NativeAvailability } from "../inference/types";
import { applyBehaviorGate, constrainProgram } from "./contract";
import type { NativeQuote } from "./pricing";
import { PriceError, quoteNative, reserveNativeQuote } from "./pricing";
import { runReasoningPolicy } from "./reasoning";
import type { Activity, ModelProgram } from "./types";

export interface FixtureCheck {
  readonly armId: string;
  readonly passed: boolean;
}

export interface ProgramAnswer {
  readonly text: string;
  readonly userLabel: string;
  readonly provenance: string;
  readonly provider: "native" | "unorouter";
  readonly modelId: string;
  readonly checkpoint: string | null;
  readonly routingReason: string;
  readonly activity: Activity;
  readonly version: string;
  readonly latencyMs: number;
  readonly costUsd: number;
  readonly costPolicy: "provider_fallback" | "native_card";
  readonly costQuote: NativeQuote;
  readonly budgetNote: string;
  readonly phases: readonly Activity[];
  readonly armIds: readonly string[];
  readonly armSteps: readonly string[];
  readonly fixtureChecks: readonly FixtureCheck[];
  /**
   * Always false. Fallback follows the selected program's path. This process
   * does not measure equality with a native benchmark.
   */
  readonly measuredEqual: false;
  readonly outsideProgram: boolean;
  readonly trained: false;
}

export function userLabel(
  program: ModelProgram,
  provider: "native" | "unorouter",
): string {
  return provider === "native"
    ? program.ui.selectorLabel
    : program.ui.fallbackLabel;
}

export function provenanceLine(input: {
  program: ModelProgram;
  provider: "native" | "unorouter";
  modelId: string;
  checkpoint: string | null;
}): string {
  const name = input.program.displayName.replace(" ", "-");
  if (input.provider === "native") {
    return `${name} / native / checkpoint ${input.checkpoint ?? "missing"}`;
  }
  return `${name} / api_fallback / UnoRouter / ${input.modelId}`;
}

function stepBlock(steps: readonly string[]): string {
  if (!steps.length) return "";
  return `Program steps:\n${steps.map((step) => `- ${step}`).join("\n")}`;
}

export function activityFor(program: ModelProgram, phase: Activity): Activity {
  if (phase === "idle") return "idle";
  return program.ui.activities.includes(phase) ? phase : "idle";
}

export function fallbackModelId(
  program: ModelProgram,
  env: NodeJS.ProcessEnv,
): string {
  const value = env[program.fallback.envVar];
  if (typeof value === "string" && value.trim()) return value.trim();
  return program.fallback.defaultModelId;
}

/**
 * Untrained or unmeasured programs never take the native route.
 * Offline / missing checkpoints use the same decision as the lab router.
 * An error from the native fixture also falls through to the same program's
 * API path. That is not a measured equal score.
 */
export function serveRoute(input: {
  trained: boolean;
  measured: boolean;
  native: NativeAvailability;
}): { provider: "native" | "unorouter"; reason: string } {
  if (!input.trained)
    return { provider: "unorouter", reason: "native_not_trained" };
  if (!input.measured)
    return { provider: "unorouter", reason: "native_not_good_enough" };
  return routingDecision(input.native);
}

export async function answerWithProgram(input: {
  program: ModelProgram;
  native: NativeAvailability;
  messages: readonly {
    role: "system" | "user" | "assistant";
    content: string;
  }[];
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  apiKey?: string;
  apiKeys?: readonly string[];
  checkpointId?: string | null;
  budget?: LabCostBudget;
}): Promise<ProgramAnswer> {
  let decision = serveRoute({
    trained: input.program.training.trainingReady,
    measured: input.program.evalSuite.measured,
    native: input.native,
  });
  const userText = input.messages.map((message) => message.content).join("\n");
  const trace = runReasoningPolicy(input.program, userText);
  const env = input.env ?? process.env;
  const budget = input.budget ?? budgetFromEnv(env);
  const inputTokens = input.messages.reduce(
    (sum, message) => sum + message.content.length,
    0,
  );
  const constraint = constrainProgram({
    program: input.program,
    trace,
    text: userText,
    inputTokens,
    outputTokens: 0,
  });
  if (decision.provider === "native") {
    try {
      const checkpoint = input.checkpointId ?? null;
      if (!checkpoint) throw new Error("native route requires a checkpoint id");
      const quote = quoteNative(input.program.id, inputTokens, 0);
      reserveNativeQuote(budget, quote);
      return {
        text: "Native fixture runtime is selected. This is not a trained model response.",
        userLabel: userLabel(input.program, "native"),
        provenance: provenanceLine({
          program: input.program,
          provider: "native",
          modelId: input.program.nativeModelId,
          checkpoint,
        }),
        provider: "native",
        modelId: input.program.nativeModelId,
        checkpoint,
        routingReason: decision.reason,
        activity: "native_inference",
        version: input.program.architecture.version,
        latencyMs: 0,
        costUsd: 0,
        costPolicy: "native_card",
        costQuote: quote,
        budgetNote: constraint.budgetNote,
        phases: trace.phases,
        armIds: constraint.armIds,
        armSteps: constraint.executions.flatMap((item) => item.steps),
        fixtureChecks: constraint.checks,
        measuredEqual: false,
        outsideProgram: trace.outsideProgram,
        trained: false,
      };
    } catch (error) {
      if (error instanceof PriceError) throw error;
      const message = error instanceof Error ? error.message : "";
      if (message.startsWith("cost budget stop")) throw error;
      decision = { provider: "unorouter", reason: "native_error" };
    }
  }
  const modelId = fallbackModelId(input.program, env);
  const armSteps = constraint.executions.flatMap((item) => item.steps);
  if (constraint.executions.some((item) => item.blocked)) {
    const refusal =
      "The selected program refused this step. Locked surfaces were not changed. No checkpoint was used, and no benchmark was scored.";
    return {
      text: [stepBlock(armSteps), refusal].filter(Boolean).join("\n\n"),
      userLabel: userLabel(input.program, "unorouter"),
      provenance: provenanceLine({
        program: input.program,
        provider: "unorouter",
        modelId,
        checkpoint: null,
      }),
      provider: "unorouter",
      modelId,
      checkpoint: null,
      routingReason: decision.reason,
      activity: "api_fallback",
      version: input.program.architecture.version,
      latencyMs: 0,
      costUsd: 0,
      costPolicy: "provider_fallback",
      costQuote: constraint.quote,
      budgetNote: constraint.budgetNote,
      phases: trace.phases,
      armIds: constraint.armIds,
      armSteps,
      fixtureChecks: constraint.checks,
      measuredEqual: false,
      outsideProgram: trace.outsideProgram,
      trained: false,
    };
  }
  const apiKeys =
    input.apiKeys ??
    (input.apiKey && input.apiKey.trim()
      ? [input.apiKey.trim()]
      : labKeyPool(env));
  const api = new APIModelProvider({
    modelId,
    apiKeys,
    env,
    fetchImpl: input.fetchImpl,
    budget,
  });
  const result = await api.complete({
    trackId: input.program.id,
    nativeModelId: input.program.nativeModelId,
    messages: [
      { role: "system", content: constraint.system },
      ...input.messages,
    ],
  });
  const gated = applyBehaviorGate(input.program, result.text);
  const body = gated.text;
  const scoped = trace.outsideProgram ? `${trace.note}\n\n${body}` : body;
  const text = [stepBlock(armSteps), scoped].filter(Boolean).join("\n\n");
  return {
    text,
    userLabel: userLabel(input.program, "unorouter"),
    provenance: provenanceLine({
      program: input.program,
      provider: "unorouter",
      modelId: result.provenance.modelId,
      checkpoint: null,
    }),
    provider: "unorouter",
    modelId: result.provenance.modelId,
    checkpoint: null,
    routingReason: decision.reason,
    activity: "api_fallback",
    version: result.provenance.version,
    latencyMs: result.provenance.latencyMs,
    costUsd: result.provenance.costUsd,
    costPolicy: "provider_fallback",
    costQuote: constraint.quote,
    budgetNote: constraint.budgetNote,
    phases: trace.phases,
    armIds: constraint.armIds,
    armSteps,
    fixtureChecks: constraint.checks,
    measuredEqual: false,
    outsideProgram: trace.outsideProgram,
    trained: false,
  };
}
