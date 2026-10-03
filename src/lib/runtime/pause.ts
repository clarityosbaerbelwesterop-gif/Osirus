import type { RunStatus } from "./types";

const IN_PROGRESS = new Set<RunStatus>([
  "created",
  "planning",
  "queued",
  "running",
  "waiting_for_approval",
  "verifying",
  "repairing",
  "blocked",
]);

export function abortReason(signal: AbortSignal | undefined) {
  if (!signal?.aborted) return null;
  const reason = signal.reason;
  if (reason instanceof Error) return reason.message;
  if (typeof reason === "string") return reason;
  return "aborted";
}

export function isPauseAbort(signal: AbortSignal | undefined) {
  return abortReason(signal) === "pause_requested";
}

/** Pause is only for a coding run that is actually in progress. */
export function canPauseCodingRun(input: {
  coding: boolean;
  status: RunStatus;
  paused: boolean;
}) {
  if (!input.coding || input.paused) return false;
  return IN_PROGRESS.has(input.status);
}

/** Resume continues the same run. It is not available when nothing is paused. */
export function canResumeCodingRun(input: {
  coding: boolean;
  status: RunStatus;
  paused: boolean;
}) {
  if (!input.coding || !input.paused) return false;
  return (
    input.status !== "completed" &&
    input.status !== "failed" &&
    input.status !== "cancelled"
  );
}
