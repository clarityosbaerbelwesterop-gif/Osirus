import { redact } from "../security/redact";

type CodedError = Error & { code?: unknown };

export function runtimeErrorCode(error: unknown) {
  const code = (error as CodedError | undefined)?.code;
  return typeof code === "string" ? code : "runtime_error";
}

export function publicRuntimeErrorMessage(error: unknown) {
  switch (runtimeErrorCode(error)) {
    case "cancelled":
      return "Run cancelled.";
    case "rate_limited":
      return "The model provider is busy. Please try again shortly.";
    case "capacity_deferred":
      return "Model capacity is reserved for interactive requests right now. This work resumes automatically.";
    case "timeout":
      return "The model request timed out. Please try again.";
    case "provider_not_configured":
    case "model_not_configured":
      return "The model runtime is not configured.";
    case "credential_rejected":
      return "The model provider rejected the deployment's credentials. An operator needs to fix this.";
    case "provider_unavailable":
      return "The model provider is temporarily unavailable. Please try again later.";
    case "insufficient_credit":
      return "The model provider declined the request: the account's free quota or credit is exhausted.";
    case "invalid_stream":
    case "invalid_json":
      return "The model returned an unusable response. Please try again.";
    default:
      return "The run could not be completed. Please try again.";
  }
}

export function safeDiagnosticMessage(error: unknown) {
  return redact(
    error instanceof Error ? error.message.slice(0, 500) : "Unknown error",
  );
}
