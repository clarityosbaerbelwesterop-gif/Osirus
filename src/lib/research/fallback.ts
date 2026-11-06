import type { ToolEvidence } from "../agent/toolbox";
import { classifyAuthority } from "./authority";
import type { Authority } from "./types";

// Evidence even when the model spends its budget on searching.
//
// Live 2026-11-06: in a research run all three gather workers used their 8
// tool calls on searches ("tool_budget_exhausted") and fetched 0 documents,
// so the synthesis had nothing it could cite. When a worker ends without a
// fetched document, the best URLs from its own search results are fetched
// for it: most authoritative first, then in the order they were found.

const RANK: Record<Authority, number> = {
  primary: 0,
  official_docs: 1,
  reference: 2,
  news: 3,
  secondary: 4,
  community: 5,
};

/** At most this many documents are fetched for a worker automatically. */
export const FALLBACK_FETCHES = 2;

function urlOf(input: unknown) {
  const url = (input as { url?: unknown } | null)?.url;
  return typeof url === "string" ? url : null;
}

/** Search-result URLs not fetched yet, best first. */
export function fallbackFetchUrls(
  evidence: readonly ToolEvidence[],
  limit = FALLBACK_FETCHES,
): string[] {
  const fetched = new Set(
    evidence
      .filter((entry) => entry.toolId === "research.fetch" && entry.ok)
      .map((entry) => urlOf(entry.input))
      .filter((url): url is string => Boolean(url)),
  );
  const seen = new Set<string>();
  const candidates: Array<{ url: string; rank: number; order: number }> = [];
  for (const entry of evidence) {
    if (entry.toolId !== "research.search" || !entry.ok) continue;
    const hits = (entry.data as { hits?: unknown } | null)?.hits;
    if (!Array.isArray(hits)) continue;
    for (const hit of hits) {
      const url = urlOf(hit);
      if (!url || !/^https?:\/\//i.test(url)) continue;
      if (seen.has(url) || fetched.has(url)) continue;
      seen.add(url);
      candidates.push({
        url,
        rank: RANK[classifyAuthority(url)] ?? 9,
        order: candidates.length,
      });
    }
  }
  return candidates
    .sort((a, b) => a.rank - b.rank || a.order - b.order)
    .slice(0, limit)
    .map((candidate) => candidate.url);
}
