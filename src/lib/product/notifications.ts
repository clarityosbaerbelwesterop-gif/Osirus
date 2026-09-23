import "server-only";
import { queryAs } from "../db/client";

// Notifications: only the things a person has to know or act on. Each has a
// dedupe key, so a re-checked approval or a retried run produces one entry,
// not one per attempt. Internal progress events never become notifications.

import type { NotificationKind } from "./notifications-types";
export type { NotificationKind };

export type NotificationView = {
  id: string;
  kind: NotificationKind;
  title: string;
  body: string;
  runId: string | null;
  automationId: string | null;
  approvalId: string | null;
  sessionId: string | null;
  read: boolean;
  createdAt: string;
};

type Recipient = {
  userId: string;
  organizationId: string;
  workspaceId: string;
};

export async function notify(
  recipient: Recipient,
  input: {
    kind: NotificationKind;
    title: string;
    body?: string;
    dedupeKey: string;
    runId?: string | null;
    automationId?: string | null;
    approvalId?: string | null;
  },
) {
  await queryAs(
    recipient.userId,
    `insert into osirus.notifications
       (organization_id, workspace_id, user_id, kind, title, body, run_id,
        automation_id, approval_id, dedupe_key)
     values ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7::uuid, $8::uuid,
             $9::uuid, $10)
     on conflict (user_id, dedupe_key) do nothing`,
    [
      recipient.organizationId,
      recipient.workspaceId,
      recipient.userId,
      input.kind,
      input.title.slice(0, 200),
      (input.body ?? "").slice(0, 1000),
      input.runId ?? null,
      input.automationId ?? null,
      input.approvalId ?? null,
      input.dedupeKey.slice(0, 200),
    ],
  ).catch(() => undefined);
}

export async function listNotifications(
  recipient: Recipient,
  limit = 100,
): Promise<NotificationView[]> {
  const rows = await queryAs<{
    id: string;
    kind: NotificationKind;
    title: string;
    body: string;
    run_id: string | null;
    automation_id: string | null;
    approval_id: string | null;
    session_id: string | null;
    read_at: Date | string | null;
    created_at: Date | string;
  }>(
    recipient.userId,
    `select n.id, n.kind, n.title, n.body, n.run_id, n.automation_id,
            n.approval_id, r.session_id, n.read_at, n.created_at
       from osirus.notifications n
       left join osirus.runs r on r.id = n.run_id
      where n.user_id = $1::uuid and n.workspace_id = $2::uuid
      order by n.created_at desc
      limit $3`,
    [
      recipient.userId,
      recipient.workspaceId,
      Math.min(Math.max(limit, 1), 200),
    ],
  ).catch(() => []);
  return rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    title: row.title,
    body: row.body,
    runId: row.run_id,
    automationId: row.automation_id,
    approvalId: row.approval_id,
    sessionId: row.session_id,
    read: Boolean(row.read_at),
    createdAt: new Date(row.created_at).toISOString(),
  }));
}

export async function markNotificationsRead(
  recipient: Recipient,
  ids: string[] | "all",
) {
  if (ids === "all") {
    await queryAs(
      recipient.userId,
      `update osirus.notifications set read_at = now()
        where user_id = $1::uuid and workspace_id = $2::uuid and read_at is null`,
      [recipient.userId, recipient.workspaceId],
    );
    return;
  }
  if (!ids.length) return;
  await queryAs(
    recipient.userId,
    `update osirus.notifications set read_at = now()
      where user_id = $1::uuid and id = any($2::uuid[]) and read_at is null`,
    [recipient.userId, ids],
  );
}
