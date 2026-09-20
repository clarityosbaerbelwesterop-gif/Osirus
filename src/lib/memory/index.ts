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
  workspaceId: string;
  tier: MemoryTier;
  kind: string;
  content: string;
  source: string;
  verifiedAt?: string;
  updatedAt: string;
};
export function compileMemory(
  item: MemoryItem,
  existing?: MemoryItem,
): MemoryDecision {
  if (!item.content.trim()) return "DROP";
  if (existing && existing.content !== item.content)
    return item.verifiedAt ? "UPDATE_EXISTING" : "CONFLICT";
  if (item.kind === "transient") return "WORKING_ONLY";
  if (["decision", "repository", "constraint", "failure"].includes(item.kind))
    return "SECOND_BRAIN";
  return "THIRD_BRAIN";
}
export function lexicalRetrieve(q: string, items: MemoryItem[], limit = 8) {
  const terms = q.toLowerCase().split(/\W+/).filter(Boolean);
  return items
    .map((item) => ({
      item,
      score: terms.reduce(
        (n, t) => n + (item.content.toLowerCase().includes(t) ? 1 : 0),
        0,
      ),
    }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.item);
}
