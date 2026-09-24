import { AUTHORITY_WEIGHT, publisherOf } from "./authority";
import type {
  ResearchDocument,
  ResearchPlan,
  Synthesis,
  VerifiedClaim,
} from "./types";

// Citation verification.
//
// A citation is accepted only if three things are true, each checked against
// what this run actually retrieved, never against what the model says:
//
//   1. The URL is a document this run fetched.
//   2. The excerpt appears, verbatim up to whitespace and case, in that
//      document's stored text. An excerpt the model paraphrased or invented
//      does not count, however plausible.
//   3. The excerpt is about the claim: its content words overlap, and every
//      number or year the claim states appears in the excerpt. A real quote
//      attached to the wrong sentence is still a false citation.

const STOPWORDS = new Set(
  "the a an and or of to in on for with by from at as is are was were be been being this that these those it its into than then which who whom whose what when where why how not no also can could should would may might will shall has have had do does did about over under more most less least very such only other same both each some any all their there they them his her our your".split(
    " ",
  ),
);

export function normaliseText(text: string) {
  return text
    .toLowerCase()
    .replace(/[‘’“”"']/g, "")
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

function contentWords(text: string) {
  return new Set(
    (normaliseText(text).match(/[a-zÀ-ɏ][a-zÀ-ɏ0-9-]{3,}/g) ?? []).filter(
      (word) => !STOPWORDS.has(word),
    ),
  );
}

export function numbersInClaim(text: string) {
  return (text.match(/\b\d[\d,.]*\d\b|\b\d\b/g) ?? [])
    .map((value) => value.replace(/,/g, ""))
    .filter((value) => value.length > 0);
}

export function normaliseUrl(raw: string) {
  try {
    const url = new URL(raw.trim());
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (key.startsWith("utm_")) url.searchParams.delete(key);
    }
    return url.toString().replace(/\/$/, "");
  } catch {
    return raw.trim();
  }
}

export type CitationCheck =
  | { ok: true; document: ResearchDocument }
  | {
      ok: false;
      reason:
        | "never_retrieved"
        | "excerpt_not_in_document"
        | "excerpt_unrelated_to_claim"
        | "unsupported_number";
    };

export function checkCitation(
  claim: string,
  citation: { url: string; excerpt: string },
  documents: ResearchDocument[],
): CitationCheck {
  const target = normaliseUrl(citation.url);
  const document = documents.find((doc) => normaliseUrl(doc.url) === target);
  if (!document) return { ok: false, reason: "never_retrieved" };

  const excerpt = normaliseText(citation.excerpt);
  if (excerpt.length < 12 || !normaliseText(document.text).includes(excerpt)) {
    return { ok: false, reason: "excerpt_not_in_document" };
  }

  const claimWords = contentWords(claim);
  const excerptWords = contentWords(citation.excerpt);
  const shared = [...claimWords].filter((word) =>
    excerptWords.has(word),
  ).length;
  const overlap = claimWords.size ? shared / claimWords.size : 0;
  if (overlap < 0.25 && shared < 3)
    return { ok: false, reason: "excerpt_unrelated_to_claim" };

  const excerptNumbers = new Set(numbersInClaim(citation.excerpt));
  if (numbersInClaim(claim).some((value) => !excerptNumbers.has(value))) {
    return { ok: false, reason: "unsupported_number" };
  }
  return { ok: true, document };
}

const DAY = 86_400_000;

export function verifyClaims(
  synthesis: Synthesis,
  documents: ResearchDocument[],
  options: { freshness: ResearchPlan["freshness"]; now?: number },
): VerifiedClaim[] {
  const now = options.now ?? Date.now();
  return synthesis.claims.map((claim) => {
    const supporting: VerifiedClaim["supporting"] = [];
    const contradicting: VerifiedClaim["contradicting"] = [];
    const rejectedCitations: VerifiedClaim["rejectedCitations"] = [];

    for (const citation of claim.support) {
      const check = checkCitation(claim.statement, citation, documents);
      if (check.ok)
        supporting.push({
          documentId: check.document.id,
          url: check.document.url,
          excerpt: citation.excerpt,
        });
      else rejectedCitations.push({ url: citation.url, reason: check.reason });
    }
    for (const citation of claim.contradict) {
      // A contradiction needs a real excerpt from a real document, but it is
      // not required to share the claim's numbers -- disagreeing about the
      // number is often the point.
      const target = normaliseUrl(citation.url);
      const document = documents.find(
        (doc) => normaliseUrl(doc.url) === target,
      );
      if (
        document &&
        normaliseText(document.text).includes(normaliseText(citation.excerpt))
      ) {
        contradicting.push({
          documentId: document.id,
          url: document.url,
          excerpt: citation.excerpt,
        });
      } else {
        rejectedCitations.push({
          url: citation.url,
          reason: document ? "excerpt_not_in_document" : "never_retrieved",
        });
      }
    }

    const supportDocs = supporting
      .map((entry) => documents.find((doc) => doc.id === entry.documentId)!)
      .filter(Boolean);
    const publishers = new Map<string, number>();
    for (const doc of supportDocs) {
      const publisher = publisherOf(doc.url, doc.publisher);
      publishers.set(
        publisher,
        Math.max(
          publishers.get(publisher) ?? 0,
          AUTHORITY_WEIGHT[doc.authority],
        ),
      );
    }
    let confidence = Math.min(
      1,
      [...publishers.values()].reduce((sum, weight) => sum + weight * 0.6, 0),
    );
    if (contradicting.length) confidence *= 0.5;

    const freshnessLimit =
      options.freshness === "current"
        ? 365 * DAY
        : options.freshness === "recent_year"
          ? 730 * DAY
          : Infinity;
    const dated = supportDocs.filter(
      (doc) => doc.publishedAt && Number.isFinite(Date.parse(doc.publishedAt)),
    );
    const allStale =
      Number.isFinite(freshnessLimit) &&
      dated.length > 0 &&
      dated.length === supportDocs.length &&
      dated.every((doc) => now - Date.parse(doc.publishedAt!) > freshnessLimit);

    const status: VerifiedClaim["status"] =
      supporting.length === 0
        ? "INSUFFICIENT"
        : contradicting.length > 0
          ? "CONTESTED"
          : allStale
            ? "STALE"
            : "SUPPORTED";

    return {
      statement: claim.statement,
      status,
      confidence: Number(confidence.toFixed(3)),
      supporting,
      contradicting,
      rejectedCitations,
    };
  });
}

export type CoverageReport = {
  documents: number;
  publishers: number;
  authorities: Record<string, number>;
  supported: number;
  contested: number;
  insufficient: number;
  stale: number;
  falseCitations: number;
  meetsStopRule: boolean;
};

export function coverage(
  claims: VerifiedClaim[],
  documents: ResearchDocument[],
  plan: ResearchPlan,
): CoverageReport {
  const publishers = new Set(
    documents.map((doc) => publisherOf(doc.url, doc.publisher)),
  );
  const authorities: Record<string, number> = {};
  for (const doc of documents)
    authorities[doc.authority] = (authorities[doc.authority] ?? 0) + 1;
  const count = (status: VerifiedClaim["status"]) =>
    claims.filter((claim) => claim.status === status).length;
  return {
    documents: documents.length,
    publishers: publishers.size,
    authorities,
    supported: count("SUPPORTED"),
    contested: count("CONTESTED"),
    insufficient: count("INSUFFICIENT"),
    stale: count("STALE"),
    falseCitations: claims.reduce(
      (sum, claim) => sum + claim.rejectedCitations.length,
      0,
    ),
    meetsStopRule:
      documents.length >= plan.stop.minDocuments &&
      publishers.size >= plan.stop.minIndependentPublishers &&
      ((plan.stopCriteria ?? plan.stop).minSupportedClaims === undefined ||
        claims.filter(
          (claim) =>
            claim.status === "SUPPORTED" || claim.status === "CONTESTED",
        ).length >= (plan.stopCriteria ?? plan.stop).minSupportedClaims!),
  };
}

/** The answer the user reads: claims with their status and sources, conflicts shown. */
export function renderResearchAnswer(
  summary: string,
  claims: VerifiedClaim[],
  documents: ResearchDocument[],
) {
  const index = new Map(documents.map((doc, i) => [doc.id, i + 1]));
  const cite = (ids: string[]) =>
    [...new Set(ids.map((id) => index.get(id)).filter(Boolean))]
      .map((n) => `[${n}]`)
      .join("");
  const lines = [summary.trim(), "", "## Findings"];
  const sections = [
    {
      title: "Facts",
      filter: (claim: VerifiedClaim) => claim.status === "SUPPORTED",
    },
    {
      title: "Possibly outdated",
      filter: (claim: VerifiedClaim) => claim.status === "STALE",
    },
    {
      title: "Contested",
      filter: (claim: VerifiedClaim) => claim.status === "CONTESTED",
    },
    {
      title: "Unsupported",
      filter: (claim: VerifiedClaim) => claim.status === "INSUFFICIENT",
    },
  ];
  for (const section of sections) {
    const matched = claims.filter(section.filter);
    if (!matched.length) continue;
    lines.push("", `### ${section.title}`);
    for (const claim of matched) {
      const refs = cite(claim.supporting.map((entry) => entry.documentId));
      if (claim.status === "SUPPORTED")
        lines.push(`- ${claim.statement} ${refs}`);
      else if (claim.status === "CONTESTED") {
        lines.push(
          `- ${claim.statement} ${refs} — disputed by ${cite(claim.contradicting.map((entry) => entry.documentId))}. Sources disagree; the evidence does not settle it.`,
        );
      } else if (claim.status === "STALE")
        lines.push(`- ${claim.statement} ${refs}`);
      else lines.push(`- ${claim.statement}`);
    }
  }
  const used = documents.filter((doc) =>
    claims.some((claim) =>
      [...claim.supporting, ...claim.contradicting].some(
        (e) => e.documentId === doc.id,
      ),
    ),
  );
  if (used.length) {
    lines.push("", "## Sources");
    for (const doc of used) {
      lines.push(
        `[${index.get(doc.id)}] ${doc.title || doc.url} — ${publisherOf(doc.url, doc.publisher)}${doc.publishedAt ? `, ${doc.publishedAt.slice(0, 10)}` : ""} (${doc.authority}) ${doc.url}`,
      );
    }
  }
  return lines.join("\n");
}
