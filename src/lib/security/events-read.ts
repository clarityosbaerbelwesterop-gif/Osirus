import "server-only";
import type { ProductIdentity } from "../auth/bootstrap";
import { queryAs } from "../db/client";
import type { SecurityEventKind } from "./events";

export type SecurityEventView = {
  id: string;
  kind: SecurityEventKind;
  severity: "info" | "warning" | "critical";
  summary: string;
  runId: string | null;
  createdAt: string;
};

export async function listSecurityEvents(
  identity: ProductIdentity,
  input: { limit?: number; before?: string | null; kind?: string | null } = {},
): Promise<SecurityEventView[]> {
  const rows = await queryAs<{
    id: string;
    kind: SecurityEventKind;
    severity: SecurityEventView["severity"];
    summary: string;
    run_id: string | null;
    created_at: Date | string;
  }>(
    identity.userId,
    `select id, kind, severity, summary, run_id, created_at
       from osirus.security_events
      where workspace_id = $1::uuid
        and ($2::timestamptz is null or created_at < $2::timestamptz)
        and ($3::text is null or kind = $3)
      order by created_at desc
      limit $4`,
    [
      identity.workspaceId,
      input.before ?? null,
      input.kind ?? null,
      Math.min(Math.max(input.limit ?? 50, 1), 200),
    ],
  ).catch(() => []);
  return rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    severity: row.severity,
    summary: row.summary,
    runId: row.run_id,
    createdAt: new Date(row.created_at).toISOString(),
  }));
}
