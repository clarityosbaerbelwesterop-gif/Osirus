import { queryAs } from "../db/client";
import {
  compileMemoryCandidate,
  type MemoryCompileInput,
  type MemoryDecision,
  type MemoryItem,
  type MemoryTier,
} from ".";

type MemoryRow = {
  id: string;
  workspace_id: string | null;
  layer: "second" | "third";
  kind: string;
  content: string;
  source: Record<string, unknown>;
  verification_status: "unverified" | "verified" | "conflicted" | "rejected";
  contradiction_status: "none" | "suspected" | "resolved";
  confidence: string | number;
  importance: string | number;
  subject_key: string | null;
  canonical_value: string | null;
  updated_at: string | Date;
  relevance?: string | number;
};

export type MemoryRetrieveInput = {
  workspaceId: string;
  objective: string;
  capability?: string;
  stage?: string;
  entities?: string[];
  tokenBudget?: number;
  limit?: number;
};

type StoredMemoryInput = {
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
  contradictionStatus?: "none" | "suspected" | "resolved";
  supersedesMemoryId?: string | null;
};

export type MemoryPersistResult = {
  decision: MemoryDecision;
  persistedId: string | null;
  reason: string;
  existingMemoryId?: string;
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
    confidence: Number(row.confidence),
    importance: Number(row.importance),
    subjectKey: row.subject_key,
    canonicalValue: row.canonical_value,
    verificationStatus: row.verification_status,
    contradictionStatus: row.contradiction_status,
  };
}

function tokenCost(item: MemoryItem) {
  return Math.max(1, Math.ceil(item.content.length / 4));
}

function normalizeRetrieve(
  workspaceId: string | MemoryRetrieveInput,
  objective?: string,
  limit?: number,
): MemoryRetrieveInput {
  if (typeof workspaceId !== "string") return workspaceId;
  return {
    workspaceId,
    objective: objective ?? "",
    limit,
  };
}

export class MemoryRepository {
  constructor(private readonly actorId: string) {}

  async retrieve(
    workspaceId: string | MemoryRetrieveInput,
    objective?: string,
    limit?: number,
  ): Promise<MemoryItem[]> {
    const input = normalizeRetrieve(workspaceId, objective, limit);
    const rowLimit = Math.min(Math.max(input.limit ?? 8, 1), 20);
    const query = input.objective.trim();
    if (!query) return [];
    const rows = await queryAs<MemoryRow>(
      this.actorId,
      `with item_candidates as (
         select id, workspace_id, layer, kind, content, source,
                verification_status, contradiction_status, confidence, importance,
                subject_key, canonical_value, updated_at,
                ts_rank_cd(
                  to_tsvector('simple', searchable_text),
                  websearch_to_tsquery('simple', $3)
                ) as relevance
           from osirus.memory_items
          where owner_id = $1::uuid
            and (workspace_id = $2::uuid or workspace_id is null)
            and verification_status <> 'rejected'
            and contradiction_status <> 'suspected'
            and (
              to_tsvector('simple', searchable_text)
                @@ websearch_to_tsquery('simple', $3)
              or searchable_text ilike ('%' || $3 || '%')
            )
       ), summary_candidates as (
         select id, workspace_id, layer, 'run_summary'::text as kind,
                summary as content, provenance as source,
                case when confidence >= 0.75 then 'verified' else 'unverified' end
                  as verification_status,
                'none'::text as contradiction_status,
                confidence, 0.65::numeric as importance,
                null::text as subject_key, null::text as canonical_value, updated_at,
                ts_rank_cd(
                  to_tsvector('simple', summary),
                  websearch_to_tsquery('simple', $3)
                ) as relevance
           from osirus.memory_summaries
          where owner_id = $1::uuid
            and (workspace_id = $2::uuid or workspace_id is null)
            and to_tsvector('simple', summary)
                @@ websearch_to_tsquery('simple', $3)
       )
       select * from item_candidates
       union all
       select * from summary_candidates
       order by relevance desc, importance desc, updated_at desc
       limit $4`,
      [this.actorId, input.workspaceId, query, rowLimit],
    );
    const memory = rows.map(mapMemory);
    const entityNames = (input.entities ?? [])
      .map((entity) => entity.trim().toLowerCase())
      .filter(Boolean)
      .slice(0, 12);
    if (entityNames.length) {
      const relatedRows = await queryAs<MemoryRow>(
        this.actorId,
        `select distinct item.id, item.workspace_id, item.layer, item.kind,
                item.content, item.source, item.verification_status,
                item.contradiction_status, item.confidence, item.importance,
                item.subject_key, item.canonical_value, item.updated_at,
                0::real as relevance
           from osirus.memory_entities entity
           join osirus.memory_relations relation
             on relation.from_entity_id = entity.id or relation.to_entity_id = entity.id
           join osirus.memory_items item on item.id = relation.source_memory_id
          where entity.owner_id = $1::uuid
            and entity.workspace_id = $2::uuid
            and (
              lower(entity.canonical_name) = any($3::text[])
              or exists (
                select 1 from unnest(entity.aliases) alias
                 where lower(alias) = any($3::text[])
              )
            )
            and item.verification_status <> 'rejected'
            and item.contradiction_status <> 'suspected'
          order by item.importance desc, item.updated_at desc
          limit $4`,
        [this.actorId, input.workspaceId, entityNames, 6],
      );
      for (const related of relatedRows.map(mapMemory)) {
        if (!memory.some((item) => item.id === related.id))
          memory.push(related);
      }
    }
    const budget = input.tokenBudget ?? Number.POSITIVE_INFINITY;
    let used = 0;
    return memory.filter((item) => {
      const cost = tokenCost(item);
      if (used + cost > budget) return false;
      used += cost;
      return true;
    });
  }

  async latestBySubject(workspaceId: string, subjectKey: string) {
    const rows = await queryAs<MemoryRow>(
      this.actorId,
      `select id, workspace_id, layer, kind, content, source,
              verification_status, contradiction_status, confidence, importance,
              subject_key, canonical_value, updated_at
         from osirus.memory_items
        where owner_id = $1::uuid
          and workspace_id = $2::uuid
          and subject_key = $3
        order by updated_at desc
        limit 8`,
      [this.actorId, workspaceId, subjectKey],
    );
    return rows.map(mapMemory);
  }

  async resolveConflict(input: {
    workspaceId: string;
    winningMemoryId: string;
    rejectedMemoryIds: string[];
  }) {
    await queryAs(
      this.actorId,
      `update osirus.memory_items
          set contradiction_status = 'resolved', verification_status = 'verified'
        where id = $1::uuid and workspace_id = $2::uuid`,
      [input.winningMemoryId, input.workspaceId],
    );
    if (input.rejectedMemoryIds.length) {
      await queryAs(
        this.actorId,
        `update osirus.memory_items
            set contradiction_status = 'resolved', verification_status = 'rejected'
          where id = any($1::uuid[]) and workspace_id = $2::uuid`,
        [input.rejectedMemoryIds.slice(0, 20), input.workspaceId],
      );
    }
  }

  async store(input: StoredMemoryInput) {
    const rows = await queryAs<{ id: string }>(
      this.actorId,
      `insert into osirus.memory_items
         (owner_id, organization_id, workspace_id, session_id, run_id,
          scope, layer, kind, content, searchable_text, subject_key,
          canonical_value, source, confidence, importance,
          verification_status, contradiction_status, supersedes_memory_id)
       values
         ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid,
          'workspace', $6, $7, $8, $8, $9, $10, $11::jsonb,
          $12, $13, $14, $15, $16, $17::uuid)
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
        input.contradictionStatus ?? "none",
        input.supersedesMemoryId ?? null,
      ],
    );
    return rows[0]?.id ?? null;
  }

  async storeSummary(
    input: Omit<StoredMemoryInput, "tier" | "kind"> & {
      horizon?: "stage" | "run" | "session" | "workspace" | "historical";
      sourceMemoryIds?: string[];
    },
  ) {
    const rows = await queryAs<{ id: string }>(
      this.actorId,
      `insert into osirus.memory_summaries
         (owner_id, organization_id, workspace_id, session_id, run_id,
          layer, horizon, summary, source_memory_ids, provenance, confidence)
       values
         ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid,
          'third', $6, $7, $8::uuid[], $9::jsonb, $10)
       returning id`,
      [
        this.actorId,
        input.organizationId,
        input.workspaceId,
        input.sessionId ?? null,
        input.runId ?? null,
        input.horizon ?? "workspace",
        input.content,
        input.sourceMemoryIds ?? [],
        JSON.stringify(input.source),
        input.confidence ?? 0.7,
      ],
    );
    return rows[0]?.id ?? null;
  }

  async compileAndStore(
    input: StoredMemoryInput &
      Omit<MemoryCompileInput, "content" | "kind" | "source">,
  ): Promise<MemoryPersistResult> {
    const existing = input.subjectKey
      ? await this.latestBySubject(input.workspaceId, input.subjectKey)
      : [];
    const compilation = compileMemoryCandidate(
      {
        ...input,
        content: input.content,
        kind: input.kind,
        source: input.source,
        confidence: input.confidence,
        importance: input.importance,
        verified: input.verified,
        subjectKey: input.subjectKey,
        canonicalValue: input.canonicalValue,
      },
      existing,
    );
    if (
      compilation.decision === "DROP" ||
      compilation.decision === "WORKING_ONLY"
    ) {
      return { ...compilation, persistedId: null };
    }
    if (compilation.decision === "UPDATE_EXISTING") {
      if (compilation.existingMemoryId) {
        await queryAs(
          this.actorId,
          `update osirus.memory_items
              set source = $2::jsonb,
                  confidence = greatest(confidence, $3),
                  importance = greatest(importance, $4),
                  verification_status = case when $5 then 'verified' else verification_status end
            where id = $1::uuid`,
          [
            compilation.existingMemoryId,
            JSON.stringify(input.source),
            input.confidence ?? 0.7,
            input.importance ?? 0.5,
            Boolean(input.verified),
          ],
        );
      }
      return {
        ...compilation,
        persistedId: compilation.existingMemoryId ?? null,
      };
    }
    if (compilation.decision === "DISTILL_THIRD_BRAIN") {
      const persistedId = await this.storeSummary({
        ...input,
        sourceMemoryIds: compilation.existingMemoryId
          ? [compilation.existingMemoryId]
          : [],
      });
      return { ...compilation, persistedId };
    }
    if (
      compilation.decision === "MARK_CONFLICT" &&
      compilation.existingMemoryId
    ) {
      await queryAs(
        this.actorId,
        `update osirus.memory_items
            set contradiction_status = 'suspected', verification_status = 'conflicted'
          where id = $1::uuid`,
        [compilation.existingMemoryId],
      );
    }
    const persistedId = await this.store({
      ...input,
      tier: "second",
      contradictionStatus:
        compilation.decision === "MARK_CONFLICT" ? "suspected" : "none",
      supersedesMemoryId: compilation.existingMemoryId ?? null,
    });
    return { ...compilation, persistedId };
  }
}
