import { randomUUID } from "node:crypto";
import { queryAs } from "../db/client";
import { assertRunTransition, assertStageTransition } from "./state-machine";
import type {
  Checkpoint,
  RunSnapshot,
  RunStatus,
  RuntimeEvent,
  StageStatus,
} from "./types";

type RunRow = {
  id: string;
  organization_id: string;
  workspace_id: string;
  session_id: string;
  requested_by: string;
  objective: string;
  status: RunStatus;
  output: Record<string, unknown> | null;
  error_code: string | null;
  error_message: string | null;
  cancel_requested: boolean;
};

type EventRow = {
  id: string;
  run_id: string;
  stage_id: string | null;
  sequence: string | number;
  type: string;
  visibility: "user" | "internal";
  summary: string;
  data: Record<string, unknown>;
  created_at: string | Date;
  parent_event_id: string | null;
  correlation_id: string | null;
};

type CheckpointRow = {
  id: string;
  run_id: string;
  stage_id: string | null;
  label: string;
  state: Record<string, unknown>;
  version: number;
  created_at: string | Date;
};

type StageRow = {
  id: string;
  status: StageStatus;
};

function mapEvent(row: EventRow): RuntimeEvent {
  return {
    id: row.id,
    runId: row.run_id,
    stageId: row.stage_id,
    sequence: Number(row.sequence),
    type: row.type,
    visibility: row.visibility,
    summary: row.summary,
    data: row.data ?? {},
    at: new Date(row.created_at).toISOString(),
    parentEventId: row.parent_event_id,
    correlationId: row.correlation_id,
  };
}

function mapCheckpoint(row: CheckpointRow): Checkpoint {
  return {
    id: row.id,
    runId: row.run_id,
    stageId: row.stage_id,
    label: row.label,
    version: row.version,
    state: row.state,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

export class RuntimeRepository {
  constructor(private readonly actorId: string) {}

  async findRunByRequestId(workspaceId: string, requestId: string) {
    const rows = await queryAs<RunRow>(
      this.actorId,
      `select * from osirus.runs
        where workspace_id = $1::uuid and request_id = $2
        limit 1`,
      [workspaceId, requestId],
    );
    return rows[0] ?? null;
  }

  async createSession(input: {
    organizationId: string;
    workspaceId: string;
    title: string;
  }) {
    const id = randomUUID();
    const rows = await queryAs<{ id: string }>(
      this.actorId,
      `insert into osirus.sessions
         (id, organization_id, workspace_id, title, created_by)
       values ($1::uuid, $2::uuid, $3::uuid, $4, $5::uuid)
       returning id`,
      [
        id,
        input.organizationId,
        input.workspaceId,
        input.title.slice(0, 240) || "New session",
        this.actorId,
      ],
    );
    return rows[0]?.id ?? id;
  }

  async resolveSession(sessionId: string, workspaceId: string) {
    const rows = await queryAs<{ id: string }>(
      this.actorId,
      `select id from osirus.sessions
        where id = $1::uuid and workspace_id = $2::uuid and archived_at is null`,
      [sessionId, workspaceId],
    );
    return rows[0]?.id ?? null;
  }

  async getRecentWorkspaceState(workspaceId: string) {
    const sessions = await queryAs<{ id: string }>(
      this.actorId,
      `select id from osirus.sessions
        where workspace_id = $1::uuid and archived_at is null
        order by updated_at desc
        limit 1`,
      [workspaceId],
    );
    const sessionId = sessions[0]?.id ?? null;
    if (!sessionId) {
      return { sessionId: null, messages: [], activeRunId: null };
    }

    const [messages, activeRuns] = await Promise.all([
      queryAs<{
        id: string;
        role: "user" | "assistant" | "system";
        content: string;
        created_at: string | Date;
      }>(
        this.actorId,
        `select id, role, content, created_at
           from osirus.messages
          where session_id = $1::uuid
          order by created_at
          limit 200`,
        [sessionId],
      ),
      queryAs<{ id: string }>(
        this.actorId,
        `select id from osirus.runs
          where session_id = $1::uuid
            and status not in ('completed','failed','cancelled')
          order by created_at desc
          limit 1`,
        [sessionId],
      ),
    ]);

    return {
      sessionId,
      messages: messages.map((message) => ({
        id: message.id,
        role: message.role,
        content: message.content,
        createdAt: new Date(message.created_at).toISOString(),
      })),
      activeRunId: activeRuns[0]?.id ?? null,
    };
  }

  async createMessage(input: {
    organizationId: string;
    workspaceId: string;
    sessionId: string;
    runId?: string | null;
    role: "user" | "assistant" | "system";
    content: string;
    metadata?: Record<string, unknown>;
  }) {
    const rows = await queryAs<{ id: string }>(
      this.actorId,
      `insert into osirus.messages
         (organization_id, workspace_id, session_id, run_id, role, content, metadata)
       values ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $6, $7::jsonb)
       returning id`,
      [
        input.organizationId,
        input.workspaceId,
        input.sessionId,
        input.runId ?? null,
        input.role,
        input.content,
        JSON.stringify(input.metadata ?? {}),
      ],
    );
    if (!rows[0]) throw new Error("message_insert_failed");
    return rows[0].id;
  }

  async createRun(input: {
    organizationId: string;
    workspaceId: string;
    sessionId: string;
    objective: string;
    primaryCapability: string;
    secondaryCapabilities: string[];
    complexity: "low" | "medium" | "high";
    requestId: string;
  }): Promise<{ run: RunRow; created: boolean }> {
    const id = randomUUID();
    const rows = await queryAs<RunRow & { created: boolean }>(
      this.actorId,
      `with inserted as (
         insert into osirus.runs
           (id, organization_id, workspace_id, session_id, requested_by,
            objective, primary_capability, secondary_capabilities, complexity,
            status, input, request_id)
         values
           ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid,
            $6, $7, $8::text[], $9, 'created', $10::jsonb, $11)
         on conflict (workspace_id, request_id) where request_id is not null
         do nothing
         returning *, true as created
       )
       select * from inserted
       union all
       select r.*, false as created
         from osirus.runs r
        where r.workspace_id = $3::uuid and r.request_id = $11
       limit 1`,
      [
        id,
        input.organizationId,
        input.workspaceId,
        input.sessionId,
        this.actorId,
        input.objective,
        input.primaryCapability,
        input.secondaryCapabilities,
        input.complexity,
        JSON.stringify({ requestId: input.requestId }),
        input.requestId,
      ],
    );
    const row = rows[0];
    if (!row) throw new Error("run_insert_failed");
    return { run: row, created: row.created };
  }

  async getRun(runId: string) {
    const rows = await queryAs<RunRow>(
      this.actorId,
      "select * from osirus.runs where id = $1::uuid",
      [runId],
    );
    return rows[0] ?? null;
  }

  async transitionRun(
    runId: string,
    to: RunStatus,
    patch: {
      output?: Record<string, unknown> | null;
      errorCode?: string | null;
      errorMessage?: string | null;
    } = {},
  ) {
    const current = await this.getRun(runId);
    if (!current) throw new Error("run_not_found");
    assertRunTransition(current.status, to);

    const rows = await queryAs<RunRow>(
      this.actorId,
      `update osirus.runs
          set status = $2,
              started_at = case
                when $2 = 'running' and started_at is null then now()
                else started_at
              end,
              completed_at = case
                when $2 = any(array['completed','failed','cancelled']::text[]) then now()
                else completed_at
              end,
              output = coalesce($3::jsonb, output),
              error_code = $4,
              error_message = $5
        where id = $1::uuid and status = $6
        returning *`,
      [
        runId,
        to,
        patch.output === undefined ? null : JSON.stringify(patch.output),
        patch.errorCode ?? current.error_code,
        patch.errorMessage ?? current.error_message,
        current.status,
      ],
    );
    if (!rows[0]) throw new Error("run_transition_conflict");
    return rows[0];
  }

  async requestCancellation(runId: string) {
    const rows = await queryAs<RunRow>(
      this.actorId,
      `update osirus.runs
          set cancel_requested = true,
              status = case
                when status = any(array['completed','failed','cancelled']::text[]) then status
                else 'cancelling'
              end
        where id = $1::uuid
        returning *`,
      [runId],
    );
    return rows[0] ?? null;
  }

  async isCancellationRequested(runId: string) {
    const rows = await queryAs<{
      cancel_requested: boolean;
      status: RunStatus;
    }>(
      this.actorId,
      "select cancel_requested, status from osirus.runs where id = $1::uuid",
      [runId],
    );
    return Boolean(
      rows[0]?.cancel_requested || rows[0]?.status === "cancelling",
    );
  }

  async createStage(input: {
    runId: string;
    ordinal: number;
    name: string;
    capability: string;
    state?: Record<string, unknown>;
  }) {
    const rows = await queryAs<{ id: string }>(
      this.actorId,
      `insert into osirus.run_stages
         (run_id, ordinal, name, capability, status, input)
       values ($1::uuid, $2, $3, $4, 'pending', $5::jsonb)
       returning id`,
      [
        input.runId,
        input.ordinal,
        input.name,
        input.capability,
        JSON.stringify(input.state ?? {}),
      ],
    );
    if (!rows[0]) throw new Error("stage_insert_failed");
    return rows[0].id;
  }

  async setStageStatus(
    stageId: string,
    status: StageStatus,
    output?: Record<string, unknown>,
    verifierStatus?: "unverified" | "verified" | "conflicted" | "rejected",
  ) {
    const current = await queryAs<StageRow>(
      this.actorId,
      "select id, status from osirus.run_stages where id = $1::uuid",
      [stageId],
    );
    const stage = current[0];
    if (!stage) throw new Error("stage_not_found");
    assertStageTransition(stage.status, status);

    const rows = await queryAs<{ id: string }>(
      this.actorId,
      `update osirus.run_stages
          set status = $2,
              output = coalesce($3::jsonb, output),
              verifier_status = coalesce($4, verifier_status),
              started_at = case
                when $2 = 'running' and started_at is null then now()
                else started_at
              end,
              completed_at = case
                when $2 = any(array['completed','failed','skipped','cancelled']::text[])
                  then now()
                else completed_at
              end
        where id = $1::uuid and status = $5
        returning id`,
      [
        stageId,
        status,
        output ? JSON.stringify(output) : null,
        verifierStatus ?? null,
        stage.status,
      ],
    );
    if (!rows[0]) throw new Error("stage_transition_conflict");
  }

  async appendEvent(input: {
    runId: string;
    stageId?: string | null;
    type: string;
    visibility?: "user" | "internal";
    summary: string;
    data?: Record<string, unknown>;
    parentEventId?: string | null;
    correlationId?: string | null;
  }) {
    const rows = await queryAs<EventRow>(
      this.actorId,
      `select * from osirus.append_run_event(
         $1::uuid, $2::uuid, $3, $4, $5, $6::jsonb, $7::uuid, $8::uuid
       )`,
      [
        input.runId,
        input.stageId ?? null,
        input.type,
        input.visibility ?? "user",
        input.summary,
        JSON.stringify(input.data ?? {}),
        input.parentEventId ?? null,
        input.correlationId ?? null,
      ],
    );
    if (!rows[0]) throw new Error("event_insert_failed");
    return mapEvent(rows[0]);
  }

  async saveCheckpoint(input: {
    runId: string;
    stageId?: string | null;
    label: string;
    state: Record<string, unknown>;
  }) {
    const rows = await queryAs<CheckpointRow>(
      this.actorId,
      `select * from osirus.save_run_checkpoint(
         $1::uuid, $2::uuid, $3, $4::jsonb
       )`,
      [
        input.runId,
        input.stageId ?? null,
        input.label,
        JSON.stringify(input.state),
      ],
    );
    if (!rows[0]) throw new Error("checkpoint_insert_failed");
    return mapCheckpoint(rows[0]);
  }

  async createModelCall(input: {
    organizationId: string;
    workspaceId: string;
    runId: string;
    stageId: string;
    model: string;
    role: string;
    requestMetadata?: Record<string, unknown>;
  }) {
    const rows = await queryAs<{ id: string }>(
      this.actorId,
      `insert into osirus.model_calls
         (organization_id, workspace_id, run_id, stage_id, provider, model,
          logical_role, status, request_metadata)
       values ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 'unorouter', $5, $6,
               'started', $7::jsonb)
       returning id`,
      [
        input.organizationId,
        input.workspaceId,
        input.runId,
        input.stageId,
        input.model,
        input.role,
        JSON.stringify(input.requestMetadata ?? {}),
      ],
    );
    if (!rows[0]) throw new Error("model_call_insert_failed");
    return rows[0].id;
  }

  async finishModelCall(
    modelCallId: string,
    input: {
      status: "completed" | "failed" | "cancelled";
      inputTokens?: number;
      outputTokens?: number;
      cost?: number;
      latencyMs?: number;
      errorCode?: string | null;
      responseMetadata?: Record<string, unknown>;
    },
  ) {
    await queryAs(
      this.actorId,
      `update osirus.model_calls
          set status = $2,
              input_tokens = $3,
              output_tokens = $4,
              estimated_cost_usd = $5,
              latency_ms = $6,
              error_code = $7,
              response_metadata = $8::jsonb,
              completed_at = now()
        where id = $1::uuid`,
      [
        modelCallId,
        input.status,
        input.inputTokens ?? null,
        input.outputTokens ?? null,
        input.cost ?? null,
        input.latencyMs ?? null,
        input.errorCode ?? null,
        JSON.stringify(input.responseMetadata ?? {}),
      ],
    );
  }

  async getSnapshot(runId: string): Promise<RunSnapshot> {
    const run = await this.getRun(runId);
    if (!run) throw new Error("run_not_found");

    const [stages, events, checkpoints, messages] = await Promise.all([
      queryAs<Record<string, unknown>>(
        this.actorId,
        `select id, ordinal, name, capability, status, output, verifier_status,
                started_at, completed_at
           from osirus.run_stages
          where run_id = $1::uuid
          order by ordinal`,
        [runId],
      ),
      queryAs<EventRow>(
        this.actorId,
        "select * from osirus.run_events where run_id = $1::uuid order by sequence",
        [runId],
      ),
      queryAs<CheckpointRow>(
        this.actorId,
        "select * from osirus.checkpoints where run_id = $1::uuid order by version",
        [runId],
      ),
      queryAs<{
        id: string;
        role: "user" | "assistant" | "system";
        content: string;
        created_at: string | Date;
      }>(
        this.actorId,
        `select id, role, content, created_at
           from osirus.messages
          where session_id = $1::uuid
          order by created_at`,
        [run.session_id],
      ),
    ]);

    return {
      run: {
        id: run.id,
        sessionId: run.session_id,
        objective: run.objective,
        status: run.status,
        output: run.output,
        errorCode: run.error_code,
        errorMessage: run.error_message,
        cancelRequested: run.cancel_requested,
      },
      stages,
      events: events.map(mapEvent),
      checkpoints: checkpoints.map(mapCheckpoint),
      messages: messages.map((message) => ({
        id: message.id,
        role: message.role,
        content: message.content,
        createdAt: new Date(message.created_at).toISOString(),
      })),
    };
  }
}
