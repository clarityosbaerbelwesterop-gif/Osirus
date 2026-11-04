// Model choice by what production measured, not by a ranking guess.
//
// Live 2026-11-04: the Rouge Agent pinned the free OpenRouter route of a
// model that took 19 s per decision on average (p90 53 s, 75 calls in 14
// days), while the same model through NVIDIA answered in 2.7 s. The ranked
// list and a one-question probe cannot see that; the run's own model calls
// can. These are the pure parts; measured-store.ts reads the numbers.

export type MeasuredStat = {
  /** Agent decisions answered by this model in the window. */
  calls: number;
  failed: number;
  /** Median latency of those calls, in milliseconds. */
  p50Ms: number;
};

/** Below this many calls a model counts as unmeasured: no penalty. */
export const MIN_MEASURED_CALLS = 3;

/** Extra rank for a model production measured as slow or failing. */
export function measuredPenalty(stat: MeasuredStat | undefined): number {
  if (!stat || stat.calls < MIN_MEASURED_CALLS) return 0;
  const slow =
    stat.p50Ms > 20_000
      ? 20
      : stat.p50Ms > 10_000
        ? 10
        : stat.p50Ms > 5_000
          ? 4
          : 0;
  const failing = Math.round((stat.failed / stat.calls) * 30);
  return slow + failing;
}

/** The same models, the measured-better ones first; ties keep their order. */
export function rankByMeasure<T extends { ref: string }>(
  models: readonly T[],
  stats: ReadonlyMap<string, MeasuredStat>,
): T[] {
  return models
    .map((model, index) => ({
      model,
      index,
      penalty: measuredPenalty(stats.get(model.ref)),
    }))
    .sort((a, b) => a.penalty - b.penalty || a.index - b.index)
    .map((entry) => entry.model);
}
