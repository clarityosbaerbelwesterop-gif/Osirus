import "server-only";
import type { ArmId } from "../arms/types";
import { queryAs } from "../db/client";
import type { RuntimeRepository } from "../runtime/repository";
import { decide, type ActionClass, type Decision } from "../policy/model";
import { combine, loadWorkspacePolicy, runRestrictions } from "../policy/store";
import { notify } from "../product/notifications";
import { recordSecurityEvent } from "../security/events";
import { toolLabel } from "../ui/labels";
import {
  ToolRegistry,
  type ApprovalGate,
  type ToolAudit,
  type ToolContext,
  type ToolPolicy,
} from "./registry";

const DENIAL_REASON: Record<string, string> = {
  policy_denied: "the workspace policy does not allow it",
  arm_not_permitted: "this kind of task may not use it",
  approval_rejected: "the approval was rejected",
};

// Wiring the registry to the database.
//
// The audit writes one osirus.tool_calls row per attempted call -- including
// the ones that were denied, because a permission model is only worth having
// if refusals are visible afterwards.
//
// The approval gate is stateful across slices, which is what makes it work at
// all: the first call creates a pending approval and the stage parks in
// waiting; a later claim finds the approval decided and the same call goes
// through. An undecided approval is never treated as consent.

export function databaseAudit(
  repository: RuntimeRepository,
  actorId: string,
): ToolAudit {
  return async (entry) => {
    await queryAs(
      actorId,
      `insert into osirus.tool_calls
         (organization_id, workspace_id, run_id, stage_id, tool_name,
          operation, risk, status, input_metadata, output_metadata,
          latency_ms, error_code, completed_at)
       values ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $6, $7, $8,
               $9::jsonb, $10::jsonb, $11, $12, now())`,
      [
        entry.context.organizationId,
        entry.context.workspaceId,
        entry.context.runId,
        entry.context.stageId,
        entry.tool.id,
        entry.tool.effect,
        entry.tool.risk,
        entry.status,
        JSON.stringify({
          ...entry.inputMetadata,
          armId: entry.context.armId,
          trust: entry.tool.trust,
        }),
        JSON.stringify(entry.outputMetadata),
        entry.latencyMs,
        entry.errorCode ?? null,
      ],
    ).catch(() => undefined);
    void repository;
    if (entry.outputMetadata.injection === true)
      await recordSecurityEvent(
        {
          userId: actorId,
          organizationId: entry.context.organizationId,
          workspaceId: entry.context.workspaceId,
        },
        {
          kind: "prompt_injection_neutralized",
          severity: "warning",
          summary: `The result of ${toolLabel(entry.tool.id, entry.tool.title)} contained instructions aimed at the agent. It was treated as untrusted data and not followed.`,
          runId: entry.context.runId,
          detail: { tool: entry.tool.id },
        },
      );
    if (entry.outputMetadata.redacted === true)
      await recordSecurityEvent(
        {
          userId: actorId,
          organizationId: entry.context.organizationId,
          workspaceId: entry.context.workspaceId,
        },
        {
          kind: "secret_redacted",
          severity: "info",
          summary: `A credential in the output of ${toolLabel(entry.tool.id, entry.tool.title)} was replaced with [REDACTED] before the agent or anyone else saw it.`,
          runId: entry.context.runId,
          detail: { tool: entry.tool.id },
        },
      );
    if (
      entry.errorCode === "unsafe_path" ||
      entry.errorCode === "outbound_blocked"
    )
      await recordSecurityEvent(
        {
          userId: actorId,
          organizationId: entry.context.organizationId,
          workspaceId: entry.context.workspaceId,
        },
        entry.errorCode === "unsafe_path"
          ? {
              kind: "unsafe_path_blocked",
              severity: "warning",
              summary: `${toolLabel(entry.tool.id, entry.tool.title)} tried a path outside the repository. It was refused.`,
              runId: entry.context.runId,
              detail: { tool: entry.tool.id },
            }
          : {
              kind: "outbound_blocked",
              severity: "warning",
              summary: `${toolLabel(entry.tool.id, entry.tool.title)} tried to reach a private or disallowed address. It was refused.`,
              runId: entry.context.runId,
              detail: { tool: entry.tool.id },
            },
      );
    const reason = entry.errorCode ? DENIAL_REASON[entry.errorCode] : null;
    if (reason)
      await recordSecurityEvent(
        {
          userId: actorId,
          organizationId: entry.context.organizationId,
          workspaceId: entry.context.workspaceId,
        },
        {
          kind:
            entry.errorCode === "policy_denied"
              ? "policy_denied"
              : "tool_denied",
          severity: "info",
          summary: `${toolLabel(entry.tool.id, entry.tool.title)} was not run: ${reason}.`,
          runId: entry.context.runId,
          detail: { tool: entry.tool.id, reason: entry.errorCode ?? "" },
        },
      );
  };
}

/**
 * The workspace policy, plus any restriction recorded on the run (an
 * automation's policy and allowed tools). Read once per registry, i.e. once
 * per stage slice, so a tightened policy applies from the next slice on.
 */
export function databasePolicy(actorId: string): ToolPolicy {
  const cache = new Map<
    string,
    Promise<{
      decisions: Record<ActionClass, Decision>;
      allowedTools: string[] | null;
    }>
  >();
  const load = (context: ToolContext) => {
    const key = `${context.workspaceId}:${context.runId}`;
    let entry = cache.get(key);
    if (!entry) {
      entry = Promise.all([
        loadWorkspacePolicy({
          userId: actorId,
          workspaceId: context.workspaceId,
        }),
        runRestrictions(actorId, context.runId),
      ]).then(([workspace, run]) => ({
        decisions: combine(workspace.decisions, run),
        allowedTools: run.allowedTools,
      }));
      cache.set(key, entry);
    }
    return entry;
  };
  return async ({ tool, context, builtinRequiresApproval }) => {
    const policy = await load(context);
    if (
      policy.allowedTools &&
      !policy.allowedTools.includes(tool.id) &&
      tool.effect !== "read"
    )
      return "deny";
    return decide(policy.decisions, tool, builtinRequiresApproval);
  };
}

/**
 * Find or create the approval for one specific call.
 *
 * Matching on the tool id and the exact input is what stops an approval for a
 * harmless call being reused for a different one: change any argument and the
 * lookup misses, so a fresh approval is requested.
 */
export function databaseApprovalGate(input: {
  repository: RuntimeRepository;
  actorId: string;
}): ApprovalGate {
  return async ({ tool, context, request }) => {
    // An approval covers one tool, one input and -- for tools someone else
    // defines (MCP) -- one version of that tool's definition. Tools without
    // a definition fingerprint keep the fingerprint they always had.
    const fingerprint = JSON.stringify({
      toolId: tool.id,
      input: request.input ?? null,
      ...(request.definition ? { definition: request.definition } : {}),
    });

    const existing = await queryAs<{ status: string }>(
      input.actorId,
      `select status
         from osirus.approvals
        where run_id = $1::uuid
          and action = $2
          and request ->> 'fingerprint' = $3
          and (expires_at is null or expires_at > now())
        order by created_at desc
        limit 1`,
      [context.runId, `tool:${tool.id}`, fingerprint],
    );

    const status = existing[0]?.status;
    if (status === "approved") return "approved";
    if (status === "rejected") return "rejected";
    // 'requested' is the undecided state approvals_status_check allows. Without
    // this, every re-check of an undecided call filed a duplicate request.
    if (status === "requested" || status === "pending") return "pending";

    // A request that expired undecided is closed as expired and recorded, so
    // it cannot be approved late; a fresh request is filed below.
    const expired = await queryAs<{ id: string }>(
      input.actorId,
      `update osirus.approvals set status = 'expired'
        where run_id = $1::uuid and action = $2
          and request ->> 'fingerprint' = $3
          and status = 'requested'
          and expires_at is not null and expires_at <= now()
        returning id`,
      [context.runId, `tool:${tool.id}`, fingerprint],
    ).catch(() => []);
    for (const row of expired)
      await recordSecurityEvent(
        {
          userId: input.actorId,
          organizationId: context.organizationId,
          workspaceId: context.workspaceId,
        },
        {
          kind: "approval_expired",
          severity: "info",
          summary: `An approval for ${toolLabel(tool.id, tool.title)} expired before anyone decided. A new one was requested.`,
          runId: context.runId,
          detail: { approval: row.id },
        },
      );

    const approvalId = await input.repository
      .createApproval({
        organizationId: context.organizationId,
        workspaceId: context.workspaceId,
        runId: context.runId,
        stageId: context.stageId,
        action: `tool:${tool.id}`,
        risk: tool.risk,
        request: {
          fingerprint,
          toolId: tool.id,
          title: tool.title,
          effect: tool.effect,
          summary: tool.summary,
          ...(request.definition ? { definition: request.definition } : {}),
        },
        expiresInSeconds: 60 * 60,
      })
      .catch(() => undefined);
    if (approvalId)
      await notify(
        {
          userId: input.actorId,
          organizationId: context.organizationId,
          workspaceId: context.workspaceId,
        },
        {
          kind: "approval_needed",
          title: `Approval needed: ${toolLabel(tool.id, tool.title)}`,
          body: tool.summary,
          dedupeKey: `approval:${approvalId}`,
          runId: context.runId,
          approvalId,
        },
      );
    return "pending";
  };
}

export function registryFor(input: {
  repository: RuntimeRepository;
  actorId: string;
}) {
  return new ToolRegistry({
    audit: databaseAudit(input.repository, input.actorId),
    approvalGate: databaseApprovalGate(input),
    policy: databasePolicy(input.actorId),
  });
}

export type { ToolContext, ArmId };
