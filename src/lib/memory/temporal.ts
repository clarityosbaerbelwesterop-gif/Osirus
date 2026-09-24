// Temporal scoring for Memory OS II.
//
// Retrieval and causal ranking apply exponential decay so recent, reinforced
// knowledge outranks stale items without deleting them. Half-life defaults to
// thirty days; high-importance items decay more slowly.

/** Default half-life: thirty days in milliseconds. */
export const DEFAULT_HALF_LIFE_MS = 30 * 24 * 60 * 60 * 1000;

/** Minimum weight after decay; never zero so old facts can still surface. */
export const MIN_DECAY_WEIGHT = 0.05;

export function temporalDecay(
  updatedAt: string | Date,
  now: Date = new Date(),
  halfLifeMs = DEFAULT_HALF_LIFE_MS,
): number {
  const age = now.getTime() - new Date(updatedAt).getTime();
  if (!Number.isFinite(age) || age <= 0) return 1;
  const weight = Math.pow(0.5, age / halfLifeMs);
  return Math.max(MIN_DECAY_WEIGHT, weight);
}

/**
 * Combine a base relevance score with temporal decay and importance.
 * Importance slows decay: an item at importance 1.0 keeps 75% of its decay
 * curve relative to an item at importance 0.
 */
export function temporalScore(
  base: number,
  updatedAt: string | Date,
  importance = 0.5,
  now?: Date,
): number {
  const decay = temporalDecay(updatedAt, now);
  const importanceBoost = 0.5 + Math.min(1, Math.max(0, importance)) * 0.5;
  return base * decay * importanceBoost;
}

export type TemporalItem<T> = T & {
  updatedAt: string | Date;
  importance?: number;
  score?: number;
};

/** Sort by temporal score descending; stable for equal scores. */
export function rankByTemporal<T extends { updatedAt: string | Date }>(
  items: TemporalItem<T>[],
  scoreOf: (item: TemporalItem<T>) => number,
  now?: Date,
): TemporalItem<T>[] {
  return [...items]
    .map((item) => ({
      ...item,
      score: temporalScore(
        scoreOf(item),
        item.updatedAt,
        item.importance ?? 0.5,
        now,
      ),
    }))
    .sort((left, right) => (right.score ?? 0) - (left.score ?? 0));
}
