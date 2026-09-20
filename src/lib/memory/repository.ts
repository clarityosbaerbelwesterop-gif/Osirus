import { queryAs } from "../db/client";
import type { MemoryItem, MemoryTier } from ".";

type MemoryRow = {
  id: string;
  workspace_id: string | null;
  layer: "second" | "third";
  kind: string;
  content: string;
  source: Record<string, unknown>;
  verification_status: string;
  updated_at: string | Date;
};

function mapMemory(row: MemoryRow): MemoryItem {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    tier: row.layer,
    kind: row.kind,
    content: row.content,
    source: row.source ?? {},
    verifiedAt:
      row.verification_status === "verified"
        ? new Date(row.updated_at).toISOString()
        : undefined,
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

export class MemoryRepository {
  constructor(private readonly actorId: string) {}

  async retrieve(workspaceId: string, query: string, limit = 8) {
    const rows = await queryAs<MemoryRow>(
      this.actorId,
      `select id, workspace_id, layer, kind, content, source,
              verification_status, updated_at
         from osirus.memory_items
        where owner_id = $1::uuid
          and (workspace_id = $2::uuid or workspace_id is null)
          and (
            to_tsvector('simple', searchable_text)
              @@ websearch_to_tsquery('simple', $3)
            or searchable_text ilike ('%' || $3 || '%')
          )
        order by
          ts_rank_cd(
            to_tsvector('simple', searchable_text),
            websearch_to_tsquery('simple', $3)
          ) desc,
          importance desc,
          updated_at desc
        limit $4`,
      [this.actorId, workspaceId, query, Math.min(Math.max(limit, 1), 20)],
    );
    return rows.map(mapMemory);
  }

  async store(input: {
    organizationId: string;
    workspaceId: string;
    sessionId?: string | null;
    runId?: string | null;
    tier: Exclude<MemoryTier, "working">;
    kind:
      | "decision"
      | "fact"
      | "evidence"
      | "project_map"
      | "run_summary"
      | "artifact"
      | "constraint"
      | "pattern"
      | "blocker";
    content: string;
    source: Record<string, unknown>;
    confidence?: number;
    importance?: number;
    verified?: boolean;
    subjectKey?: string | null;
    canonicalValue?: string | null;
  }) {
    const rows = await queryAs<{ id: string }>(
      this.actorId,
      `insert into osirus.memory_items
         (owner_id, organization_id, workspace_id, session_id, run_id,
          scope, layer, kind, content, searchable_text, subject_key,
          canonical_value, source, confidence, importance,
          verification_status, contradiction_status)
       values
         ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid,
          'workspace', $6, $7, $8, $8, $9, $10, $11::jsonb,
          $12, $13, $14, 'none')
       returning id`,
      [
        this.actorId,
        input.organizationId,
        input.workspaceId,
        input.sessionId ?? null,
        input.runId ?? null,
        input.tier,
        input.kind,
        input.content,
        input.subjectKey ?? null,
        input.canonicalValue ?? null,
        JSON.stringify(input.source),
        input.confidence ?? 0.7,
        input.importance ?? 0.5,
        input.verified ? "verified" : "unverified",
      ],
    );
    return rows[0]?.id ?? null;
  }
}
