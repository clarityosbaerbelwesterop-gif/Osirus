import "server-only";
import { queryAs } from "@/lib/db/client";
import type { ProductIdentity } from "@/lib/auth/bootstrap";

// Chat threads of the Agents surface: osirus.sessions with surface "ai" or
// "bot", their messages, and the per-message metadata the chat shows
// (model, reasoning trace, bot).

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const CHAT_SURFACES = ["ai", "bot"] as const;

/** One message as the browser receives it: never which model wrote it. */
export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  reasoning: string | null;
  botId: string | null;
  partial: boolean;
  /** Web sources an answer cites as [n]. */
  sources?: Array<{ n: number; title: string; url: string; domain: string }>;
  /** Files sent with a question. */
  attachments?: Array<{ id: string; filename: string }>;
  /** Commands the bot ran on its own cloud computer for this answer. */
  computer?: Array<{
    command: string;
    reason: string;
    exitCode: number | null;
    output: string;
    durationMs: number;
  }>;
  /** A bot's request to use one MCP tool, and what became of it. */
  toolRequest?: {
    id: string;
    label: string;
    arguments: Record<string, unknown>;
    reason: string;
    status: "pending" | "running" | "done" | "failed" | "denied";
    error: string | null;
  };
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
    reasoning: text(meta.reasoning),
    botId: text(meta.botId),
    partial: meta.partial === true,
    ...(Array.isArray(meta.sources) && meta.sources.length
      ? { sources: meta.sources as NonNullable<ChatMessage["sources"]> }
      : {}),
    ...(Array.isArray(meta.attachments) && meta.attachments.length
      ? {
          attachments: meta.attachments as NonNullable<
            ChatMessage["attachments"]
          >,
        }
      : {}),
    ...(Array.isArray(meta.computer) && meta.computer.length
      ? { computer: meta.computer as NonNullable<ChatMessage["computer"]> }
      : {}),
    ...(meta.toolRequest && typeof meta.toolRequest === "object"
      ? { toolRequest: toolRequestView(meta.toolRequest) }
      : {}),
  };
}

/** The stored request without its tool output, which stays on the server. */
function toolRequestView(
  value: object,
): NonNullable<ChatMessage["toolRequest"]> {
  const row = value as Record<string, unknown>;
  const status = String(row.status ?? "pending");
  return {
    id: String(row.id ?? ""),
    label: String(row.label ?? "Werkzeug").slice(0, 160),
    arguments:
      row.arguments && typeof row.arguments === "object"
        ? (row.arguments as Record<string, unknown>)
        : {},
    reason: String(row.reason ?? "").slice(0, 200),
    status: (["pending", "running", "done", "failed", "denied"].includes(status)
      ? status
      : "pending") as NonNullable<ChatMessage["toolRequest"]>["status"],
    error: typeof row.error === "string" ? row.error.slice(0, 240) : null,
  };
}

/**
 * "Regenerate" stores a second answer after the same question. Only the
 * newest answer of a run of assistant messages is shown and sent as context.
 */
export function collapseRegenerations<
  T extends { role: string; toolRequest?: unknown },
>(messages: readonly T[]) {
  // A bot's tool request is its own step, not an earlier draft: it stays.
  return messages.filter(
    (message, index) =>
      message.role !== "assistant" ||
      Boolean(message.toolRequest) ||
      messages[index + 1]?.role !== "assistant",
  );
}

/** A chat thread for rendering: its newest 400 messages, oldest first. */
export async function loadChatThread(
  identity: ProductIdentity,
  sessionId: string,
) {
  const session = await chatSession(identity, sessionId);
  if (!session) return null;
  const rows = await queryAs<MessageRow>(
    identity.userId,
    // The newest 400, oldest first: a long chat opens on its latest turns.
    `select * from (
       select id, role, content, created_at, metadata
         from osirus.messages
        where session_id = $1::uuid
        order by created_at desc, id desc
        limit 400
     ) recent order by created_at, id`,
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

/**
 * The last turns of a thread as model context, oldest first, and the model
 * that wrote its newest answer (a thread keeps its model).
 */
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
  const lastModelRef =
    rows
      .filter((row) => row.role === "assistant")
      .map((row) => text(row.metadata?.model))
      .find(Boolean) ?? null;
  const turns = collapseRegenerations(
    rows.reverse().map((row) => ({
      role: row.role as "user" | "assistant",
      content: row.content,
    })),
  );
  return { turns, lastModelRef };
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

/**
 * The stop button: recorded on the session first, so the instance writing
 * the answer sees it even when another instance took the click. A dropped
 * connection (Safari in the background) records nothing, and the answer is
 * written to its end and saved.
 */
export async function requestChatStop(
  identity: ProductIdentity,
  sessionId: string,
) {
  const rows = await queryAs<{ id: string }>(
    identity.userId,
    `update osirus.sessions set stop_requested_at = now()
      where id = $1::uuid and workspace_id = $2::uuid
      returning id`,
    [sessionId, identity.workspaceId],
  );
  return rows.length > 0;
}

/** Whether the stop button was pressed for the answer being written. */
export async function chatStopRequested(
  identity: ProductIdentity,
  sessionId: string,
) {
  const rows = await queryAs<{ stopped: boolean }>(
    identity.userId,
    `select stop_requested_at is not null as stopped
       from osirus.sessions
      where id = $1::uuid and workspace_id = $2::uuid`,
    [sessionId, identity.workspaceId],
  );
  return Boolean(rows[0]?.stopped);
}

/**
 * A new answer starts without a stop: one pressed for an earlier answer
 * must not end it. Database time only, so no clock is compared.
 */
export async function clearChatStop(
  identity: ProductIdentity,
  sessionId: string,
) {
  await queryAs(
    identity.userId,
    `update osirus.sessions set stop_requested_at = null
      where id = $1::uuid and workspace_id = $2::uuid
        and stop_requested_at is not null`,
    [sessionId, identity.workspaceId],
  );
}

/**
 * Ends `work` once the stop button was pressed, checking only after the
 * page went away (while it is connected, the button closes the connection
 * after recording the stop, so the check starts then too). A dropped
 * connection alone never ends the answer.
 */
export function watchChatStop(input: {
  disconnected: AbortSignal;
  work: AbortController;
  isStopped: () => Promise<boolean>;
  everyMs?: number;
}) {
  let timer: ReturnType<typeof setInterval> | null = null;
  const halt = () => {
    if (timer) clearInterval(timer);
    timer = null;
  };
  const check = async () => {
    if (input.work.signal.aborted) return halt();
    if (await input.isStopped().catch(() => false)) {
      input.work.abort(new DOMException("Stopped by the person", "AbortError"));
      halt();
    }
  };
  const begin = () => {
    void check();
    timer = setInterval(() => void check(), input.everyMs ?? 1_500);
  };
  if (input.disconnected.aborted) begin();
  else input.disconnected.addEventListener("abort", begin, { once: true });
  return {
    stop() {
      halt();
      input.disconnected.removeEventListener("abort", begin);
    },
  };
}
