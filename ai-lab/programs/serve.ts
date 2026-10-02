import { LabCostBudget } from "../inference/budget";
import { APIModelProvider } from "../inference/providers";
import { routingDecision, type NativeAvailability } from "../inference/types";
import { labApiKey } from "../inference/unorouter";
import { forbidsTrainedClaim } from "./behavior";
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
}): Promise<ProgramAnswer> {
  const decision = routingDecision(input.native);
  if (decision.provider === "native") {
    const checkpoint = input.checkpointId ?? null;
    if (!checkpoint) throw new Error("native route requires a checkpoint id");
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
      trained: false,
    };
  }
  const env = input.env ?? process.env;
  const modelId = fallbackModelId(input.program, env);
  const api = new APIModelProvider({
    modelId,
    apiKey: input.apiKey ?? labApiKey(env),
    env,
    fetchImpl: input.fetchImpl,
    budget: new LabCostBudget(0),
  });
  const result = await api.complete({
    trackId: input.program.id,
    nativeModelId: input.program.nativeModelId,
    messages: input.messages,
  });
  const claim = forbidsTrainedClaim(result.text, input.program.displayName);
  return {
    text: claim
      ? "The fallback text was withheld because it described itself as the native model. No checkpoint was used."
      : result.text,
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
    trained: false,
  };
}
