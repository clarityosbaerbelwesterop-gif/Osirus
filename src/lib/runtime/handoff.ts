import type { Checkpoint, RuntimeEvent } from "./types";

export type FreshWorkerHandoff = {
  objective: string;
  completedWork: string[];
  currentCheckpoint?: Pick<
    Checkpoint,
    "id" | "label" | "version" | "createdAt"
  >;
  importantMemoryIds: string[];
  artifactIds: string[];
  failures: Array<{ type: string; summary: string }>;
  openQuestions: string[];
  nextRecommendedStage?: string;
};

function compact(value: string, limit = 320) {
  return value.length <= limit
    ? value
    : `${value.slice(0, Math.max(0, limit - 1))}…`;
}

/**
 * A fresh worker receives a compact, durable handoff rather than a copy of the
 * prior model conversation or hidden reasoning.
 */
export function buildFreshWorkerHandoff(input: {
  objective: string;
  checkpoint?: Checkpoint;
  events?: RuntimeEvent[];
  importantMemoryIds?: string[];
  artifactIds?: string[];
  completedWork?: string[];
  openQuestions?: string[];
  nextRecommendedStage?: string;
}): FreshWorkerHandoff {
  const events = input.events ?? [];
  return {
    objective: compact(input.objective, 2000),
    completedWork: (
      input.completedWork ??
      events
        .filter((event) => event.type.endsWith("completed"))
        .slice(-8)
        .map((event) => event.summary)
    )
      .slice(0, 12)
      .map((value) => compact(value)),
    currentCheckpoint: input.checkpoint
      ? {
          id: input.checkpoint.id,
          label: input.checkpoint.label,
          version: input.checkpoint.version,
          createdAt: input.checkpoint.createdAt,
        }
      : undefined,
    importantMemoryIds: (input.importantMemoryIds ?? []).slice(0, 12),
    artifactIds: (input.artifactIds ?? []).slice(0, 12),
    failures: events
      .filter(
        (event) =>
          event.type.endsWith("failed") || event.type === "verification.failed",
      )
      .slice(-8)
      .map((event) => ({ type: event.type, summary: compact(event.summary) })),
    openQuestions: (input.openQuestions ?? [])
      .slice(0, 8)
      .map((value) => compact(value)),
    nextRecommendedStage: input.nextRecommendedStage
      ? compact(input.nextRecommendedStage, 160)
      : undefined,
  };
}
