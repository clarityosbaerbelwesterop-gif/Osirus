export interface TokenUsage {
  readonly input: number;
  readonly output: number;
}

export interface Provenance {
  readonly provider: "native" | "unorouter";
  readonly modelId: string;
  readonly checkpoint: string | null;
  readonly version: string;
  readonly routingReason: string;
  readonly latencyMs: number;
  readonly tokenUsage: TokenUsage;
  readonly costUsd: number;
  readonly evaluationState: string;
}

export interface LabCompleteRequest {
  readonly trackId: string;
  readonly nativeModelId: string;
  readonly messages: readonly {
    role: "system" | "user" | "assistant";
    content: string;
  }[];
  readonly features?: readonly number[];
}

export interface LabCompleteResult {
  readonly text: string;
  readonly provenance: Provenance;
}

export interface LabModelProvider {
  readonly name: "native" | "unorouter" | "fallback";
  complete(request: LabCompleteRequest): Promise<LabCompleteResult>;
}

export interface NativeAvailability {
  readonly checkpointPresent: boolean;
  readonly checkpointValidated: boolean;
  readonly runtimeOnline: boolean;
}

export function routingDecision(native: NativeAvailability): {
  provider: "native" | "unorouter";
  reason: string;
} {
  if (!native.checkpointPresent) {
    return { provider: "unorouter", reason: "native_checkpoint_missing" };
  }
  if (!native.checkpointValidated) {
    return { provider: "unorouter", reason: "native_checkpoint_not_validated" };
  }
  if (!native.runtimeOnline) {
    return { provider: "unorouter", reason: "native_runtime_offline" };
  }
  return {
    provider: "native",
    reason: "native_checkpoint_validated_and_online",
  };
}
