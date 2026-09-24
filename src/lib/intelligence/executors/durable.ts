import type { ArmId } from "../../arms/types";
import { queryAs, querySystem } from "../../db/client";
import { saveWorkspacePolicy } from "../../policy/store";
import { planRuntimeRun, prepareRuntimeRun } from "../../runtime/executor";
import { capabilitiesFor } from "../../runtime/router-v2";
import type { EvalTask, Trial, TrialResult } from "../types";
import { trialResultFrom } from "./judge";
import {
  trialPolicy,
  trialStageInput,
  type ExecuteInput,
  type ExecuteOutcome,
  type TrialExecutor,
} from "./executor";

// Trials as ordinary durable runs, in production.
//
// A trial becomes a run in the Foundry workspace: the same runtime, stages,
// leases, checkpoints and sandbox as a customer's run, driven by the same
// scheduler tick. It runs below product priority, so a customer's stage is
// always claimed first. The workspace belongs to the first platform
// operator, sits in its own organization (never the operator's personal
// workspace, which stays their default), and its policy denies everything
// outside the sandbox: a trial can edit and run code in isolation and do
// nothing else. The result is collected from what the run recorded; the
// label comes from the hidden tests or the computed answer, never from the
// agent's own verdict.

export type FoundryTenant = {
  userId: string;
  organizationId: string;
  workspaceId: string;
};

const COMPOSITION: Record<EvalTask["spec"]["kind"], ArmId[]> = {
  coding: ["coding"],
  math: ["math_science"],
  research: ["research"],
  general: ["thinking"],
};

/** A run still going after this long (a day of provider quota and more) is judged as timed out. */
const STALE_MS = 30 * 60 * 60 * 1000;

let cached: FoundryTenant | null = null;

/** The Foundry workspace; created on first use, idempotent. */
export async function foundryTenant(): Promise<FoundryTenant | null> {
  if (cached) return cached;
  const [operator] = await querySystem<{ user_id: string }>(
    `select user_id from osirus_intel.operators order by created_at limit 1`,
  );
  if (!operator) return null;
  const userId = operator.user_id;
  const slug = `foundry-${userId.replaceAll("-", "").slice(0, 16)}`;

  const [organization] = await querySystem<{ id: string }>(
    `with inserted as (
       insert into osirus.organizations (name, slug, created_by)
       values ('Osirus Foundry', $1, $2::uuid)
       on conflict (slug) do nothing
       returning id)
     select id from inserted
     union all
     select id from osirus.organizations
      where slug = $1 and created_by = $2::uuid
     limit 1`,
    [slug, userId],
  );
  if (!organization) throw new Error("foundry_organization_unavailable");
  await querySystem(
    `insert into osirus.organization_memberships
       (organization_id, user_id, role)
     values ($1::uuid, $2::uuid, 'owner')
     on conflict (organization_id, user_id) do nothing`,
    [organization.id, userId],
  );
  const [workspace] = await querySystem<{ id: string }>(
    `with inserted as (
       insert into osirus.workspaces (organization_id, name, slug, created_by)
       values ($1::uuid, 'Foundry', 'foundry', $2::uuid)
       on conflict (organization_id, slug) do nothing
       returning id)
     select id from inserted
     union all
     select id from osirus.workspaces
      where organization_id = $1::uuid and slug = 'foundry'
     limit 1`,
    [organization.id, userId],
  );
  if (!workspace) throw new Error("foundry_workspace_unavailable");
  await querySystem(
    `insert into osirus.workspace_memberships
       (workspace_id, organization_id, user_id, role)
     values ($1::uuid, $2::uuid, $3::uuid, 'owner')
     on conflict (workspace_id, user_id) do nothing`,
    [workspace.id, organization.id, userId],
  );
  // Sandbox work only. Deny is stricter than every floor, so this can only
  // narrow what a trial may do.
  await saveWorkspacePolicy(
    {
      userId,
      organizationId: organization.id,
      workspaceId: workspace.id,
      workspaceName: "Foundry",
    },
    {
      preset: "custom",
      decisions: {
        read: "allow",
        workspace_write: "allow",
        external_write: "deny",
        git_push: "deny",
        pr_create: "deny",
        deploy_preview: "deny",
        deploy_production: "deny",
        db_change: "deny",
        destructive: "deny",
        financial: "deny",
        mcp_action: "deny",
      },
    },
  );
  cached = {
    userId,
    organizationId: organization.id,
    workspaceId: workspace.id,
  };
  return cached;
}

export function clearFoundryTenantCache() {
  cached = null;
}

type RunRow = {
  status: string;
  error_code: string | null;
  created_at: string;
  completed_at: string | null;
};

const TERMINAL = new Set(["completed", "failed", "cancelled"]);

export class DurableTrialExecutor implements TrialExecutor {
  readonly kind = "durable" as const;

  async execute(input: ExecuteInput): Promise<ExecuteOutcome> {
    const tenant = await foundryTenant();
    if (!tenant) throw new Error("foundry_operator_not_configured");
    const identity = tenant;
    const { task, trial } = input;
    const composition = task.spec.composition?.length
      ? task.spec.composition
      : COMPOSITION[task.spec.kind];
    const prepared = await prepareRuntimeRun({
      identity,
      objective: task.spec.objective,
      requestId: `foundry:${trial.id}:${trial.attempts + 1}`,
      capabilities: capabilitiesFor(composition),
    });
    const [run] = await queryAs<{ status: string }>(
      identity.userId,
      `update osirus.runs set priority = -1
        where id = $1::uuid
        returning status`,
      [prepared.runId],
    );
    if (run?.status === "created")
      await planRuntimeRun({
        identity,
        runId: prepared.runId,
        objective: task.spec.objective,
        policy: trialPolicy(input.version, input.model),
        composition,
        stageInput: trialStageInput(task),
        signal: input.signal,
      });
    return { status: "running", runId: prepared.runId };
  }

  async collect(trial: Trial, task: EvalTask): Promise<TrialResult | null> {
    if (!trial.runId) return null;
    const tenant = await foundryTenant();
    if (!tenant) return null;
    const as = <T>(text: string, params: unknown[]) =>
      queryAs<T>(tenant.userId, text, params);
    const [run] = await as<RunRow>(
      `select status, error_code, created_at, completed_at
         from osirus.runs where id = $1::uuid`,
      [trial.runId],
    );
    if (!run) return null;
    const age = Date.now() - new Date(run.created_at).getTime();
    const waiting = run.status === "waiting_for_approval";
    if (!TERMINAL.has(run.status) && !waiting && age < STALE_MS) return null;

    const [stages, messages, calls, tools, checkpoint] = await Promise.all([
      as<{
        name: string;
        status: string;
        output: Record<string, unknown> | null;
        verifier_status: string | null;
      }>(
        `select name, status, output, verifier_status
           from osirus.run_stages where run_id = $1::uuid order by ordinal`,
        [trial.runId],
      ),
      as<{ content: string }>(
        `select content from osirus.messages
          where run_id = $1::uuid and role = 'assistant'
          order by created_at desc limit 1`,
        [trial.runId],
      ),
      as<{
        calls: string;
        tokens: string | null;
        cost: string | null;
        errors: string[] | null;
      }>(
        `select count(*) as calls,
                sum(coalesce(input_tokens, 0) + coalesce(output_tokens, 0)) as tokens,
                sum(coalesce(estimated_cost_usd, 0)) as cost,
                array_agg(distinct error_code)
                  filter (where error_code is not null) as errors
           from osirus.model_calls where run_id = $1::uuid`,
        [trial.runId],
      ),
      as<{ calls: string }>(
        `select count(*) as calls from osirus.tool_calls
          where run_id = $1::uuid`,
        [trial.runId],
      ),
      as<{ state: Record<string, unknown> }>(
        `select state from osirus.checkpoints
          where run_id = $1::uuid order by created_at desc limit 1`,
        [trial.runId],
      ),
    ]);

    const hiddenCheck =
      stages
        .map(
          (stage) =>
            stage.output?.hiddenCheck as
              { exitCode: number | null; output: string } | undefined,
        )
        .find(Boolean) ?? null;
    const notes: string[] = [];
    if (run.error_code) notes.push(`run failed: ${run.error_code}`);
    for (const stage of stages.filter((entry) => entry.status === "failed"))
      notes.push(`${stage.name} failed: ${run.error_code ?? "stage_failed"}`);
    // Provider errors are named so the loop can tell an outage (retried,
    // never counted against a strategy) from the strategy's own failure.
    for (const code of calls[0]?.errors ?? [])
      notes.push(`model call failed: ${code}`);
    if (!TERMINAL.has(run.status)) {
      notes.push(
        waiting ? "run failed: approval_required" : "run failed: timeout",
      );
      // Nothing will resolve it: stop the run rather than leave it open.
      await as(
        `update osirus.runs set cancel_requested = true where id = $1::uuid`,
        [trial.runId],
      ).catch(() => undefined);
    }
    const state = checkpoint[0]?.state ?? {};
    const steps =
      (state.agentSteps as
        | Array<{ action: string; outcome: string; toolId?: string }>
        | undefined) ?? [];
    const answer = messages[0]?.content ?? String(state.answer ?? "");
    const completed = run.status === "completed";
    const endedAt = run.completed_at
      ? new Date(run.completed_at).getTime()
      : Date.now();

    const result = trialResultFrom({
      verify: task.spec.verify,
      run: {
        status: completed ? "completed" : "failed",
        answer,
        verdicts: stages
          .map((stage) => stage.verifier_status)
          .filter((status): status is string => Boolean(status)),
        hiddenCheck,
        notes,
      },
      costUsd: Number(calls[0]?.cost ?? 0),
      tokens: Number(calls[0]?.tokens ?? 0),
      latencyMs: endedAt - new Date(run.created_at).getTime(),
      modelCalls: Number(calls[0]?.calls ?? 0),
      toolCalls: Number(tools[0]?.calls ?? 0),
      repairs: steps.filter((step) => step.action === "REPLAN").length,
    });
    return {
      ...result,
      trajectory: {
        stages: stages.map((stage) => stage.name),
        actions: steps.slice(0, 60).map((step) => ({
          action: step.action,
          ...(step.toolId ? { toolId: step.toolId } : {}),
          outcome: step.outcome,
        })),
        output: (task.spec.kind === "coding"
          ? String(state.workspaceDiff ?? "")
          : answer
        ).slice(0, 6_000),
      },
    };
  }
}
