import "server-only";
import type { ProductIdentity } from "../auth/bootstrap";
import { queryAs } from "../db/client";
import { MemoryOS } from "../memory/os";

// Read models for the settings sections. Each returns exactly what its
// section shows; everything runs as the signed-in person, so row-level
// security scopes it to their workspace.

const iso = (value: Date | string | null | undefined) =>
  value ? new Date(value).toISOString() : null;

export async function workspaceInfo(identity: ProductIdentity) {
  const rows = await queryAs<{
    workspace_role: string | null;
    org_role: string | null;
    created_at: Date | string | null;
    members: number;
  }>(
    identity.userId,
    `select wm.role as workspace_role, om.role as org_role, w.created_at,
            (select count(*)::int from osirus.workspace_memberships x
              where x.workspace_id = w.id) as members
       from osirus.workspaces w
       left join osirus.workspace_memberships wm
         on wm.workspace_id = w.id and wm.user_id = $2::uuid
       left join osirus.organization_memberships om
         on om.organization_id = w.organization_id and om.user_id = $2::uuid
      where w.id = $1::uuid`,
    [identity.workspaceId, identity.userId],
  ).catch(() => []);
  const row = rows[0];
  return {
    name: identity.workspaceName,
    workspaceRole: row?.workspace_role ?? null,
    organizationRole: row?.org_role ?? null,
    createdAt: iso(row?.created_at),
    members: row?.members ?? 1,
  };
}

export type UsageSummary = {
  days: number;
  runs: number;
  completedRuns: number;
  modelCalls: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  toolCalls: number;
  byRole: Array<{
    role: string;
    calls: number;
    tokens: number;
    costUsd: number;
  }>;
};

export async function usageSummary(
  identity: ProductIdentity,
  days = 30,
): Promise<UsageSummary> {
  const [totals, roles] = await Promise.all([
    queryAs<{
      runs: number;
      completed_runs: number;
      model_calls: number;
      input_tokens: number;
      output_tokens: number;
      cost: string | number | null;
      tool_calls: number;
    }>(
      identity.userId,
      `select
         (select count(*)::int from osirus.runs
           where workspace_id = $1::uuid
             and created_at > now() - make_interval(days => $2::int)) as runs,
         (select count(*)::int from osirus.runs
           where workspace_id = $1::uuid and status = 'completed'
             and created_at > now() - make_interval(days => $2::int)) as completed_runs,
         count(*)::int as model_calls,
         coalesce(sum(input_tokens), 0)::int as input_tokens,
         coalesce(sum(output_tokens), 0)::int as output_tokens,
         coalesce(sum(estimated_cost_usd), 0) as cost,
         (select count(*)::int from osirus.tool_calls
           where workspace_id = $1::uuid
             and created_at > now() - make_interval(days => $2::int)) as tool_calls
       from osirus.model_calls
      where workspace_id = $1::uuid
        and created_at > now() - make_interval(days => $2::int)`,
      [identity.workspaceId, days],
    ).catch(() => []),
    queryAs<{
      role: string;
      calls: number;
      tokens: number;
      cost: string | number | null;
    }>(
      identity.userId,
      `select logical_role as role, count(*)::int as calls,
              coalesce(sum(coalesce(input_tokens, 0) + coalesce(output_tokens, 0)), 0)::int as tokens,
              coalesce(sum(estimated_cost_usd), 0) as cost
         from osirus.model_calls
        where workspace_id = $1::uuid
          and created_at > now() - make_interval(days => $2::int)
        group by logical_role
        order by calls desc`,
      [identity.workspaceId, days],
    ).catch(() => []),
  ]);
  const row = totals[0];
  return {
    days,
    runs: row?.runs ?? 0,
    completedRuns: row?.completed_runs ?? 0,
    modelCalls: row?.model_calls ?? 0,
    inputTokens: row?.input_tokens ?? 0,
    outputTokens: row?.output_tokens ?? 0,
    costUsd: Number(row?.cost ?? 0),
    toolCalls: row?.tool_calls ?? 0,
    byRole: roles.map((entry) => ({
      role: entry.role,
      calls: entry.calls,
      tokens: entry.tokens,
      costUsd: Number(entry.cost ?? 0),
    })),
  };
}

export type MemoryItemView = {
  id: string;
  kind: string;
  content: string;
  verified: boolean;
  own: boolean;
  createdAt: string;
  contradictionStatus?: "none" | "suspected" | "resolved";
};

export type MemoryContradictionView = {
  id: string;
  kind: string;
  content: string;
  subjectKey: string | null;
  canonicalValue: string | null;
  updatedAt: string;
  rivalIds: string[];
};

export async function memoryOverview(identity: ProductIdentity) {
  const memory = new MemoryOS(identity.userId);
  const [items, counts, contradictions] = await Promise.all([
    queryAs<{
      id: string;
      kind: string;
      content: string;
      verification_status: string;
      contradiction_status: "none" | "suspected" | "resolved";
      owner_id: string;
      created_at: Date | string;
    }>(
      identity.userId,
      `select id, kind, content, verification_status, contradiction_status,
              owner_id, created_at
         from osirus.memory_items
        where workspace_id = $1::uuid
          and contradiction_status <> 'suspected'
        order by created_at desc
        limit 25`,
      [identity.workspaceId],
    ).catch(() => []),
    queryAs<{ total: number; verified: number; contradictions: number }>(
      identity.userId,
      `select count(*)::int as total,
              count(*) filter (where verification_status = 'verified')::int as verified,
              count(*) filter (where contradiction_status = 'suspected')::int as contradictions
         from osirus.memory_items
        where workspace_id = $1::uuid`,
      [identity.workspaceId],
    ).catch(() => []),
    memory.listContradictions(identity.workspaceId, 12).catch(() => []),
  ]);
  return {
    total: counts[0]?.total ?? 0,
    verified: counts[0]?.verified ?? 0,
    contradictions: counts[0]?.contradictions ?? contradictions.length,
    items: items.map((item) => ({
      id: item.id,
      kind: item.kind,
      content: item.content.slice(0, 400),
      verified: item.verification_status === "verified",
      own: item.owner_id === identity.userId,
      createdAt: new Date(item.created_at).toISOString(),
      contradictionStatus: item.contradiction_status,
    })) satisfies MemoryItemView[],
    conflictQueue: contradictions satisfies MemoryContradictionView[],
  };
}

export async function resolveMemoryConflict(
  identity: ProductIdentity,
  input: { winningMemoryId: string; rejectedMemoryIds: string[] },
) {
  const memory = new MemoryOS(identity.userId);
  await memory.resolveContradiction({
    workspaceId: identity.workspaceId,
    winningMemoryId: input.winningMemoryId,
    rejectedMemoryIds: input.rejectedMemoryIds,
  });
  return true;
}

/** Forget one memory item. Row-level security allows only its owner. */
export async function forgetMemoryItem(identity: ProductIdentity, id: string) {
  const rows = await queryAs<{ id: string }>(
    identity.userId,
    `delete from osirus.memory_items
      where id = $1::uuid and workspace_id = $2::uuid
      returning id`,
    [id, identity.workspaceId],
  );
  return rows.length > 0;
}
