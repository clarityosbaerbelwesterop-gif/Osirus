import { publisherOf } from "./authority";
import type {
  ClaimKind,
  ClaimStatus,
  EvidenceLedger,
  LedgerClaim,
  LedgerContradiction,
  LedgerSourceRef,
  ResearchDocument,
  ResearchPlan,
  Synthesis,
  VerifiedClaim,
} from "./types";

// Evidence ledger: claims ↔ sources ↔ confidence ↔ contradictions.
//
// The citation verifier decides whether an excerpt is real. The ledger records
// what that verdict means for beliefs: which claims are established, which are
// contested, and what changed when new evidence arrived.

export type BeliefUpdate = {
  claimId: string;
  statement: string;
  priorStatus: ClaimStatus | null;
  newStatus: ClaimStatus;
  reason: string;
  contradictorUrls: string[];
};

function sourceRef(
  entry: { documentId: string; url: string; excerpt: string },
  documents: ResearchDocument[],
): LedgerSourceRef {
  const document = documents.find((doc) => doc.id === entry.documentId);
  return {
    documentId: entry.documentId,
    url: entry.url,
    excerpt: entry.excerpt,
    authority: document?.authority ?? "secondary",
    publisher: document
      ? publisherOf(document.url, document.publisher)
      : "unknown",
  };
}

function contradictionDiagnosis(
  supporting: LedgerSourceRef[],
  contradicting: LedgerSourceRef[],
): LedgerContradiction["diagnosis"] {
  const supportPublishers = new Set(supporting.map((entry) => entry.publisher));
  const contraPublishers = new Set(
    contradicting.map((entry) => entry.publisher),
  );
  if (
    supportPublishers.size > 0 &&
    contraPublishers.size > 0 &&
    [...supportPublishers].some((publisher) => contraPublishers.has(publisher))
  ) {
    return "scope_mismatch";
  }
  const supportAuthorities = new Set(
    supporting.map((entry) => entry.authority),
  );
  const contraAuthorities = new Set(
    contradicting.map((entry) => entry.authority),
  );
  if (supportAuthorities.has("primary") && contraAuthorities.has("primary")) {
    return "source_disagreement";
  }
  if (
    supporting.some((entry) => entry.authority === "news") &&
    contradicting.some((entry) => entry.authority === "reference")
  ) {
    return "temporal_drift";
  }
  return "unknown";
}

export function claimIdFor(statement: string, index: number) {
  return `claim-${index + 1}`;
}

export function buildEvidenceLedger(input: {
  question: string;
  plan: ResearchPlan;
  synthesis: Synthesis;
  verified: VerifiedClaim[];
  documents: ResearchDocument[];
  prior?: EvidenceLedger | null;
}): EvidenceLedger {
  const claims: LedgerClaim[] = input.verified.map((claim, index) => {
    const proposed = input.synthesis.claims[index];
    const kind: ClaimKind = proposed?.kind ?? "fact";
    const supporting = claim.supporting.map((entry) =>
      sourceRef(entry, input.documents),
    );
    const contradicting = claim.contradicting.map((entry) =>
      sourceRef(entry, input.documents),
    );
    return {
      id: claimIdFor(claim.statement, index),
      statement: claim.statement,
      kind,
      status: claim.status,
      confidence: claim.confidence,
      supporting,
      contradicting,
      rejectedCitations: claim.rejectedCitations,
    };
  });

  const contradictions: LedgerContradiction[] = claims
    .filter((claim) => claim.contradicting.length > 0)
    .map((claim) => ({
      claimId: claim.id,
      claimStatement: claim.statement,
      supporting: claim.supporting,
      contradicting: claim.contradicting,
      diagnosis: contradictionDiagnosis(claim.supporting, claim.contradicting),
    }));

  const openQuestions = [
    ...input.synthesis.openQuestions,
    ...claims
      .filter((claim) => claim.kind === "open_question")
      .map((claim) => claim.statement),
  ];

  const beliefUpdates = updateBeliefsUnderContradiction(
    claims,
    input.prior?.claims ?? [],
  );

  const publishers = new Set(
    input.documents.map((doc) => publisherOf(doc.url, doc.publisher)),
  );
  const stop = input.plan.stopCriteria ?? input.plan.stop;
  const supported = claims.filter(
    (claim) => claim.status === "SUPPORTED" || claim.status === "CONTESTED",
  ).length;

  return {
    question: input.question,
    claims,
    contradictions,
    beliefUpdates,
    openQuestions: [...new Set(openQuestions)],
    brief:
      input.synthesis.brief.trim() ||
      synthesizeBrief({ question: input.question, claims, openQuestions }),
    stopMet:
      input.documents.length >= stop.minDocuments &&
      publishers.size >= stop.minIndependentPublishers &&
      (stop.minSupportedClaims === undefined ||
        supported >= stop.minSupportedClaims),
  };
}

export function updateBeliefsUnderContradiction(
  current: LedgerClaim[],
  prior: LedgerClaim[],
): BeliefUpdate[] {
  const updates: BeliefUpdate[] = [];
  for (const claim of current) {
    const previous = prior.find(
      (entry) => entry.id === claim.id || entry.statement === claim.statement,
    );
    if (!previous || previous.status === claim.status) continue;
    const becameContested =
      claim.status === "CONTESTED" && previous.status !== "CONTESTED";
    const weakened =
      previous.status === "SUPPORTED" &&
      (claim.status === "INSUFFICIENT" ||
        claim.status === "STALE" ||
        claim.status === "CONTESTED");
    if (!becameContested && !weakened) continue;
    updates.push({
      claimId: claim.id,
      statement: claim.statement,
      priorStatus: previous.status,
      newStatus: claim.status,
      reason: becameContested
        ? "New contradicting evidence arrived; the claim is contested, not settled."
        : `Evidence no longer supports the prior belief (${previous.status} → ${claim.status}).`,
      contradictorUrls: claim.contradicting.map((entry) => entry.url),
    });
  }
  return updates;
}

export function synthesizeBrief(input: {
  question: string;
  claims: LedgerClaim[];
  openQuestions: string[];
}): string {
  const facts = input.claims.filter(
    (claim) =>
      claim.kind === "fact" &&
      (claim.status === "SUPPORTED" || claim.status === "STALE"),
  );
  const inferences = input.claims.filter((claim) => claim.kind === "inference");
  const contested = input.claims.filter(
    (claim) => claim.status === "CONTESTED",
  );
  const lines = [`Research brief for: ${input.question.trim()}`, ""];
  if (facts.length) {
    lines.push("Established facts:");
    for (const claim of facts) {
      lines.push(
        `- ${claim.statement} (confidence ${claim.confidence.toFixed(2)})`,
      );
    }
    lines.push("");
  }
  if (inferences.length) {
    lines.push("Inferences (not directly quoted):");
    for (const claim of inferences) {
      lines.push(`- ${claim.statement}`);
    }
    lines.push("");
  }
  if (contested.length) {
    lines.push("Contested — do not treat as settled:");
    for (const claim of contested) {
      lines.push(`- ${claim.statement}`);
    }
    lines.push("");
  }
  const questions = [
    ...input.openQuestions,
    ...input.claims
      .filter((claim) => claim.kind === "open_question")
      .map((claim) => claim.statement),
  ];
  if (questions.length) {
    lines.push("Open questions:");
    for (const question of [...new Set(questions)]) {
      lines.push(`- ${question}`);
    }
  }
  return lines.join("\n").trim();
}
