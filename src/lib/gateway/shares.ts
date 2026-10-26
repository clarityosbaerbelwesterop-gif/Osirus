import "server-only";
import { randomBytes } from "node:crypto";
import type { ProductIdentity } from "@/lib/auth/bootstrap";
import { queryAs, querySystem } from "@/lib/db/client";
import {
  chatSession,
  collapseRegenerations,
  toChatMessage,
  type ChatMessage,
} from "./threads";

// Read-only links to a chat thread. A link is a snapshot: it shows the
// messages written up to the moment of sharing, so later turns stay private
// until the person shares again. Revoking ends the link at once.

const TOKEN = /^[A-Za-z0-9_-]{24,64}$/;

export type ShareState = { token: string; sharedUntil: string } | null;

/** The chat's active link, if any. */
export async function activeShare(
  identity: ProductIdentity,
  sessionId: string,
): Promise<ShareState> {
  const [row] = await queryAs<{ token: string; shared_until: string }>(
    identity.userId,
    `select token, shared_until from osirus.chat_shares
      where session_id = $1::uuid and workspace_id = $2::uuid
        and revoked_at is null`,
    [sessionId, identity.workspaceId],
  );
  return row
    ? {
        token: row.token,
        sharedUntil: new Date(row.shared_until).toISOString(),
      }
    : null;
}

/**
 * Share the chat as it is now: the existing link moves forward to include
 * every message so far, or a new link is made. Null when the chat is not a
 * thread of this workspace.
 */
export async function shareChat(
  identity: ProductIdentity,
  sessionId: string,
): Promise<ShareState> {
  const session = await chatSession(identity, sessionId);
  if (!session) return null;
  const [moved] = await queryAs<{ token: string; shared_until: string }>(
    identity.userId,
    `update osirus.chat_shares set shared_until = now()
      where session_id = $1::uuid and workspace_id = $2::uuid
        and revoked_at is null
      returning token, shared_until`,
    [session.id, identity.workspaceId],
  );
  if (moved)
    return {
      token: moved.token,
      sharedUntil: new Date(moved.shared_until).toISOString(),
    };
  const token = randomBytes(24).toString("base64url");
  const [created] = await queryAs<{ token: string; shared_until: string }>(
    identity.userId,
    `insert into osirus.chat_shares
       (token, session_id, workspace_id, created_by)
     values ($1, $2::uuid, $3::uuid, $4::uuid)
     returning token, shared_until`,
    [token, session.id, identity.workspaceId, identity.userId],
  );
  return created
    ? {
        token: created.token,
        sharedUntil: new Date(created.shared_until).toISOString(),
      }
    : null;
}

/** End the chat's link. True when there was one. */
export async function revokeShare(
  identity: ProductIdentity,
  sessionId: string,
) {
  const rows = await queryAs<{ token: string }>(
    identity.userId,
    `update osirus.chat_shares set revoked_at = now()
      where session_id = $1::uuid and workspace_id = $2::uuid
        and revoked_at is null
      returning token`,
    [sessionId, identity.workspaceId],
  );
  return rows.length > 0;
}

export type SharedMessage = Pick<ChatMessage, "id" | "role" | "content"> & {
  sources?: ChatMessage["sources"];
};

/**
 * The shared snapshot for the public page: title and the visible messages
 * (questions and answers only: no reasoning, models, files or bots).
 */
export async function sharedThread(token: string) {
  if (!TOKEN.test(token)) return null;
  const [share] = await querySystem<{
    session_id: string;
    shared_until: string;
    title: string;
  }>(
    `select s.session_id, s.shared_until, sess.title
       from osirus.chat_shares s
       join osirus.sessions sess on sess.id = s.session_id
      where s.token = $1 and s.revoked_at is null
        and sess.archived_at is null`,
    [token],
  );
  if (!share) return null;
  const rows = await querySystem<{
    id: string;
    role: "user" | "assistant" | "system";
    content: string;
    created_at: string;
    metadata: Record<string, unknown> | null;
  }>(
    `select id, role, content, created_at, metadata
       from osirus.messages
      where session_id = $1::uuid and created_at <= $2
      order by created_at, id
      limit 400`,
    [share.session_id, share.shared_until],
  );
  const messages = collapseRegenerations(
    rows
      .map(toChatMessage)
      .filter((message): message is ChatMessage => message !== null)
      .filter((message) => message.content.trim() && !message.partial),
  ).map((message): SharedMessage => ({
    id: message.id,
    role: message.role,
    content: message.content,
    ...(message.sources ? { sources: message.sources } : {}),
  }));
  return {
    title: share.title,
    sharedAt: new Date(share.shared_until).toISOString(),
    messages,
  };
}
