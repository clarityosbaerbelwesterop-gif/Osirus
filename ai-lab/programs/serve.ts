import { budgetFromEnv, LabCostBudget } from "../inference/budget";
import { APIModelProvider } from "../inference/providers";
import { routingDecision, type NativeAvailability } from "../inference/types";
import { labApiKey } from "../inference/unorouter";
import { forbidsTrainedClaim } from "./behavior";
import { quoteNative, reserveNativeQuote } from "./pricing";
import { runReasoningPolicy } from "./reasoning";
import type { Activity, ModelProgram } from "./types";

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
  readonly phases: readonly Activity[];
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
  checkpointId?: string | null;
  budget?: LabCostBudget;
}): Promise<ProgramAnswer> {
  const decision = serveRoute({
    trained: input.program.training.trainingReady,
    measured: input.program.evalSuite.measured,
    native: input.native,
  });
  const trace = runReasoningPolicy(
    input.program,
    input.messages.map((message) => message.content).join("\n"),
  );
  const env = input.env ?? process.env;
  const budget = input.budget ?? budgetFromEnv(env);
  if (decision.provider === "native") {
    const checkpoint = input.checkpointId ?? null;
    if (!checkpoint) throw new Error("native route requires a checkpoint id");
    const inputTokens = input.messages.reduce(
      (sum, message) => sum + message.content.length,
      0,
    );
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
      phases: trace.phases,
      outsideProgram: trace.outsideProgram,
      trained: false,
    };
  }
  const modelId = fallbackModelId(input.program, env);
  const api = new APIModelProvider({
    modelId,
    apiKey: input.apiKey ?? labApiKey(env),
    env,
    fetchImpl: input.fetchImpl,
    budget,
  });
  const result = await api.complete({
    trackId: input.program.id,
    nativeModelId: input.program.nativeModelId,
    messages: input.messages,
  });
  const claim = forbidsTrainedClaim(result.text, input.program.displayName);
  const body = claim
    ? "The fallback text was withheld because it described itself as the native model. No checkpoint was used."
    : result.text;
  const text = trace.outsideProgram ? `${trace.note}\n\n${body}` : body;
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
    phases: trace.phases,
    outsideProgram: trace.outsideProgram,
    trained: false,
  };
}
