import "server-only";
import { queryAs } from "../db/client";
import type {
  Authority,
  EvidenceStore,
  ResearchDocument,
  VerifiedClaim,
} from "./types";

// Evidence in the database, scoped to one run and one tenant.
//
// Every statement runs through queryAs, so the run's row-level security
// decides what is visible: a worker can only add documents to, and read
// documents from, a run its owner can access.

const MAX_TEXT = 400_000;

type DocumentRow = {
  id: string;
  url: string;
  title: string | null;
  publisher: string | null;
  published_at: string | Date | null;
  retrieved_at: string | Date;
  content_hash: string;
  authority: Authority;
  provider: string;
  content: string;
};

function mapDocument(row: DocumentRow): ResearchDocument {
  return {
    id: row.id,
    url: row.url,
    title: row.title ?? "",
    publisher: row.publisher,
    publishedAt: row.published_at
      ? new Date(row.published_at).toISOString()
      : null,
    retrievedAt: new Date(row.retrieved_at).toISOString(),
    contentHash: row.content_hash,
    authority: row.authority,
    provider: row.provider,
    text: row.content,
  };
}

export class DbEvidenceStore implements EvidenceStore {
  constructor(
    private readonly actorId: string,
    private readonly runId: string,
    private readonly stageId: string | null,
  ) {}

  async addDocument(document: Omit<ResearchDocument, "id">) {
    const rows = await queryAs<DocumentRow>(
      this.actorId,
      `with inserted as (
         insert into osirus.research_documents
           (run_id, stage_id, url, title, publisher, published_at, retrieved_at,
            content_hash, authority, provider, content)
         values ($1::uuid, $2::uuid, $3, $4, $5, $6::timestamptz, $7::timestamptz, $8, $9, $10, $11)
         on conflict (run_id, url, content_hash) do nothing
         returning *
       )
       select * from inserted
       union all
       select * from osirus.research_documents
        where run_id = $1::uuid and url = $3 and content_hash = $8
       limit 1`,
      [
        this.runId,
        this.stageId,
        document.url,
        document.title.slice(0, 500),
        document.publisher,
        document.publishedAt &&
        Number.isFinite(Date.parse(document.publishedAt))
          ? document.publishedAt
          : null,
        document.retrievedAt,
        document.contentHash,
        document.authority,
        document.provider,
        document.text.slice(0, MAX_TEXT),
      ],
    );
    if (!rows[0]) throw new Error("research_document_insert_failed");
    return mapDocument(rows[0]);
  }

  async documents() {
    const rows = await queryAs<DocumentRow>(
      this.actorId,
      "select * from osirus.research_documents where run_id = $1::uuid order by retrieved_at",
      [this.runId],
    );
    return rows.map(mapDocument);
  }

  async findByUrl(url: string) {
    const rows = await queryAs<DocumentRow>(
      this.actorId,
      "select * from osirus.research_documents where run_id = $1::uuid and url = $2 order by retrieved_at desc limit 1",
      [this.runId, url],
    );
    return rows[0] ? mapDocument(rows[0]) : null;
  }

  /** Claims and their evidence links land in one statement per claim. */
  async saveClaims(claims: VerifiedClaim[]) {
    for (const claim of claims) {
      const links = [
        ...claim.supporting.map((entry) => ({
          document_id: entry.documentId,
          relation: "supports",
          excerpt: entry.excerpt.slice(0, 2000),
        })),
        ...claim.contradicting.map((entry) => ({
          document_id: entry.documentId,
          relation: "contradicts",
          excerpt: entry.excerpt.slice(0, 2000),
        })),
      ];
      await queryAs(
        this.actorId,
        `with claim as (
           insert into osirus.research_claims (run_id, statement, status, confidence)
           values ($1::uuid, $2, $3, $4)
           returning id
         )
         insert into osirus.evidence_links (run_id, claim_id, document_id, relation, excerpt)
         select $1::uuid, claim.id, link.document_id, link.relation, link.excerpt
           from claim, jsonb_to_recordset($5::jsonb) as link(document_id uuid, relation text, excerpt text)`,
        [
          this.runId,
          claim.statement.slice(0, 2000),
          claim.status,
          claim.confidence,
          JSON.stringify(links),
        ],
      );
    }
  }
}
