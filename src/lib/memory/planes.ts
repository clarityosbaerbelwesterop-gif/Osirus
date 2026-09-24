import type { MemoryItem } from ".";

export type MemoryPlane = "episodic" | "semantic" | "procedural" | "strategic";

export type MemoryBundle = {
  planes: Record<MemoryPlane, MemoryItem[]>;
  contextLines: string[];
  itemIds: string[];
  contradictionsPending: number;
};

function sourceTag(item: MemoryItem) {
  if (typeof item.source !== "object" || !item.source) return null;
  const tag = item.source.memory;
  return typeof tag === "string" ? tag : null;
}

/** Route a durable item into the cognitive plane the Memory OS exposes. */
export function classifyMemoryPlane(item: MemoryItem): MemoryPlane {
  const tag = sourceTag(item);
  if (item.kind === "run_summary") return "episodic";
  if (item.kind === "pattern" || tag?.startsWith("experience."))
    return "procedural";
  if (
    item.kind === "decision" ||
    item.tier === "third" ||
    (item.kind === "constraint" &&
      (item.importance ?? 0) >= 0.7 &&
      item.verificationStatus === "verified")
  )
    return "strategic";
  return "semantic";
}

export function buildMemoryContextLines(
  planes: Record<MemoryPlane, MemoryItem[]>,
) {
  const order: MemoryPlane[] = [
    "episodic",
    "semantic",
    "procedural",
    "strategic",
  ];
  const lines: string[] = [];
  for (const plane of order) {
    for (const item of planes[plane]) {
      lines.push(
        `[${plane}/${item.tier}/${item.verificationStatus ?? "unverified"}] ${item.content}`,
      );
    }
  }
  return lines;
}

export function emptyMemoryPlanes(): Record<MemoryPlane, MemoryItem[]> {
  return {
    episodic: [],
    semantic: [],
    procedural: [],
    strategic: [],
  };
}

export function bundleFromItems(
  items: MemoryItem[],
  contradictionsPending = 0,
): MemoryBundle {
  const planes = emptyMemoryPlanes();
  const seen = new Set<string>();
  for (const item of items) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    planes[classifyMemoryPlane(item)].push(item);
  }
  return {
    planes,
    contextLines: buildMemoryContextLines(planes),
    itemIds: [...seen],
    contradictionsPending,
  };
}
