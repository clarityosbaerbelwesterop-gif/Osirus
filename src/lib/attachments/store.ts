import "server-only";
import { createHash } from "node:crypto";
import { queryAs } from "../db/client";
import {
  inspectAttachment,
  parseAttachment,
  type AttachmentKind,
} from "./parse";

// Attachments in the tenant's own rows, under workspace RLS. Upload stores
// the bytes and the parsed chunks; a run retrieves only the chunks that
// match its objective, within a character budget, labelled as untrusted
// file content. Nothing here reads another workspace's file: every query
// runs as the caller.

type Identity = { userId: string; organizationId: string; workspaceId: string };

export type AttachmentView = {
  id: string;
  filename: string;
  kind: AttachmentKind;
  mediaType: string;
  byteSize: number;
  status: "stored" | "parsed" | "unsupported" | "failed";
  structure: Record<string, unknown>;
  note: string | null;
  createdAt: string;
};

type Row = {
  id: string;
  filename: string;
  kind: AttachmentKind;
  media_type: string;
  byte_size: number;
  status: AttachmentView["status"];
  structure: Record<string, unknown>;
  error: string | null;
  created_at: string;
};

const COLUMNS =
  "id, filename, kind, media_type, byte_size, status, structure, error, created_at";

function view(row: Row): AttachmentView {
  return {
    id: row.id,
    filename: row.filename,
    kind: row.kind,
    mediaType: row.media_type,
    byteSize: Number(row.byte_size),
    status: row.status,
    structure: row.structure,
    note: row.error,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

export class AttachmentError extends Error {
  constructor(readonly code: "empty" | "too_large" | "unsupported_type") {
    super(code);
  }
}

/** A safe display name: no path, no control characters, at most 200 chars. */
export function safeFilename(raw: string) {
  const base = raw.split(/[\\/]/).pop() ?? "";
  const clean = Array.from(base)
    .filter((char) => char.charCodeAt(0) >= 32 && char.charCodeAt(0) !== 127)
    .join("")
    .trim()
    .slice(0, 200);
  return clean || "file";
}

export async function saveAttachment(
  identity: Identity,
  input: { filename: string; bytes: Uint8Array; sessionId?: string | null },
) {
  const filename = safeFilename(input.filename);
  const { assertWithinLimit } = await import("../entitlements");
  await assertWithinLimit(identity, "attachmentsPerDay");
  const inspection = inspectAttachment(filename, input.bytes);
  if (!inspection.ok) throw new AttachmentError(inspection.error);
  const parsed = await parseAttachment(inspection.kind, input.bytes);
  const [row] = await queryAs<Row>(
    identity.userId,
    `insert into osirus.attachments
       (organization_id, workspace_id, session_id, uploaded_by, filename,
        media_type, kind, byte_size, sha256, content, status, parsed_text,
        structure, error)
     values ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $6, $7, $8, $9,
             decode($10, 'base64'), $11, $12, $13::jsonb, $14)
     returning ${COLUMNS}`,
    [
      identity.organizationId,
      identity.workspaceId,
      input.sessionId ?? null,
      identity.userId,
      filename,
      inspection.mediaType,
      inspection.kind,
      input.bytes.length,
      createHash("sha256").update(input.bytes).digest("hex"),
      Buffer.from(input.bytes).toString("base64"),
      parsed.status,
      parsed.text,
      JSON.stringify(parsed.structure),
      parsed.error ?? null,
    ],
  );
  if (!row) throw new Error("attachment_insert_failed");
  if (parsed.chunks.length) {
    // Batched so a long document is a few statements, not thousands.
    for (let start = 0; start < parsed.chunks.length; start += 200) {
      const batch = parsed.chunks.slice(start, start + 200);
      await queryAs(
        identity.userId,
        `insert into osirus.attachment_chunks
           (attachment_id, workspace_id, ordinal, content, locator)
         select $1::uuid, $2::uuid, x.ordinal, x.content, x.locator
           from jsonb_to_recordset($3::jsonb)
             as x(ordinal int, content text, locator text)`,
        [
          row.id,
          identity.workspaceId,
          JSON.stringify(
            batch.map((chunk, index) => ({
              ordinal: start + index,
              content: chunk.content.slice(0, 4000),
              locator: chunk.locator,
            })),
          ),
        ],
      );
    }
  }
  return view(row);
}

export async function listAttachments(
  identity: Identity,
  input: { ids?: string[]; sessionId?: string | null },
) {
  const rows = await queryAs<Row>(
    identity.userId,
    `select ${COLUMNS} from osirus.attachments
      where workspace_id = $1::uuid
        and ($2::uuid[] is null or id = any($2::uuid[]))
        and ($3::uuid is null or session_id = $3::uuid)
      order by created_at desc
      limit 50`,
    [identity.workspaceId, input.ids ?? null, input.sessionId ?? null],
  );
  return rows.map(view);
}

export async function deleteAttachment(identity: Identity, id: string) {
  const rows = await queryAs<{ id: string }>(
    identity.userId,
    `delete from osirus.attachments
      where id = $1::uuid and workspace_id = $2::uuid
      returning id`,
    [id, identity.workspaceId],
  );
  return rows.length > 0;
}

/** Bind uploads to the session they were sent in. */
export async function bindAttachments(
  identity: Identity,
  ids: string[],
  sessionId: string,
) {
  if (!ids.length) return;
  await queryAs(
    identity.userId,
    `update osirus.attachments set session_id = $3::uuid
      where workspace_id = $1::uuid and id = any($2::uuid[])
        and (session_id is null or session_id = $3::uuid)`,
    [identity.workspaceId, ids, sessionId],
  );
}

/**
 * The chunks of these attachments that best match the query, ranked by
 * full-text relevance, within a character budget. When nothing matches (a
 * short question about "this file"), the opening chunks of each file.
 */
export async function retrieveAttachmentChunks(
  identity: Identity,
  input: { ids: string[]; query: string; maxChars?: number; limit?: number },
) {
  if (!input.ids.length) return [];
  const limit = Math.min(input.limit ?? 8, 16);
  const rows = await queryAs<{
    filename: string;
    locator: string | null;
    content: string;
    rank: number;
  }>(
    identity.userId,
    `with q as (select plainto_tsquery('simple', $3) as query)
     select a.filename, c.locator, c.content,
            ts_rank(c.search, q.query) as rank
       from osirus.attachment_chunks c
       join osirus.attachments a on a.id = c.attachment_id
       cross join q
      where a.workspace_id = $1::uuid and a.id = any($2::uuid[])
      order by (c.search @@ q.query) desc, rank desc, c.ordinal
      limit $4`,
    [identity.workspaceId, input.ids, input.query.slice(0, 2000), limit],
  );
  const budget = input.maxChars ?? 12_000;
  const out: Array<{ label: string; content: string }> = [];
  let used = 0;
  for (const row of rows) {
    if (used >= budget) break;
    const content = row.content.slice(0, budget - used);
    used += content.length;
    out.push({
      label: `${row.filename}${row.locator ? `, ${row.locator}` : ""}`,
      content,
    });
  }
  return out;
}
