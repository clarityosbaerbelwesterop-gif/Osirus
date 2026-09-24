import "server-only";
import { querySystem } from "../db/client";
import type { StageStatus } from "./types";

// Durable work dispatch.
//
// Every operation here is one statement, because queryAs/querySystem run a
// fixed two-element array over the Neon HTTP driver and cannot hold an
// interactive transaction open across round trips. Anything needing several
// writes to land together is a plpgsql function in
// db/migrations/008_workflow_engine.sql, not a sequence of calls from here.
//
// These run under querySystem: the scheduler legitimately works across tenants,
// and the policies grant that through osirus.is_system() rather than by
// bypassing row-level security.

export type AttemptStatus =
  | "created"
  | "claimed"
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | "lost";

/** A stage claimed by this worker, with everything needed to execute it. */
export type ClaimedWork = {
  attemptId: string;
  leaseToken: string;
  leaseExpiresAt: string;
  attemptNumber: number;
  sliceCount: number;
  handoff: Record<string, unknown>;
  runId: string;
  stageId: string;
  organizationId: string;
  workspaceId: string;
  sessionId: string;
  /** The run's owner. The scheduler executes as this user, not as itself. */
  requestedBy: string;
  objective: string;
  stageName: string;
  capability: string;
  ordinal: number;
  stageInput: Record<string, unknown>;
  requiresVerification: boolean;
};

type ClaimRow = {
  attempt_id: string;
  lease_token: string;
  lease_expires_at: string;
  attempt_number: number;
  slice_count: number;
  handoff: Record<string, unknown> | null;
  run_id: string;
  stage_id: string;
  organization_id: string;
  workspace_id: string;
  session_id: string;
  requested_by: string;
  objective: string;
  stage_name: string;
  capability: string;
  ordinal: number;
  stage_input: Record<string, unknown> | null;
  requires_verification: boolean;
};

/**
 * Take the next runnable stage, or null when there is nothing to do.
 *
 * The join is what makes "no work" observable: claim_next_stage returns a NULL
 * composite when it finds nothing, and joining that against run_stages yields
 * zero rows rather than a row of nulls. It also means one round trip returns
 * both the lease and the context the worker needs to act on it.
 */
export async function claimNextStage(input: {
  workerId: string;
  leaseSeconds?: number;
  runId?: string | null;
}): Promise<ClaimedWork | null> {
  const rows = await querySystem<ClaimRow>(
    `with claimed as (
       select * from osirus.claim_next_stage($1, $2, $3::uuid)
     )
     select c.id as attempt_id,
            c.lease_token,
            c.lease_expires_at,
            c.attempt_number,
            c.slice_count,
            c.handoff,
            c.run_id,
            c.stage_id,
            r.organization_id,
            r.workspace_id,
            r.session_id,
            r.requested_by,
            r.objective,
            s.name as stage_name,
            s.capability,
            s.ordinal,
            s.input as stage_input,
            s.requires_verification
       from claimed c
       join osirus.run_stages s on s.id = c.stage_id
       join osirus.runs r on r.id = c.run_id`,
    [input.workerId, input.leaseSeconds ?? 60, input.runId ?? null],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    attemptId: row.attempt_id,
    leaseToken: row.lease_token,
    leaseExpiresAt: row.lease_expires_at,
    attemptNumber: row.attempt_number,
    sliceCount: row.slice_count,
    handoff: row.handoff ?? {},
    runId: row.run_id,
    stageId: row.stage_id,
    organizationId: row.organization_id,
    workspaceId: row.workspace_id,
    sessionId: row.session_id,
    requestedBy: row.requested_by,
    objective: row.objective,
    stageName: row.stage_name,
    capability: row.capability,
    ordinal: row.ordinal,
    stageInput: row.stage_input ?? {},
    requiresVerification: row.requires_verification,
  };
}

/**
 * Extend the lease. False means the lease is gone -- the stage was reclaimed
 * by someone else -- and the caller must stop rather than keep writing.
 */
export async function heartbeatAttempt(input: {
  attemptId: string;
  leaseToken: string;
  leaseSeconds?: number;
}): Promise<boolean> {
  const rows = await querySystem<{ renewed: boolean }>(
    "select osirus.heartbeat_attempt($1::uuid, $2::uuid, $3) as renewed",
    [input.attemptId, input.leaseToken, input.leaseSeconds ?? 60],
  );
  return rows[0]?.renewed === true;
}

/**
 * Close an attempt and move its stage together. False means the lease was
 * already lost, in which case the result must be discarded: someone else owns
 * this stage now and may have advanced past it.
 */
export async function finishAttempt(input: {
  attemptId: string;
  leaseToken: string;
  attemptStatus: Extract<
    AttemptStatus,
    "completed" | "failed" | "cancelled" | "lost"
  >;
  stageStatus: Extract<
    StageStatus,
    "completed" | "failed" | "blocked" | "waiting" | "skipped" | "cancelled"
  >;
  output?: Record<string, unknown> | null;
  failureClass?: string | null;
  lastError?: string | null;
  retryDelaySeconds?: number;
}): Promise<boolean> {
  const rows = await querySystem<{ settled: boolean }>(
    `select osirus.finish_attempt(
       $1::uuid, $2::uuid, $3, $4, $5::jsonb, $6, $7, $8
     ) as settled`,
    [
      input.attemptId,
      input.leaseToken,
      input.attemptStatus,
      input.stageStatus,
      input.output ? JSON.stringify(input.output) : null,
      input.failureClass ?? null,
      input.lastError ?? null,
      input.retryDelaySeconds ?? 0,
    ],
  );
  return rows[0]?.settled === true;
}

export type BudgetScope = "run" | "stage" | "worker";

export type BudgetOutcome = { exhausted: boolean; reason: string | null };

/**
 * Record consumption and report whether a ceiling is now breached. A run with
 * no budget row for the scope is unbounded, not blocked -- absence of a policy
 * must not stop work.
 */
export async function consumeBudget(input: {
  runId: string;
  scope: BudgetScope;
  scopeId?: string | null;
  inputTokens?: number;
  outputTokens?: number;
  modelCalls?: number;
  toolCalls?: number;
  attempts?: number;
  repairRounds?: number;
  wallClockMs?: number;
  costUsd?: number;
}): Promise<BudgetOutcome> {
  const rows = await querySystem<{ exhausted: boolean; reason: string | null }>(
    `select exhausted, reason from osirus.consume_budget(
       $1::uuid, $2, $3::uuid, $4, $5, $6, $7, $8, $9, $10, $11
     )`,
    [
      input.runId,
      input.scope,
      input.scopeId ?? null,
      input.inputTokens ?? 0,
      input.outputTokens ?? 0,
      input.modelCalls ?? 0,
      input.toolCalls ?? 0,
      input.attempts ?? 0,
      input.repairRounds ?? 0,
      input.wallClockMs ?? 0,
      input.costUsd ?? 0,
    ],
  );
  const row = rows[0];
  return { exhausted: row?.exhausted === true, reason: row?.reason ?? null };
}

export type CheckpointCharge = BudgetOutcome & {
  chargedModelCalls: number;
  chargedToolCalls: number;
  chargedAttempts: number;
};

/**
 * Persist a stage checkpoint and consume its model, tool and attempt delta
 * together.
 *
 * `osirus.checkpoint_stage_budget` inserts the settlement row, the checkpoint
 * and the budget update in one function, so a crash rolls all of them back.
 * The attempt id is the idempotency key: replaying a commit charges nothing,
 * including the run-budget attempt.
 */
export async function checkpointStageBudget(input: {
  runId: string;
  stageId?: string | null;
  attemptId: string;
  label: string;
  state: Record<string, unknown>;
  modelCalls: number;
  toolCalls: number;
  attempts?: number;
}): Promise<CheckpointCharge> {
  const rows = await querySystem<{
    version: number;
    exhausted: boolean;
    reason: string | null;
    charged_model_calls: number;
    charged_tool_calls: number;
    charged_attempts: number;
  }>(
    `select version, exhausted, reason,
            charged_model_calls, charged_tool_calls, charged_attempts
       from osirus.checkpoint_stage_budget(
         $1::uuid, $2::uuid, $3::uuid, $4, $5::jsonb, $6, $7, $8
       )`,
    [
      input.runId,
      input.stageId ?? null,
      input.attemptId,
      input.label,
      JSON.stringify(input.state),
      input.modelCalls,
      input.toolCalls,
      input.attempts ?? 0,
    ],
  );
  const row = rows[0];
  if (!row) throw new Error("checkpoint_insert_failed");
  return {
    exhausted: row.exhausted === true,
    reason: row.reason ?? null,
    chargedModelCalls: Number(row.charged_model_calls ?? 0),
    chargedToolCalls: Number(row.charged_tool_calls ?? 0),
    chargedAttempts: Number(row.charged_attempts ?? 0),
  };
}

/** Declare a ceiling. Omitted dimensions stay unbounded. */
export async function setBudget(input: {
  runId: string;
  scope: BudgetScope;
  scopeId?: string | null;
  maxInputTokens?: number | null;
  maxOutputTokens?: number | null;
  maxModelCalls?: number | null;
  maxToolCalls?: number | null;
  maxAttempts?: number | null;
  maxRepairRounds?: number | null;
  maxWallClockMs?: number | null;
  maxCostUsd?: number | null;
}): Promise<void> {
  await querySystem(
    `insert into osirus.run_budgets (
       run_id, scope, scope_id,
       max_input_tokens, max_output_tokens, max_model_calls, max_tool_calls,
       max_attempts, max_repair_rounds, max_wall_clock_ms, max_cost_usd
     )
     values ($1::uuid, $2, $3::uuid, $4, $5, $6, $7, $8, $9, $10, $11)
     on conflict (run_id, scope, scope_id) do update
       set max_input_tokens = excluded.max_input_tokens,
           max_output_tokens = excluded.max_output_tokens,
           max_model_calls = excluded.max_model_calls,
           max_tool_calls = excluded.max_tool_calls,
           max_attempts = excluded.max_attempts,
           max_repair_rounds = excluded.max_repair_rounds,
           max_wall_clock_ms = excluded.max_wall_clock_ms,
           max_cost_usd = excluded.max_cost_usd`,
    [
      input.runId,
      input.scope,
      input.scopeId ?? null,
      input.maxInputTokens ?? null,
      input.maxOutputTokens ?? null,
      input.maxModelCalls ?? null,
      input.maxToolCalls ?? null,
      input.maxAttempts ?? null,
      input.maxRepairRounds ?? null,
      input.maxWallClockMs ?? null,
      input.maxCostUsd ?? null,
    ],
  );
}

/** Record the worker's resume cursor so the next slice can pick it up. */
export async function saveHandoff(input: {
  attemptId: string;
  leaseToken: string;
  handoff: Record<string, unknown>;
}): Promise<boolean> {
  const rows = await querySystem<{ id: string }>(
    `update osirus.run_attempts
        set handoff = $3::jsonb
      where id = $1::uuid
        and lease_token = $2::uuid
        and status in ('claimed', 'running')
      returning id`,
    [input.attemptId, input.leaseToken, JSON.stringify(input.handoff)],
  );
  return rows.length === 1;
}

/**
 * Persist a graph as stages plus dependency edges, in one statement.
 *
 * Stages and edges must land together. Inserting stages first and edges second
 * would leave a window where every stage looks runnable, and claim_next_stage
 * would happily start the last stage of the graph before the first. The CTE
 * makes that window impossible.
 */
export async function persistGraph(input: {
  runId: string;
  graph: { nodes: WorkflowNodeInput[] };
}): Promise<Map<string, string>> {
  const payload = input.graph.nodes.map((node, ordinal) => ({
    key: node.key,
    name: node.name,
    capability: node.capability,
    ordinal,
    retry_policy: node.retryPolicy,
    failure_policy: node.failurePolicy,
    requires_verification: node.requiresVerification,
    worker_kind: node.workerKind,
    input: node.input,
    depends_on: node.dependsOn,
  }));

  const rows = await querySystem<{ key: string; id: string }>(
    `with spec as (
       select * from jsonb_to_recordset($2::jsonb) as x(
         key text, name text, capability text, ordinal integer,
         retry_policy jsonb, failure_policy text,
         requires_verification boolean, worker_kind text,
         input jsonb, depends_on jsonb
       )
     ),
     inserted as (
       insert into osirus.run_stages (
         run_id, ordinal, name, capability, status, input,
         retry_policy, failure_policy, requires_verification, worker_kind
       )
       select $1::uuid, spec.ordinal, spec.name, spec.capability, 'pending',
              spec.input, spec.retry_policy, spec.failure_policy,
              spec.requires_verification, spec.worker_kind
         from spec
       returning id, ordinal
     ),
     keyed as (
       select spec.key, inserted.id
         from spec
         join inserted on inserted.ordinal = spec.ordinal
     ),
     edges as (
       insert into osirus.run_stage_dependencies (run_id, stage_id, depends_on_stage_id)
       select $1::uuid, child.id, parent.id
         from spec
         join keyed child on child.key = spec.key
         cross join lateral jsonb_array_elements_text(spec.depends_on) as d(parent_key)
         join keyed parent on parent.key = d.parent_key
       returning 1
     )
     select key, id from keyed`,
    [input.runId, JSON.stringify(payload)],
  );

  return new Map(rows.map((row) => [row.key, row.id]));
}

type WorkflowNodeInput = {
  key: string;
  name: string;
  capability: string;
  dependsOn: string[];
  retryPolicy: { maxAttempts: number };
  failurePolicy: string;
  requiresVerification: boolean;
  workerKind: string;
  input: Record<string, unknown>;
};
