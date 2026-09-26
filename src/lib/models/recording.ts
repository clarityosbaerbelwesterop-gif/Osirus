import { failureMetadata } from "./failure-report";
import type { ModelProvider, ModelRole, Usage } from "./provider";

// A provider wrapper that writes each structured or plain completion to
// model_calls. Stage answers already record their own calls; this covers the
// calls made outside that path (routing analysis, model review), which used
// to be spent without a trace and skewed every cost and failure metric.

export type ModelCallSink = {
  createModelCall(input: {
    organizationId: string;
    workspaceId: string;
    runId: string;
    stageId: string | null;
    model: string;
    role: string;
    requestMetadata?: Record<string, unknown>;
  }): Promise<string>;
  finishModelCall(
    id: string,
    input: {
      status: "completed" | "failed" | "cancelled";
      inputTokens?: number;
      outputTokens?: number;
      cost?: number;
      latencyMs?: number;
      errorCode?: string | null;
      responseMetadata?: Record<string, unknown>;
    },
  ): Promise<void>;
};

export type RecordingScope = {
  organizationId: string;
  workspaceId: string;
  runId: string;
  stageId: string | null;
  /** Why the call was made, e.g. "routing" or "review". */
  purpose: string;
};

function errorCode(error: unknown) {
  if (error && typeof error === "object" && "code" in error) {
    const code = (error as { code: unknown }).code;
    if (typeof code === "string") return code;
  }
  return error instanceof Error && error.name === "AbortError"
    ? "cancelled"
    : "provider_error";
}

export function recordingProvider(
  provider: ModelProvider,
  sink: ModelCallSink,
  scope: RecordingScope,
): ModelProvider {
  const record = async <T extends { usage: Usage }>(
    role: ModelRole,
    call: () => Promise<T>,
  ): Promise<T> => {
    // Recording must never break the call it describes.
    const id = await sink
      .createModelCall({
        organizationId: scope.organizationId,
        workspaceId: scope.workspaceId,
        runId: scope.runId,
        stageId: scope.stageId,
        model: provider.modelId(role),
        role,
        requestMetadata: { purpose: scope.purpose },
      })
      .catch(() => null);
    const startedAt = Date.now();
    try {
      const result = await call();
      if (id)
        await sink
          .finishModelCall(id, {
            status: "completed",
            inputTokens: result.usage.inputTokens,
            outputTokens: result.usage.outputTokens,
            cost: result.usage.cost,
            latencyMs: Date.now() - startedAt,
            responseMetadata: { purpose: scope.purpose },
          })
          .catch(() => undefined);
      return result;
    } catch (error) {
      if (id)
        await sink
          .finishModelCall(id, {
            status: errorCode(error) === "cancelled" ? "cancelled" : "failed",
            latencyMs: Date.now() - startedAt,
            errorCode: errorCode(error),
            responseMetadata: {
              purpose: scope.purpose,
              ...failureMetadata(error),
            },
          })
          .catch(() => undefined);
      throw error;
    }
  };

  return {
    stream: (input) => provider.stream(input),
    complete: (input) => record(input.role, () => provider.complete(input)),
    structured: (input) => record(input.role, () => provider.structured(input)),
    modelId: (role) => provider.modelId(role),
    servedModel: (requestId) => provider.servedModel?.(requestId),
    capabilities: () => provider.capabilities(),
    healthCheck: () => provider.healthCheck(),
    cancel: (id) => provider.cancel(id),
    normalizeUsage: (raw) => provider.normalizeUsage(raw),
    normalizeError: (error) => provider.normalizeError(error),
  };
}
