import { z } from "zod";

export type Authority =
  | "primary"
  | "official_docs"
  | "reference"
  | "news"
  | "community"
  | "secondary";

export type ResearchDocument = {
  id: string;
  url: string;
  title: string;
  publisher: string | null;
  publishedAt: string | null;
  retrievedAt: string;
  contentHash: string;
  authority: Authority;
  provider: string;
  /** Extracted text, capped. Excerpts are verified against this. */
  text: string;
};

export type SearchHit = {
  url: string;
  title: string;
  snippet: string;
  provider: string;
  publishedAt?: string | null;
};

export type ProviderStatus =
  { configured: true; reason: string } | { configured: false; reason: string };

export interface ResearchToolProvider {
  readonly id: string;
  readonly kind: "search" | "fetch" | "both";
  status(): ProviderStatus;
  search?(
    query: string,
    options: { limit: number; signal?: AbortSignal },
  ): Promise<SearchHit[]>;
}

export const researchPlanSchema = z.object({
  question: z.string().min(1).max(2000),
  subquestions: z.array(z.string().min(1).max(400)).min(1).max(8),
  freshness: z.enum(["any", "recent_year", "current"]),
  sourceClasses: z
    .array(
      z.enum([
        "primary",
        "official_docs",
        "reference",
        "news",
        "community",
        "secondary",
      ]),
    )
    .max(6),
  queries: z.array(z.string().min(1).max(200)).min(1).max(12),
  counterQueries: z.array(z.string().min(1).max(200)).max(6).default([]),
  stop: z.object({
    minDocuments: z.number().int().min(1).max(30).default(4),
    minIndependentPublishers: z.number().int().min(1).max(10).default(2),
  }),
});

export type ResearchPlan = z.infer<typeof researchPlanSchema>;

export const claimStatusSchema = z.enum([
  "SUPPORTED",
  "CONTESTED",
  "INSUFFICIENT",
  "STALE",
]);
export type ClaimStatus = z.infer<typeof claimStatusSchema>;

/** What the synthesis step proposes: claims, each tied to excerpts. */
export const synthesisSchema = z.object({
  answer: z.string().min(1).max(40_000),
  claims: z
    .array(
      z.object({
        statement: z.string().min(1).max(600),
        support: z
          .array(
            z.object({
              url: z.string().min(1).max(2000),
              excerpt: z.string().min(1).max(800),
            }),
          )
          .max(6)
          .default([]),
        contradict: z
          .array(
            z.object({
              url: z.string().min(1).max(2000),
              excerpt: z.string().min(1).max(800),
            }),
          )
          .max(6)
          .default([]),
      }),
    )
    .max(30),
});

export type Synthesis = z.infer<typeof synthesisSchema>;

export type VerifiedClaim = {
  statement: string;
  status: ClaimStatus;
  confidence: number;
  supporting: Array<{ documentId: string; url: string; excerpt: string }>;
  contradicting: Array<{ documentId: string; url: string; excerpt: string }>;
  rejectedCitations: Array<{ url: string; reason: string }>;
};

export interface EvidenceStore {
  addDocument(
    document: Omit<ResearchDocument, "id">,
  ): Promise<ResearchDocument>;
  documents(): Promise<ResearchDocument[]>;
  findByUrl(url: string): Promise<ResearchDocument | null>;
  saveClaims(claims: VerifiedClaim[]): Promise<void>;
}
