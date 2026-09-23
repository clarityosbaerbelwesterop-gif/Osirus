import "server-only";
import { queryAs } from "../db/client";
import type { ProductIdentity } from "../auth/bootstrap";

/** Counts the navigation shows: what is waiting for this person. */
export async function shellCounts(identity: ProductIdentity) {
  const rows = await queryAs<{ approvals: number; notifications: number }>(
    identity.userId,
    `select
       (select count(*)::int
          from osirus.approvals
         where workspace_id = $1::uuid
           and status = 'requested'
           and (expires_at is null or expires_at > now())) as approvals,
       (select count(*)::int
          from osirus.notifications
         where user_id = $2::uuid
           and read_at is null
           and kind <> 'approval_needed') as notifications`,
    [identity.workspaceId, identity.userId],
  ).catch(() => [{ approvals: 0, notifications: 0 }]);
  const row = rows[0] ?? { approvals: 0, notifications: 0 };
  return { approvals: row.approvals, inbox: row.approvals + row.notifications };
}

/**
 * Whether this person administers their organization (owner or admin).
 * Decided by the same database function the row-level policies use.
 */
export async function isOrganizationAdmin(identity: ProductIdentity) {
  const rows = await queryAs<{ admin: boolean }>(
    identity.userId,
    "select osirus.can_manage_organization($1::uuid) as admin",
    [identity.organizationId],
  ).catch(() => [{ admin: false }]);
  return Boolean(rows[0]?.admin);
}
