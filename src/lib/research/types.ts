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

const authorityClassSchema = z.enum([
  "primary",
  "official_docs",
  "reference",
  "news",
  "community",
  "secondary",
]);

export const sourceStrategySchema = z.object({
  primary: z.string().min(1).max(300).optional(),
  official_docs: z.string().min(1).max(300).optional(),
  reference: z.string().min(1).max(300).optional(),
  news: z.string().min(1).max(300).optional(),
  community: z.string().min(1).max(300).optional(),
  secondary: z.string().min(1).max(300).optional(),
});

export const stopCriteriaSchema = z.object({
  minDocuments: z.number().int().min(1).max(30).default(4),
  minIndependentPublishers: z.number().int().min(1).max(10).default(2),
  minSupportedClaims: z.number().int().min(0).max(20).optional(),
  requireCounterEvidence: z.boolean().default(true),
  maxGatherSteps: z.number().int().min(1).max(20).optional(),
});

export const informationNeedSchema = z.object({
  need: z.string().min(1).max(400),
  priority: z.enum(["required", "nice"]).default("required"),
});

export const researchPlanSchema = z.object({
  question: z.string().min(1).max(2000),
  subquestions: z.array(z.string().min(1).max(400)).min(1).max(8),
  freshness: z.enum(["any", "recent_year", "current"]),
  sourceClasses: z.array(authorityClassSchema).max(6),
  /** How to pursue each authority class. */
  sourceStrategy: sourceStrategySchema.default({}),
  /** Decomposed information needs with priority. */
  informationNeeds: z.array(informationNeedSchema).max(10).default([]),
  queries: z.array(z.string().min(1).max(200)).min(1).max(12),
  counterQueries: z.array(z.string().min(1).max(200)).max(6).default([]),
  stop: stopCriteriaSchema,
  /** Alias kept for callers that already read stopCriteria. */
  stopCriteria: stopCriteriaSchema.optional(),
});

export type ResearchPlan = z.infer<typeof researchPlanSchema>;
export type SourceStrategy = z.infer<typeof sourceStrategySchema>;
export type StopCriteria = z.infer<typeof stopCriteriaSchema>;
export type InformationNeed = z.infer<typeof informationNeedSchema>;

export const claimKindSchema = z.enum(["fact", "inference", "open_question"]);
export type ClaimKind = z.infer<typeof claimKindSchema>;

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
  /** Actionable brief the agent can use for decisions. */
  brief: z.string().max(8_000).default(""),
  openQuestions: z.array(z.string().min(1).max(400)).max(12).default([]),
  claims: z
    .array(
      z.object({
        statement: z.string().min(1).max(600),
        kind: claimKindSchema.default("fact"),
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

export type LedgerSourceRef = {
  documentId: string;
  url: string;
  excerpt: string;
  authority: Authority;
  publisher: string;
};

export type LedgerClaim = {
  id: string;
  statement: string;
  kind: ClaimKind;
  status: ClaimStatus;
  confidence: number;
  supporting: LedgerSourceRef[];
  contradicting: LedgerSourceRef[];
  rejectedCitations: Array<{ url: string; reason: string }>;
};

export type LedgerContradiction = {
  claimId: string;
  claimStatement: string;
  supporting: LedgerSourceRef[];
  contradicting: LedgerSourceRef[];
  diagnosis:
    "source_disagreement" | "scope_mismatch" | "temporal_drift" | "unknown";
};

export type EvidenceLedger = {
  question: string;
  claims: LedgerClaim[];
  contradictions: LedgerContradiction[];
  beliefUpdates: Array<{
    claimId: string;
    statement: string;
    priorStatus: ClaimStatus | null;
    newStatus: ClaimStatus;
    reason: string;
    contradictorUrls: string[];
  }>;
  openQuestions: string[];
  brief: string;
  stopMet: boolean;
};

export type ResearchPulseLevel = "L1" | "L2" | "L3" | "L4" | "L5";

export type ResearchPulseTask = {
  id: string;
  level: ResearchPulseLevel;
  title: string;
  objective: string;
  adversarial: boolean;
};

export type ResearchPulseResult = ResearchPulseTask & {
  passed: boolean;
  notes: string;
  latencyMs: number;
};
