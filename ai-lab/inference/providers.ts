import { BudgetExceededError, BudgetGuard } from "../infra/runpod";
import type { TinyState } from "../training/tiny-engine";
import { forward } from "../training/tiny-engine";
import { estimateCallUsd, type LabCostBudget } from "./budget";
import {
  routingDecision,
  type LabCompleteRequest,
  type LabCompleteResult,
  type LabModelProvider,
  type NativeAvailability,
} from "./types";
import { labApiKey, unorouterChat, type ChatMessage } from "./unorouter";

export class NativeModelProvider implements LabModelProvider {
  readonly name = "native" as const;

  constructor(
    private readonly options: {
      status: () => NativeAvailability;
      checkpoint: TinyState | null;
      checkpointId: string | null;
    },
  ) {}

  async complete(request: LabCompleteRequest): Promise<LabCompleteResult> {
    const decision = routingDecision(this.options.status());
    if (decision.provider !== "native") {
      throw new Error(`native provider is not serving: ${decision.reason}`);
    }
    if (!this.options.checkpoint || !this.options.checkpointId) {
      throw new Error("native checkpoint missing at runtime");
    }
    const started = Date.now();
    const features = request.features ?? [1, 0];
    const y = forward(this.options.checkpoint, features);
    return {
      text: JSON.stringify(y),
      provenance: {
        provider: "native",
        modelId: request.nativeModelId,
        checkpoint: this.options.checkpointId,
        version: "osirus-tiny-json-v1",
        routingReason: decision.reason,
        latencyMs: Date.now() - started,
        tokenUsage: { input: 0, output: 0 },
        costUsd: 0,
        evaluationState: "checkpoint_validated",
      },
    };
  }
}

export class APIModelProvider implements LabModelProvider {
  readonly name = "unorouter" as const;

  constructor(
    private readonly options: {
      modelId: string;
      apiKey?: string;
      baseUrl?: string;
      fetchImpl?: typeof fetch;
      budget: LabCostBudget;
      priceUsd?: number;
      env?: NodeJS.ProcessEnv;
    },
  ) {}

  async complete(request: LabCompleteRequest): Promise<LabCompleteResult> {
    const apiKey =
      this.options.apiKey ?? labApiKey(this.options.env ?? process.env);
    const estimate = estimateCallUsd(
      this.options.modelId,
      this.options.priceUsd,
    );
    this.options.budget.reserve(estimate);
    const started = Date.now();
    const result = await unorouterChat({
      apiKey,
      baseUrl: this.options.baseUrl,
      model: this.options.modelId,
      messages: request.messages as ChatMessage[],
      fetchImpl: this.options.fetchImpl,
    });
    return {
      text: result.text,
      provenance: {
        provider: "unorouter",
        modelId: result.modelId,
        checkpoint: null,
        version: "unorouter-api",
        routingReason: "api_fallback",
        latencyMs: Date.now() - started,
        tokenUsage: result.tokenUsage,
        costUsd: estimate,
        evaluationState: "unverified",
      },
    };
  }
}

export class FallbackModelProvider implements LabModelProvider {
  readonly name = "fallback" as const;

  constructor(
    private readonly native: NativeModelProvider,
    private readonly api: APIModelProvider,
    private readonly status: () => NativeAvailability,
  ) {}

  async complete(request: LabCompleteRequest): Promise<LabCompleteResult> {
    const decision = routingDecision(this.status());
    if (decision.provider === "native") return this.native.complete(request);
    const result = await this.api.complete(request);
    return {
      ...result,
      provenance: { ...result.provenance, routingReason: decision.reason },
    };
  }
}

/** Reuse the RunPod budget guard: over-ceiling estimates stop, nothing is booted. */
export function assertGpuQuoteStops(estimatedUsd: number): void {
  const guard = new BudgetGuard({ maxUsdPerRun: 1, maxUsdTotal: 1 });
  try {
    guard.assertWithinBudget(estimatedUsd);
  } catch (error) {
    if (error instanceof BudgetExceededError) throw error;
    throw error;
  }
}
