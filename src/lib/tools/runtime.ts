import "server-only";
import type { ArmId } from "../arms/types";
import { queryAs } from "../db/client";
import type { RuntimeRepository } from "../runtime/repository";
import {
  ToolRegistry,
  type ApprovalGate,
  type ToolAudit,
  type ToolContext,
} from "./registry";

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
    const fingerprint = JSON.stringify({
      toolId: tool.id,
      input: request.input ?? null,
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
    if (status === "pending") return "pending";

    await input.repository
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
        },
        expiresInSeconds: 60 * 60,
      })
      .catch(() => undefined);
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
  });
}

export type { ToolContext, ArmId };
