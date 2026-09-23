import "server-only";
import type { ProductIdentity } from "../auth/bootstrap";
import { queryAs } from "../db/client";

export type ApprovalFilter = "pending" | "approved" | "rejected" | "expired";

export type ApprovalRow = Record<string, unknown> & {
  run_id: string;
  session_id: string | null;
  objective: string | null;
};

/** Approvals across the workspace, newest first. */
export async function listApprovals(
  identity: ProductIdentity,
  filter: ApprovalFilter,
  limit = 100,
): Promise<ApprovalRow[]> {
  const where = {
    pending:
      "a.status = 'requested' and (a.expires_at is null or a.expires_at > now())",
    approved: "a.status = 'approved'",
    rejected: "a.status in ('rejected', 'cancelled')",
    expired:
      "(a.status = 'expired' or (a.status = 'requested' and a.expires_at is not null and a.expires_at <= now()))",
  }[filter];
  return queryAs<ApprovalRow>(
    identity.userId,
    `select a.id, a.run_id, a.stage_id, a.action, a.risk, a.status, a.request,
            a.decided_at, a.expires_at, a.created_at,
            r.session_id, left(r.objective, 200) as objective
       from osirus.approvals a
       join osirus.runs r on r.id = a.run_id
      where a.workspace_id = $1::uuid and ${where}
      order by a.created_at desc
      limit $2`,
    [identity.workspaceId, Math.min(Math.max(limit, 1), 200)],
  ).catch(() => []);
}

export async function approvalCounts(identity: ProductIdentity) {
  const rows = await queryAs<{
    pending: number;
    approved: number;
    rejected: number;
    expired: number;
  }>(
    identity.userId,
    `select
       count(*) filter (where status = 'requested' and (expires_at is null or expires_at > now()))::int as pending,
       count(*) filter (where status = 'approved')::int as approved,
       count(*) filter (where status in ('rejected', 'cancelled'))::int as rejected,
       count(*) filter (where status = 'expired' or (status = 'requested' and expires_at is not null and expires_at <= now()))::int as expired
     from osirus.approvals
    where workspace_id = $1::uuid`,
    [identity.workspaceId],
  ).catch(() => []);
  return rows[0] ?? { pending: 0, approved: 0, rejected: 0, expired: 0 };
}

export type AuditFilters = {
  run?: string | null;
  tool?: string | null;
  connector?: "github" | "mcp" | "builtin" | null;
  risk?: "low" | "medium" | "high" | null;
  decision?: "completed" | "failed" | "cancelled" | "awaiting_approval" | null;
  from?: string | null;
  to?: string | null;
  before?: string | null;
};

export type AuditRow = {
  id: string;
  runId: string | null;
  sessionId: string | null;
  tool: string;
  effect: string;
  risk: string;
  status: string;
  errorCode: string | null;
  latencyMs: number | null;
  createdAt: string;
};

/** Tool calls, filtered; metadata only (inputs are never stored). */
export async function listToolCalls(
  identity: ProductIdentity,
  filters: AuditFilters,
  limit = 50,
): Promise<AuditRow[]> {
  const rows = await queryAs<{
    id: string;
    run_id: string | null;
    session_id: string | null;
    tool_name: string;
    operation: string;
    risk: string;
    status: string;
    error_code: string | null;
    latency_ms: number | null;
    created_at: Date | string;
  }>(
    identity.userId,
    `select t.id, t.run_id, r.session_id, t.tool_name, t.operation, t.risk,
            t.status, t.error_code, t.latency_ms, t.created_at
       from osirus.tool_calls t
       left join osirus.runs r on r.id = t.run_id
      where t.workspace_id = $1::uuid
        and ($2::uuid is null or t.run_id = $2::uuid)
        and ($3::text is null or t.tool_name ilike '%' || $3 || '%')
        and ($4::text is null
             or ($4 = 'mcp' and t.tool_name like 'mcp:%')
             or ($4 = 'github' and (t.tool_name = 'git.deliver' or t.tool_name like 'github.%'))
             or ($4 = 'builtin' and t.tool_name not like 'mcp:%' and t.tool_name <> 'git.deliver'))
        and ($5::text is null or t.risk = $5)
        and ($6::text is null or t.status = $6)
        and ($7::timestamptz is null or t.created_at >= $7::timestamptz)
        and ($8::timestamptz is null or t.created_at < $8::timestamptz + interval '1 day')
        and ($9::timestamptz is null or t.created_at < $9::timestamptz)
      order by t.created_at desc
      limit $10`,
    [
      identity.workspaceId,
      filters.run ?? null,
      filters.tool ?? null,
      filters.connector ?? null,
      filters.risk ?? null,
      filters.decision ?? null,
      filters.from ?? null,
      filters.to ?? null,
      filters.before ?? null,
      Math.min(Math.max(limit, 1), 100),
    ],
  ).catch(() => []);
  return rows.map((row) => ({
    id: row.id,
    runId: row.run_id,
    sessionId: row.session_id,
    tool: row.tool_name,
    effect: row.operation,
    risk: row.risk,
    status: row.status,
    errorCode: row.error_code,
    latencyMs: row.latency_ms,
    createdAt: new Date(row.created_at).toISOString(),
  }));
}
