import "server-only";
import { queryAs } from "@/lib/db/client";
import type { ProductIdentity } from "@/lib/auth/bootstrap";

// Chat threads of the Agents surface: osirus.sessions with surface "ai" or
// "bot", their messages, and the per-message metadata the chat shows
// (model, reasoning trace, bot).

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const CHAT_SURFACES = ["ai", "bot"] as const;

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  model: string | null;
  modelName: string | null;
  reasoning: string | null;
  botId: string | null;
  partial: boolean;
};

export function isUuid(value: string | null | undefined): value is string {
  return typeof value === "string" && UUID.test(value);
}

/** The session when it is a chat thread of this workspace, else null. */
export async function chatSession(
  identity: ProductIdentity,
  sessionId: string,
) {
  if (!isUuid(sessionId)) return null;
  const rows = await queryAs<{
    id: string;
    title: string;
    surface: string | null;
  }>(
    identity.userId,
    `select id, title, surface
       from osirus.sessions
      where id = $1::uuid and workspace_id = $2::uuid and archived_at is null`,
    [sessionId, identity.workspaceId],
  );
  const row = rows[0];
  if (!row) return null;
  const surface = row.surface ?? "ai";
  if (!(CHAT_SURFACES as readonly string[]).includes(surface)) return null;
  return { id: row.id, title: row.title, surface };
}

type MessageRow = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  created_at: string | Date;
  metadata: Record<string, unknown> | null;
};

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value : null;
}

export function toChatMessage(row: MessageRow): ChatMessage | null {
  if (row.role !== "user" && row.role !== "assistant") return null;
  const meta = row.metadata ?? {};
  return {
    id: row.id,
    role: row.role,
    content: row.content,
    createdAt: new Date(row.created_at).toISOString(),
    model: text(meta.model),
    modelName: text(meta.modelName),
    reasoning: text(meta.reasoning),
    botId: text(meta.botId),
    partial: meta.partial === true,
  };
}

/**
 * "Regenerate" stores a second answer after the same question. Only the
 * newest answer of a run of assistant messages is shown and sent as context.
 */
export function collapseRegenerations<T extends { role: string }>(
  messages: readonly T[],
) {
  return messages.filter(
    (message, index) =>
      message.role !== "assistant" || messages[index + 1]?.role !== "assistant",
  );
}

/** A whole chat thread for rendering, oldest first (at most 400 messages). */
export async function loadChatThread(
  identity: ProductIdentity,
  sessionId: string,
) {
  const session = await chatSession(identity, sessionId);
  if (!session) return null;
  const rows = await queryAs<MessageRow>(
    identity.userId,
    `select id, role, content, created_at, metadata
       from osirus.messages
      where session_id = $1::uuid
      order by created_at, id
      limit 400`,
    [session.id],
  );
  return {
    sessionId: session.id,
    title: session.title,
    messages: collapseRegenerations(
      rows.map(toChatMessage).filter((m): m is ChatMessage => m !== null),
    ),
  };
}

/** The last turns of a thread as model context, oldest first. */
export async function chatContext(
  identity: ProductIdentity,
  sessionId: string,
  limit = 24,
) {
  const rows = await queryAs<MessageRow>(
    identity.userId,
    `select id, role, content, created_at, metadata
       from osirus.messages
      where session_id = $1::uuid and role in ('user', 'assistant')
      order by created_at desc, id desc
      limit $2`,
    [sessionId, Math.min(Math.max(limit, 1), 60)],
  );
  return collapseRegenerations(
    rows.reverse().map((row) => ({
      role: row.role as "user" | "assistant",
      content: row.content,
    })),
  );
}

export async function createChatSession(
  identity: ProductIdentity,
  input: { title: string; surface: "ai" | "bot" },
) {
  const rows = await queryAs<{ id: string }>(
    identity.userId,
    `insert into osirus.sessions
       (organization_id, workspace_id, title, created_by, surface)
     values ($1::uuid, $2::uuid, $3, $4::uuid, $5)
     returning id`,
    [
      identity.organizationId,
      identity.workspaceId,
      input.title.slice(0, 240) || "Neuer Chat",
      identity.userId,
      input.surface,
    ],
  );
  if (!rows[0]) throw new Error("session_insert_failed");
  return rows[0].id;
}

export async function saveChatMessage(
  identity: ProductIdentity,
  input: {
    sessionId: string;
    role: "user" | "assistant";
    content: string;
    metadata: Record<string, unknown>;
  },
) {
  const rows = await queryAs<{ id: string; created_at: string | Date }>(
    identity.userId,
    `with inserted as (
       insert into osirus.messages
         (organization_id, workspace_id, session_id, run_id, role, content, metadata)
       values ($1::uuid, $2::uuid, $3::uuid, null, $4, $5, $6::jsonb)
       returning id, created_at
     ), touched as (
       update osirus.sessions set updated_at = now() where id = $3::uuid
     )
     select id, created_at from inserted`,
    [
      identity.organizationId,
      identity.workspaceId,
      input.sessionId,
      input.role,
      input.content,
      JSON.stringify(input.metadata),
    ],
  );
  if (!rows[0]) throw new Error("message_insert_failed");
  return {
    id: rows[0].id,
    createdAt: new Date(rows[0].created_at).toISOString(),
  };
}
