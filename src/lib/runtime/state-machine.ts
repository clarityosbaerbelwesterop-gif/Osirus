import type { RunStatus, StageStatus } from "./types";

const terminalRunStatuses = new Set<RunStatus>([
  "cancelled",
  "failed",
  "completed",
]);

const runTransitions: Record<RunStatus, readonly RunStatus[]> = {
  created: ["planning", "queued", "cancelling", "failed"],
  planning: ["queued", "running", "blocked", "cancelling", "failed"],
  queued: ["running", "blocked", "cancelling", "failed"],
  running: [
    "waiting_for_approval",
    "verifying",
    "repairing",
    "blocked",
    "cancelling",
    "completed",
    "failed",
  ],
  waiting_for_approval: ["running", "blocked", "cancelling", "failed"],
  verifying: ["repairing", "completed", "cancelling", "failed"],
  repairing: ["running", "verifying", "blocked", "cancelling", "failed"],
  blocked: ["queued", "running", "cancelling", "failed"],
  cancelling: ["cancelled", "failed"],
  cancelled: [],
  failed: [],
  completed: [],
};

const stageTransitions: Record<StageStatus, readonly StageStatus[]> = {
  pending: ["running", "waiting", "blocked", "skipped", "cancelled"],
  running: ["waiting", "blocked", "failed", "completed", "cancelled"],
  waiting: ["running", "blocked", "failed", "cancelled"],
  blocked: ["running", "failed", "skipped", "cancelled"],
  failed: [],
  completed: [],
  skipped: [],
  cancelled: [],
};

export function canTransitionRun(from: RunStatus, to: RunStatus) {
  return runTransitions[from].includes(to);
}

export function assertRunTransition(from: RunStatus, to: RunStatus) {
  if (from === to) return;
  if (!canTransitionRun(from, to)) {
    throw new Error(`invalid_run_transition:${from}->${to}`);
  }
}

export function canTransitionStage(from: StageStatus, to: StageStatus) {
  return stageTransitions[from].includes(to);
}

export function isTerminalRunStatus(status: RunStatus) {
  return terminalRunStatuses.has(status);
}
