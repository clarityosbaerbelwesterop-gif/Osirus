import "server-only";
import type { ProductIdentity } from "../auth/bootstrap";
import { queryAs } from "../db/client";
import {
  ACTION_CLASSES,
  intersect,
  resolvePolicy,
  type ActionClass,
  type Decision,
  type WorkspacePolicy,
} from "./model";

// Workspace policies in the database, and the per-run restrictions an
// automation adds (runs.policy_snapshot). A workspace without a row gets the
// balanced default; an unreadable table does too, never something looser.

export async function loadWorkspacePolicy(
  identity: Pick<ProductIdentity, "userId" | "workspaceId">,
): Promise<WorkspacePolicy> {
  const rows = await queryAs<{
    preset: string;
    decisions: Record<string, unknown>;
  }>(
    identity.userId,
    `select preset, decisions from osirus.workspace_policies
      where workspace_id = $1::uuid`,
    [identity.workspaceId],
  ).catch(() => []);
  const row = rows[0];
  return resolvePolicy(row?.preset ?? "balanced", row?.decisions ?? {});
}

export async function saveWorkspacePolicy(
  identity: ProductIdentity,
  input: { preset: string; decisions?: Partial<Record<ActionClass, Decision>> },
) {
  const policy = resolvePolicy(input.preset, input.decisions ?? {});
  await queryAs(
    identity.userId,
    `insert into osirus.workspace_policies
       (workspace_id, organization_id, preset, decisions, updated_by, updated_at)
     values ($1::uuid, $2::uuid, $3, $4::jsonb, $5::uuid, now())
     on conflict (workspace_id) do update set
       preset = excluded.preset,
       decisions = excluded.decisions,
       updated_by = excluded.updated_by,
       updated_at = now()`,
    [
      identity.workspaceId,
      identity.organizationId,
      policy.preset,
      JSON.stringify(policy.preset === "custom" ? policy.decisions : {}),
      identity.userId,
    ],
  );
  return policy;
}

export type RunRestrictions = {
  decisions: Record<ActionClass, Decision> | null;
  allowedTools: string[] | null;
};

/** Restrictions recorded on a run when it was created (automations). */
export async function runRestrictions(
  actorId: string,
  runId: string,
): Promise<RunRestrictions> {
  const rows = await queryAs<{
    policy_snapshot: Record<string, unknown> | null;
  }>(actorId, "select policy_snapshot from osirus.runs where id = $1::uuid", [
    runId,
  ]).catch(() => []);
  const snapshot = rows[0]?.policy_snapshot;
  if (!snapshot) return { decisions: null, allowedTools: null };
  const raw = (snapshot.decisions ?? null) as Record<string, unknown> | null;
  const decisions = raw
    ? (Object.fromEntries(
        ACTION_CLASSES.map((cls) => [
          cls,
          raw[cls] === "allow" || raw[cls] === "ask" || raw[cls] === "deny"
            ? raw[cls]
            : "ask",
        ]),
      ) as Record<ActionClass, Decision>)
    : null;
  const tools = Array.isArray(snapshot.allowedTools)
    ? snapshot.allowedTools.filter(
        (item): item is string => typeof item === "string",
      )
    : null;
  return { decisions, allowedTools: tools && tools.length ? tools : null };
}

export function combine(
  workspace: Record<ActionClass, Decision>,
  run: RunRestrictions,
) {
  return run.decisions ? intersect(workspace, run.decisions) : workspace;
}
