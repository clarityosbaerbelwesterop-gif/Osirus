import "server-only";
import { randomUUID } from "node:crypto";
import type { ProductIdentity } from "../auth/bootstrap";
import { queryAs, querySystem } from "../db/client";
import { PRESETS } from "../policy/model";
import { notify } from "../product/notifications";
import { setBudget } from "../runtime/dispatch";
import { prepareRuntimeRun, planRuntimeRun } from "../runtime/executor";
import { routeCapabilities } from "../runtime/router";
import {
  describeSchedule,
  nextRunAt,
  parseSchedule,
  type Schedule,
} from "./schedule";

// Durable automations: an objective that runs on a schedule or when something
// happens, under a policy no looser than the workspace's, within a budget,
// with only the tools it was given. Runs are ordinary runs -- same arms, same
// approvals, same audit -- created as the person who made the automation.

import type { AutomationView, TriggerKind } from "./store-types";
export type { AutomationView, TriggerKind };

type Row = {
  id: string;
  organization_id: string;
  workspace_id: string;
  created_by: string;
  name: string;
  objective: string;
  trigger_kind: TriggerKind;
  schedule: Record<string, unknown>;
  trigger_filter: Record<string, unknown>;
  policy_preset: "cautious" | "balanced";
  max_cost_usd: string | number | null;
  max_tokens: number | null;
  allowed_tools: string[];
  notify_on: string[];
  enabled: boolean;
  session_id: string | null;
  next_run_at: Date | string | null;
  last_run_at: Date | string | null;
  last_run_id: string | null;
  last_status: string | null;
};

const COLUMNS = `id, organization_id, workspace_id, created_by, name, objective,
  trigger_kind, schedule, trigger_filter, policy_preset, max_cost_usd,
  max_tokens, allowed_tools, notify_on, enabled, session_id, next_run_at,
  last_run_at, last_run_id, last_status`;

const iso = (value: Date | string | null) =>
  value ? new Date(value).toISOString() : null;

function view(row: Row): AutomationView {
  const schedule =
    row.trigger_kind === "schedule" ? parseSchedule(row.schedule) : null;
  return {
    id: row.id,
    name: row.name,
    objective: row.objective,
    trigger: row.trigger_kind,
    schedule,
    scheduleLabel: schedule ? describeSchedule(schedule) : null,
    policyPreset: row.policy_preset,
    maxCostUsd: row.max_cost_usd === null ? null : Number(row.max_cost_usd),
    maxTokens: row.max_tokens,
    allowedTools: row.allowed_tools ?? [],
    notifyOn: row.notify_on ?? [],
    enabled: row.enabled,
    sessionId: row.session_id,
    nextRunAt: iso(row.next_run_at),
    lastRunAt: iso(row.last_run_at),
    lastRunId: row.last_run_id,
    lastStatus: row.last_status,
  };
}

export type AutomationInput = {
  name: string;
  objective: string;
  trigger: TriggerKind;
  schedule?: Schedule | null;
  policyPreset: "cautious" | "balanced";
  maxCostUsd?: number | null;
  maxTokens?: number | null;
  allowedTools?: string[];
  notifyOn?: string[];
};

export async function listAutomations(identity: ProductIdentity) {
  const rows = await queryAs<Row>(
    identity.userId,
    `select ${COLUMNS} from osirus.automations
      where workspace_id = $1::uuid
      order by created_at desc`,
    [identity.workspaceId],
  );
  return rows.map(view);
}

export async function createAutomation(
  identity: ProductIdentity,
  input: AutomationInput,
) {
  const schedule =
    input.trigger === "schedule" ? parseSchedule(input.schedule) : null;
  const rows = await queryAs<Row>(
    identity.userId,
    `insert into osirus.automations
       (organization_id, workspace_id, created_by, name, objective,
        trigger_kind, schedule, policy_preset, max_cost_usd, max_tokens,
        allowed_tools, notify_on, next_run_at)
     values ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7::jsonb, $8, $9, $10,
             $11::text[], $12::text[], $13::timestamptz)
     returning ${COLUMNS}`,
    [
      identity.organizationId,
      identity.workspaceId,
      identity.userId,
      input.name.trim(),
      input.objective.trim(),
      input.trigger,
      JSON.stringify(schedule ?? {}),
      input.policyPreset,
      input.maxCostUsd ?? null,
      input.maxTokens ?? null,
      input.allowedTools ?? [],
      input.notifyOn ?? ["failed", "approval"],
      schedule ? nextRunAt(schedule, new Date()).toISOString() : null,
    ],
  );
  return view(rows[0]!);
}

export async function setAutomationEnabled(
  identity: ProductIdentity,
  id: string,
  enabled: boolean,
) {
  const rows = await queryAs<Row>(
    identity.userId,
    `update osirus.automations
        set enabled = $3, updated_at = now(),
            next_run_at = case
              when $3 and trigger_kind = 'schedule' then $4::timestamptz
              else next_run_at end
      where id = $1::uuid and workspace_id = $2::uuid
      returning ${COLUMNS}`,
    [id, identity.workspaceId, enabled, null],
  );
  const row = rows[0];
  if (!row) return null;
  if (enabled && row.trigger_kind === "schedule") {
    const next = nextRunAt(parseSchedule(row.schedule), new Date());
    await queryAs(
      identity.userId,
      "update osirus.automations set next_run_at = $2::timestamptz where id = $1::uuid",
      [id, next.toISOString()],
    );
    row.next_run_at = next.toISOString();
  }
  return view(row);
}

export async function deleteAutomation(identity: ProductIdentity, id: string) {
  const rows = await queryAs<{ id: string }>(
    identity.userId,
    `delete from osirus.automations
      where id = $1::uuid and workspace_id = $2::uuid returning id`,
    [id, identity.workspaceId],
  );
  return rows.length > 0;
}

async function loadRow(actorId: string, id: string) {
  const rows = await queryAs<Row>(
    actorId,
    `select ${COLUMNS} from osirus.automations where id = $1::uuid`,
    [id],
  );
  return rows[0] ?? null;
}

/**
 * Start one run of an automation, as its creator. Idempotent per slot: the
 * request id names the automation and the slot, so a tick that runs twice
 * does not start the same scheduled run twice.
 */
export async function startAutomationRun(
  row: Row,
  input: { slot: string; reason: string },
) {
  const identity = {
    userId: row.created_by,
    organizationId: row.organization_id,
    workspaceId: row.workspace_id,
  };
  const prepared = await prepareRuntimeRun({
    identity,
    objective: row.objective,
    requestId: `automation:${row.id}:${input.slot}`.slice(0, 120),
    capabilities: routeCapabilities(row.objective),
    sessionId: row.session_id,
  });
  if (prepared.created) {
    await queryAs(
      identity.userId,
      `update osirus.runs
          set automation_id = $2::uuid,
              policy_snapshot = $3::jsonb
        where id = $1::uuid`,
      [
        prepared.runId,
        row.id,
        JSON.stringify({
          source: "automation",
          reason: input.reason,
          decisions: PRESETS[row.policy_preset] ?? PRESETS.cautious,
          allowedTools: row.allowed_tools ?? [],
        }),
      ],
    );
    await planRuntimeRun({
      identity,
      runId: prepared.runId,
      objective: row.objective,
    });
    if (row.max_cost_usd !== null || row.max_tokens !== null)
      await setBudget({
        runId: prepared.runId,
        scope: "run",
        maxCostUsd: row.max_cost_usd === null ? null : Number(row.max_cost_usd),
        maxInputTokens: row.max_tokens,
        maxOutputTokens: row.max_tokens,
        maxWallClockMs: 30 * 60 * 1000,
      });
  }
  const schedule =
    row.trigger_kind === "schedule" ? parseSchedule(row.schedule) : null;
  await queryAs(
    identity.userId,
    `update osirus.automations
        set last_run_at = now(), last_run_id = $2::uuid, last_status = 'running',
            session_id = $3::uuid, updated_at = now(),
            next_run_at = coalesce($4::timestamptz, next_run_at)
      where id = $1::uuid`,
    [
      row.id,
      prepared.runId,
      prepared.sessionId,
      schedule ? nextRunAt(schedule, new Date()).toISOString() : null,
    ],
  );
  return { runId: prepared.runId, sessionId: prepared.sessionId, identity };
}

export async function runAutomationNow(identity: ProductIdentity, id: string) {
  const row = await loadRow(identity.userId, id);
  if (!row || row.workspace_id !== identity.workspaceId) return null;
  return startAutomationRun(row, {
    slot: `manual:${randomUUID()}`,
    reason: "Started by hand",
  });
}

/** Scheduled automations whose window has come, across workspaces. */
export async function dueAutomations(limit = 5) {
  return querySystem<Row>(
    `select ${COLUMNS} from osirus.automations
      where enabled and trigger_kind = 'schedule'
        and next_run_at is not null and next_run_at <= now()
      order by next_run_at
      limit $1`,
    [limit],
  );
}

/** Start every due scheduled automation. Used by the scheduler tick. */
export async function startDueAutomations(limit = 5) {
  const started: string[] = [];
  for (const row of await dueAutomations(limit)) {
    const slot = row.next_run_at
      ? new Date(row.next_run_at).toISOString().slice(0, 13)
      : "now";
    try {
      const run = await startAutomationRun(row, {
        slot,
        reason: "Scheduled",
      });
      started.push(run.runId);
    } catch {
      // One broken automation must not stop the others; it stays due and is
      // retried at the next window.
    }
  }
  return started;
}

/**
 * Event triggers: start the workspace's automations for an event. Runs that
 * automations started never trigger other automations (no loops).
 */
export async function triggerAutomations(
  identity: Pick<ProductIdentity, "userId" | "workspaceId">,
  event: {
    kind: "run_completed" | "connector_changed";
    sourceRunId?: string;
    detail?: string;
  },
) {
  const rows = await queryAs<Row>(
    identity.userId,
    `select ${COLUMNS} from osirus.automations
      where workspace_id = $1::uuid and enabled and trigger_kind = $2`,
    [identity.workspaceId, event.kind],
  ).catch(() => []);
  for (const row of rows) {
    await startAutomationRun(row, {
      slot: `${event.kind}:${event.sourceRunId ?? randomUUID()}`,
      reason:
        event.kind === "run_completed"
          ? "A run finished"
          : `A connection changed${event.detail ? `: ${event.detail}` : ""}`,
    }).catch(() => undefined);
  }
}

/**
 * After a run settles: record the automation's result, notify per its
 * policy, and fire run-completed automations for runs people started.
 */
export async function onRunSettled(
  identity: { userId: string; organizationId: string; workspaceId: string },
  run: {
    id: string;
    status: string;
    automationId: string | null;
    objective: string;
  },
) {
  if (run.automationId) {
    const rows = await queryAs<{ name: string; notify_on: string[] }>(
      identity.userId,
      `update osirus.automations set last_status = $2, updated_at = now()
        where id = $1::uuid and last_run_id = $3::uuid
        returning name, notify_on`,
      [run.automationId, run.status, run.id],
    ).catch(() => []);
    const automation = rows[0];
    if (automation) {
      const wants = automation.notify_on ?? [];
      if (run.status === "completed" && wants.includes("completed"))
        await notify(identity, {
          kind: "automation_completed",
          title: `${automation.name} finished`,
          body: "The automation completed. Open it to see the result.",
          dedupeKey: `automation:${run.id}:completed`,
          runId: run.id,
          automationId: run.automationId,
        });
      if (run.status === "failed" && wants.includes("failed"))
        await notify(identity, {
          kind: "automation_failed",
          title: `${automation.name} failed`,
          body: "The automation did not finish. Open it to see where it stopped.",
          dedupeKey: `automation:${run.id}:failed`,
          runId: run.id,
          automationId: run.automationId,
        });
    }
    return;
  }
  if (run.status === "completed")
    await triggerAutomations(identity, {
      kind: "run_completed",
      sourceRunId: run.id,
    });
}

/** A run stopped for a reason the person has to resolve (budget). */
export async function notifyRunBlocked(
  identity: { userId: string; organizationId: string; workspaceId: string },
  run: { id: string; reason: string; objective: string },
) {
  await notify(identity, {
    kind: "run_blocked",
    title: "A run stopped and needs you",
    body: `${run.objective.slice(0, 120)}: ${run.reason}`,
    dedupeKey: `blocked:${run.id}`,
    runId: run.id,
  });
}
