import type { StageOutcome } from "../arms/types";

// The worker/engine boundary.
//
// Kept in its own module, free of server-only imports, because this mapping is
// the entire contract between what an arm reports and what the claim scan will
// do next -- and a contract that cannot be tested without a database is a
// contract nobody checks.

/** Counts a slice adds to the run budget when its checkpoint commits. */
export type PendingBudget = {
  modelCalls: number;
  toolCalls: number;
};

function nonNegativeInt(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.floor(value));
}

/**
 * The charge recorded on the stage context, not yet committed.
 *
 * Absent or malformed values charge nothing. A negative or fractional count
 * cannot increase the budget.
 */
export function pendingBudgetOf(state: Record<string, unknown>): PendingBudget {
  const pending = state.pendingBudget;
  if (!pending || typeof pending !== "object") {
    return { modelCalls: 0, toolCalls: 0 };
  }
  const record = pending as Record<string, unknown>;
  return {
    modelCalls: nonNegativeInt(record.modelCalls),
    toolCalls: nonNegativeInt(record.toolCalls),
  };
}

/**
 * Apply a slice charge once per stage attempt.
 *
 * The database commits this decision in the same transaction as the
 * checkpoint. A replay of an attempt that already settled adds nothing, so a
 * crash cannot bill the slice twice. A later slice is a new attempt and
 * charges only its own delta.
 */
export function budgetChargeForAttempt(input: {
  settledAttemptIds: readonly string[];
  attemptId: string;
  pending: PendingBudget;
}): PendingBudget & { alreadySettled: boolean } {
  if (input.settledAttemptIds.includes(input.attemptId)) {
    return { modelCalls: 0, toolCalls: 0, alreadySettled: true };
  }
  return { ...input.pending, alreadySettled: false };
}

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
