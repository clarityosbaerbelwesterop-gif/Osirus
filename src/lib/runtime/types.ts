export type Capability =
  | "general"
  | "coding"
  | "research"
  | "math_science"
  | "data"
  | "multimodal"
  | "computer_use";

export type RunStatus =
  | "created"
  | "planning"
  | "queued"
  | "running"
  | "waiting_for_approval"
  | "verifying"
  | "repairing"
  | "blocked"
  | "cancelling"
  | "cancelled"
  | "failed"
  | "completed";

export type StageStatus =
  | "pending"
  | "running"
  | "waiting"
  | "blocked"
  | "failed"
  | "completed"
  | "skipped"
  | "cancelled";

export type RuntimeEvent = {
  id: string;
  runId: string;
  stageId?: string | null;
  sequence: number;
  type: string;
  visibility: "user" | "internal";
  summary: string;
  at: string;
  data: Record<string, unknown>;
  parentEventId?: string | null;
  correlationId?: string | null;
};

export type Checkpoint = {
  id: string;
  runId: string;
  stageId?: string | null;
  label: string;
  version: number;
  state: Record<string, unknown>;
  createdAt: string;
};

export type RuntimePacket =
  | { kind: "started"; runId: string; sessionId: string }
  | { kind: "event"; event: RuntimeEvent }
  | { kind: "delta"; runId: string; text: string }
  | { kind: "snapshot"; snapshot: RunSnapshot }
  | { kind: "done"; runId: string; status: RunStatus }
  | { kind: "error"; runId?: string; message: string };

export type VerdictStatus =
  "verified" | "rejected" | "conflicted" | "unverified";

export type RunSnapshot = {
  run: {
    id: string;
    sessionId: string;
    objective: string;
    status: RunStatus;
    output?: Record<string, unknown> | null;
    errorCode?: string | null;
    errorMessage?: string | null;
    cancelRequested: boolean;
    /** Which agent arm drove the run, once routing has decided. */
    armId?: string | null;
    /** What the run promised to deliver, written before execution. */
    acceptanceContract?: Record<string, unknown> | null;
  };
  stages: Array<Record<string, unknown>>;
  /** One row per worker that took a stage, with its lease and outcome. */
  attempts: Array<Record<string, unknown>>;
  /** The DAG edges, so the plan can be drawn rather than assumed linear. */
  dependencies: Array<Record<string, unknown>>;
  artifacts: Array<Record<string, unknown>>;
  approvals: Array<Record<string, unknown>>;
  events: RuntimeEvent[];
  checkpoints: Checkpoint[];
  messages: Array<{
    id: string;
    role: "user" | "assistant" | "system";
    content: string;
    createdAt: string;
  }>;
};
