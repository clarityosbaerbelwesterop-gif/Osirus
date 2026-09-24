import type { MemoryRepository } from "../memory/repository";
import type { EvidenceLedger, LedgerClaim } from "./types";

// Write research outcomes into the existing memory interfaces.
//
// Episodic notes land as run summaries. Semantic notes are individual facts or
// evidence items that passed verification. Contested claims are stored with
// contradiction_status suspected so a later run can reconcile them.

export type ResearchMemoryInput = {
  memory: MemoryRepository;
  organizationId: string;
  workspaceId: string;
  sessionId?: string | null;
  runId: string;
  ledger: EvidenceLedger;
};

function subjectKey(statement: string) {
  const slug = statement
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return `research:${slug || "claim"}`;
}

async function storeClaimMemory(
  input: ResearchMemoryInput,
  claim: LedgerClaim,
) {
  const verified =
    claim.status === "SUPPORTED" &&
    claim.kind === "fact" &&
    claim.supporting.length > 0;
  const conflicted = claim.status === "CONTESTED";
  if (!verified && !conflicted && claim.kind !== "inference") return null;

  return input.memory.compileAndStore({
    organizationId: input.organizationId,
    workspaceId: input.workspaceId,
    sessionId: input.sessionId ?? null,
    runId: input.runId,
    tier: "second",
    kind: claim.kind === "inference" ? "pattern" : "evidence",
    content: claim.statement,
    source: {
      arm: "research",
      runId: input.runId,
      claimId: claim.id,
      status: claim.status,
      kind: claim.kind,
      supporting: claim.supporting.map((entry) => entry.url),
      contradicting: claim.contradicting.map((entry) => entry.url),
    },
    confidence: claim.confidence,
    importance: conflicted ? 0.8 : 0.6,
    verified,
    subjectKey: subjectKey(claim.statement),
    canonicalValue: claim.statement,
    contradictionStatus: conflicted ? "suspected" : "none",
  });
}

export async function persistResearchNotes(input: ResearchMemoryInput) {
  const episodic = await input.memory.compileAndStore({
    organizationId: input.organizationId,
    workspaceId: input.workspaceId,
    sessionId: input.sessionId ?? null,
    runId: input.runId,
    tier: "second",
    kind: "run_summary",
    content: input.ledger.brief,
    source: {
      arm: "research",
      runId: input.runId,
      question: input.ledger.question,
      openQuestions: input.ledger.openQuestions,
      beliefUpdates: input.ledger.beliefUpdates,
    },
    confidence: 0.75,
    importance: 0.7,
    verified: false,
    subjectKey: `research:brief:${input.runId}`,
  });

  const semantic = [];
  for (const claim of input.ledger.claims) {
    const result = await storeClaimMemory(input, claim);
    if (result?.persistedId) semantic.push(result.persistedId);
  }

  return { episodicId: episodic.persistedId, semanticIds: semantic };
}
