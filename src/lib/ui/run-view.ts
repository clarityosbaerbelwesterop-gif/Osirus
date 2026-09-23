import type { RunSnapshot } from "../runtime/types";
import { approvalView, type ApprovalView } from "./approval-view";
import {
  armLabel,
  failureMessage,
  runStatus,
  STAGE_STATE_LABEL,
  stageState,
  verdict,
  type StageState,
  type Tone,
} from "./labels";
import { iso, list, num, obj, str } from "./records";

// A run, as the person who started it follows it.
//
// Derived only from the persisted snapshot: stages and their states, the
// events the runtime marked user-visible, approvals and attempts. No model
// reasoning is read or shown -- event summaries are written by the runtime,
// not by the model thinking aloud.

export const TERMINAL = new Set(["completed", "failed", "cancelled"]);

export type StageView = {
  id: string;
  name: string;
  state: StageState;
  stateLabel: string;
  durationMs: number | null;
  verdictLabel: string | null;
  verdictTone: Tone | null;
  waitsOn: string[];
};

export type RunView = {
  runId: string;
  objective: string;
  status: string;
  statusLabel: string;
  tone: Tone;
  live: boolean;
  armId: string | null;
  armLabel: string;
  composition: string[];
  stages: StageView[];
  doneCount: number;
  totalCount: number;
  progress: number;
  current: StageView | null;
  currentStep: string | null;
  evidence: Array<{ id: string; label: string; at: string }>;
  pendingApprovals: ApprovalView[];
  approvals: ApprovalView[];
  failure: { stage: string | null; message: string } | null;
  memoryCount: number | null;
};

function duration(stage: unknown, now: number) {
  const started = iso(stage, "started_at");
  if (!started) return null;
  const completed = iso(stage, "completed_at");
  const end = completed ? Date.parse(completed) : now;
  const value = end - Date.parse(started);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

export function deriveRunView(
  snapshot: RunSnapshot,
  now = Date.now(),
): RunView {
  const status = runStatus(snapshot.run.status);
  const names = new Map(
    snapshot.stages.map((stage) => [
      str(stage, "id") ?? "",
      str(stage, "name") ?? "Step",
    ]),
  );
  const waits = new Map<string, string[]>();
  for (const edge of snapshot.dependencies ?? []) {
    const stageId = str(edge, "stage_id");
    const dependsOn = str(edge, "depends_on_stage_id");
    if (!stageId || !dependsOn) continue;
    waits.set(stageId, [
      ...(waits.get(stageId) ?? []),
      names.get(dependsOn) ?? "an earlier step",
    ]);
  }

  const stages: StageView[] = snapshot.stages.map((stage, index) => {
    const id = str(stage, "id") ?? String(index);
    const state = stageState(str(stage, "status"));
    const verdictStatus = str(stage, "verifier_status");
    const verdictInfo = verdictStatus ? verdict(verdictStatus) : null;
    return {
      id,
      name: str(stage, "name") ?? "Step",
      state,
      stateLabel: STAGE_STATE_LABEL[state],
      durationMs: state === "pending" ? null : duration(stage, now),
      verdictLabel: verdictInfo?.label ?? null,
      verdictTone: verdictInfo?.tone ?? null,
      waitsOn: waits.get(id) ?? [],
    };
  });

  const doneCount = stages.filter(
    (stage) => stage.state === "done" || stage.state === "skipped",
  ).length;
  const live = !TERMINAL.has(snapshot.run.status);
  const current =
    stages.find((stage) => stage.state === "running") ??
    stages.find((stage) => stage.state === "waiting") ??
    (live ? (stages.find((stage) => stage.state === "pending") ?? null) : null);

  const userEvents = snapshot.events.filter(
    (event) => event.visibility === "user",
  );
  const evidence = userEvents.slice(-40).map((event) => ({
    id: event.id,
    label: event.summary,
    at: event.at,
  }));

  const approvals = snapshot.approvals.map((row) =>
    approvalView({ ...row, run_id: snapshot.run.id }, now),
  );

  let failure: RunView["failure"] = null;
  if (snapshot.run.status === "failed") {
    const failedStage = stages.find((stage) => stage.state === "failed");
    const attempt = [...snapshot.attempts]
      .reverse()
      .find((row) => str(row, "failure_class") || str(row, "last_error"));
    failure = {
      stage: failedStage?.name ?? null,
      message: failureMessage(
        str(attempt, "failure_class") ?? snapshot.run.errorCode,
        str(attempt, "last_error") ?? snapshot.run.errorMessage,
      ),
    };
  }

  const memoryEvent = snapshot.events.find(
    (event) => event.type === "memory.retrieved",
  );
  const routing = obj(snapshot.run.acceptanceContract, "routing");

  return {
    runId: snapshot.run.id,
    objective: snapshot.run.objective,
    status: snapshot.run.status,
    statusLabel: status.label,
    tone: status.tone,
    live,
    armId: snapshot.run.armId ?? null,
    armLabel: armLabel(snapshot.run.armId),
    composition: list(routing, "composition").map(String),
    stages,
    doneCount,
    totalCount: stages.length,
    progress: stages.length ? doneCount / stages.length : 0,
    current,
    currentStep: live ? (userEvents.at(-1)?.summary ?? null) : null,
    evidence,
    pendingApprovals: approvals.filter((approval) => approval.decidable),
    approvals,
    failure,
    memoryCount: num(memoryEvent?.data, "count"),
  };
}

export type ResumeSummary = {
  completed: string[];
  inProgress: string | null;
  attention: string[];
};

/** What changed while the person was away: finished steps and open asks. */
export function resumeSummary(view: RunView): ResumeSummary {
  const attention = [
    ...view.pendingApprovals.map((approval) => `Approval: ${approval.title}`),
    ...(view.failure
      ? [view.failure.stage ? `${view.failure.stage} failed` : "The run failed"]
      : []),
  ];
  return {
    completed: view.stages
      .filter((stage) => stage.state === "done")
      .map((stage) => stage.name),
    inProgress: view.live ? (view.current?.name ?? null) : null,
    attention,
  };
}
