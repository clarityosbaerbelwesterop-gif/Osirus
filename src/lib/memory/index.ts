export type MemoryTier = "working" | "second" | "third";
export type MemoryDecision =
  | "DROP"
  | "WORKING_ONLY"
  | "SECOND_BRAIN"
  | "THIRD_BRAIN"
  | "UPDATE_EXISTING"
  | "CONFLICT";

export type MemoryItem = {
  id: string;
  workspaceId?: string | null;
  tier: MemoryTier;
  kind: string;
  content: string;
  source: Record<string, unknown> | string;
  verifiedAt?: string;
  updatedAt: string;
};

export function compileMemory(
  item: MemoryItem,
  existing?: MemoryItem,
): MemoryDecision {
  if (!item.content.trim()) return "DROP";
  if (existing && existing.content !== item.content) {
    return item.verifiedAt ? "UPDATE_EXISTING" : "CONFLICT";
  }
  if (item.kind === "transient") return "WORKING_ONLY";
  if (
    ["decision", "repository", "constraint", "failure", "fact"].includes(
      item.kind,
    )
  ) {
    return "SECOND_BRAIN";
  }
  return "THIRD_BRAIN";
}

export function lexicalRetrieve(query: string, items: MemoryItem[], limit = 8) {
  const terms = query.toLowerCase().split(/\W+/).filter(Boolean);
  return items
    .map((item) => ({
      item,
      score: terms.reduce(
        (score, term) =>
          score + (item.content.toLowerCase().includes(term) ? 1 : 0),
        0,
      ),
    }))
    .filter((candidate) => candidate.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, limit)
    .map((candidate) => candidate.item);
}
