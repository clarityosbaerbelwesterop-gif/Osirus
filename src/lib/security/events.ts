import "server-only";
import { queryAs } from "../db/client";

// Security events: what a guard stopped or changed, recorded so a person can
// see it. Written by the acting user (row-level security checks that the
// actor belongs to the workspace), never updated, and never allowed to break
// the action that produced them -- a failed write is dropped, not thrown.

export type SecurityEventKind =
  | "prompt_injection_neutralized"
  | "unsafe_path_blocked"
  | "access_refused"
  | "secret_redacted"
  | "tool_denied"
  | "approval_expired"
  | "outbound_blocked"
  | "policy_denied";

export type SecurityEventInput = {
  kind: SecurityEventKind;
  severity: "info" | "warning" | "critical";
  summary: string;
  runId?: string | null;
  detail?: Record<string, string | number | boolean | null>;
};

type Actor = { userId: string; organizationId: string; workspaceId: string };

export async function recordSecurityEvent(
  actor: Actor,
  event: SecurityEventInput,
) {
  await queryAs(
    actor.userId,
    `insert into osirus.security_events
       (organization_id, workspace_id, run_id, kind, severity, summary, detail, actor_id)
     values ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7::jsonb, $8::uuid)`,
    [
      actor.organizationId,
      actor.workspaceId,
      event.runId ?? null,
      event.kind,
      event.severity,
      event.summary.slice(0, 500),
      JSON.stringify(event.detail ?? {}),
      actor.userId,
    ],
  ).catch(() => undefined);
}
