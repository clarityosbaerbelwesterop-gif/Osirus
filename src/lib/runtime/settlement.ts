import type { StageOutcome } from "../arms/types";

// The worker/engine boundary.
//
// Kept in its own module, free of server-only imports, because this mapping is
// the entire contract between what an arm reports and what the claim scan will
// do next -- and a contract that cannot be tested without a database is a
// contract nobody checks.

/**
 * How a stage outcome becomes one finish_attempt call. Exported because this
 * mapping is the whole contract between a worker and the claim scan, and it
 * has to be testable without a database.
 */
export function settlementFor(outcome: StageOutcome) {
  switch (outcome.kind) {
    case "COMPLETE":
      return {
        attemptStatus: "completed" as const,
        stageStatus: "completed" as const,
        output: outcome.output,
        retryDelaySeconds: 0,
      };
    case "PROGRESS":
      // blocked with no delay is immediately claimable again, which is how a
      // stage yields without being treated as a retry.
      return {
        attemptStatus: "completed" as const,
        stageStatus: "blocked" as const,
        output: outcome.output,
        retryDelaySeconds: 0,
      };
    case "WAITING":
      return {
        attemptStatus: "completed" as const,
        stageStatus: "waiting" as const,
        output: { ...outcome.output, waitingOn: outcome.reason },
        retryDelaySeconds: 0,
      };
    case "BLOCKED":
      return {
        attemptStatus: "completed" as const,
        stageStatus: "blocked" as const,
        output: { blockedReason: outcome.reason },
        retryDelaySeconds: Math.max(1, outcome.retryAfterSeconds),
        failureClass: outcome.reason,
      };
    case "FAILED":
      return {
        attemptStatus: "failed" as const,
        // A retryable failure parks the stage in blocked so the next claim is
        // a fresh attempt. `failed` is terminal by design and means exhausted.
        stageStatus: outcome.retryable
          ? ("blocked" as const)
          : ("failed" as const),
        output: null,
        retryDelaySeconds: outcome.retryable ? 5 : 0,
        failureClass: outcome.failureClass,
        lastError: outcome.error,
      };
  }
}
