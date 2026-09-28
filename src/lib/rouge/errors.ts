/** What a person reads when Rouge cannot answer; never provider internals. */
export function rougeErrorMessage(code: string) {
  switch (code) {
    case "cancelled":
      return "Stopped.";
    case "insufficient_credit":
      return "Rouge's foundation model has no credit left, and no substitute model could answer right now.";
    case "rate_limited":
    case "capacity_deferred":
      return "Rouge is busy right now. Please try again in a moment.";
    case "timeout":
    case "provider_unavailable":
      return "Rouge's foundation model is not answering right now. Please try again shortly.";
    case "credential_rejected":
    case "provider_not_configured":
    case "model_not_configured":
      return "Rouge is not configured correctly on this deployment. An operator needs to fix this.";
    case "invalid_request":
      return "That message could not be sent. Please check it and try again.";
    case "empty_answer":
      return "Rouge returned no answer. Please try again.";
    default:
      return "Rouge could not answer. Please try again.";
  }
}
