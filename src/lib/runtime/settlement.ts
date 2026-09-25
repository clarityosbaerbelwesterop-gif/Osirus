import { parkingFor } from "../agent/long-horizon";
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
  attempts?: number;
}): PendingBudget & { attempts: number; alreadySettled: boolean } {
  if (input.settledAttemptIds.includes(input.attemptId)) {
    return { modelCalls: 0, toolCalls: 0, attempts: 0, alreadySettled: true };
  }
  return {
    ...input.pending,
    attempts: nonNegativeInt(input.attempts ?? 0),
    alreadySettled: false,
  };
}

/**
 * Run-budget attempts this settled outcome spends.
 *
 * A waiting stage is parked outside the engine, and a terminal failure
 * already ends the slice, so neither spends an attempt. Every other settled
 * outcome spends one. The checkpoint records it; a replay of that attempt
 * records zero.
 */
export function runBudgetAttempts(outcome: StageOutcome): number {
  if (outcome.kind === "WAITING") return 0;
  if (outcome.kind === "FAILED" && !outcome.retryable) return 0;
  return 1;
}

/**
 * Whether the slice should stop because the checkpoint's charge crossed a
 * ceiling.
 *
 * The check sits where the separate attempt counter used to sit: after a
 * waiting stage (the slice keeps going) and after a terminal failure (the
 * slice is already stopping). A charge that did not commit reports nothing.
 */
export function budgetStopReason(
  outcome: StageOutcome,
  budget: { exhausted: boolean; reason: string | null } | null,
): string | null {
  if (!budget?.exhausted) return null;
  if (runBudgetAttempts(outcome) === 0) return null;
  return budget.reason ?? "budget";
}

/**
 * How a stage outcome becomes one finish_attempt call. Exported because this
 * mapping is the whole contract between a worker and the claim scan, and it
 * has to be testable without a database.
 */
export function settlementFor(outcome: StageOutcome, now = Date.now()) {
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
    case "WAITING": {
      // M40: a timed or polled wait parks the stage as blocked until it is
      // due (no claim, no model call before then); an event or a person
      // parks it as waiting until a release. Both cost nothing meanwhile.
      const parking = outcome.wake
        ? parkingFor(outcome.wake, now)
        : { stageStatus: "waiting" as const, retryDelaySeconds: 0 };
      return {
        attemptStatus: "completed" as const,
        stageStatus: parking.stageStatus,
        output: {
          ...outcome.output,
          waitingOn: outcome.reason,
          ...(outcome.wake
            ? { wait: { kind: outcome.reason, wake: outcome.wake } }
            : {}),
        },
        retryDelaySeconds: parking.retryDelaySeconds,
      };
    }
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
