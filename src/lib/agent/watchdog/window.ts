import {
  differenceInterval,
  probabilityBetter,
} from "../../intelligence/experiments/stats";
import {
  countsAsSample,
  isVerified,
  type CapabilityOutcome,
} from "../../verification/outcome";

// Statistical windows for the RSI watchdog.
//
// One sample says nothing about a capability. A cell (family × level, for
// one suite version) is compared as a recent window against the reference
// window before it, with Beta posteriors on the verified rate. A regression
// needs enough samples on both sides, a high posterior probability that the
// recent rate is lower by a margin, and the same finding on two consecutive
// evaluations. Infrastructure failures and inconclusive runs are excluded; a
// false completion weighs as much as two failures.

export const WINDOW = {
  recent: 6,
  reference: 24,
  minSamples: 5,
  /** The smallest drop in verified rate worth calling a regression. */
  margin: 0.1,
  /** P(recent < reference) required. */
  probability: 0.9,
  falseCompletionWeight: 2,
  /** Consecutive evaluations that must agree. */
  confirmations: 2,
} as const;

export type WindowObservation = { outcome: CapabilityOutcome };

export type WindowStats = {
  samples: number;
  verified: number;
  falseCompletions: number;
  excluded: number;
  /** Posterior mean of the verified rate, Beta(1,1) prior. */
  rate: number;
  lower: number;
  upper: number;
};

export function windowStats(observations: WindowObservation[]): WindowStats {
  const counted = observations.filter((entry) => countsAsSample(entry.outcome));
  const verified = counted.filter((entry) => isVerified(entry.outcome)).length;
  const falseCompletions = counted.filter(
    (entry) => entry.outcome === "FALSE_COMPLETION",
  ).length;
  const samples = counted.length;
  const a = 1 + verified;
  const b = 1 + samples - verified;
  const mean = a / (a + b);
  const sd = Math.sqrt((a * b) / ((a + b) ** 2 * (a + b + 1)));
  return {
    samples,
    verified,
    falseCompletions,
    excluded: observations.length - samples,
    rate: round(mean),
    lower: round(Math.max(0, mean - 1.645 * sd)),
    upper: round(Math.min(1, mean + 1.645 * sd)),
  };
}

export type CellAssessment = {
  reference: WindowStats;
  recent: WindowStats;
  /** P(recent verified rate < reference verified rate). */
  probabilityWorse: number;
  drop: number;
  /** This evaluation, taken alone, points at a regression. */
  signal: "verified_drop" | "false_completion" | null;
};

/**
 * Compare the latest window of a cell with the window before it.
 * `observations` are in chronological order, oldest first.
 */
export function assessCell(observations: WindowObservation[]): CellAssessment {
  const counted = observations.filter((entry) => countsAsSample(entry.outcome));
  const recentRows = counted.slice(-WINDOW.recent);
  const referenceRows = counted.slice(
    Math.max(0, counted.length - WINDOW.recent - WINDOW.reference),
    Math.max(0, counted.length - WINDOW.recent),
  );
  const reference = windowStats(referenceRows);
  const recent = windowStats(recentRows);

  // A false completion is a worse outcome than an honest failure: it counts
  // as extra failures in the recent window only.
  const weightedFailures =
    recent.samples -
    recent.verified +
    recent.falseCompletions * (WINDOW.falseCompletionWeight - 1);
  const weightedRecent = {
    successes: recent.verified,
    trials: recent.verified + weightedFailures,
  };
  const referenceCounts = {
    successes: reference.verified,
    trials: reference.samples,
  };
  const enough =
    recent.samples >= WINDOW.minSamples &&
    reference.samples >= WINDOW.minSamples;
  const probabilityWorse = enough
    ? probabilityBetter(referenceCounts, weightedRecent)
    : 0;
  const drop = enough
    ? -differenceInterval(weightedRecent, referenceCounts).mean
    : 0;

  const referenceFalseRate = reference.samples
    ? reference.falseCompletions / reference.samples
    : 0;
  const signal: CellAssessment["signal"] = !enough
    ? null
    : recent.falseCompletions >= 2 && referenceFalseRate < 0.1
      ? "false_completion"
      : probabilityWorse >= WINDOW.probability && drop >= WINDOW.margin
        ? "verified_drop"
        : null;
  return {
    reference,
    recent,
    probabilityWorse: round(probabilityWorse),
    drop: round(drop),
    signal,
  };
}

/** Consecutive agreeing evaluations; a clean evaluation resets it. */
export function nextStreak(previous: number, assessment: CellAssessment) {
  return assessment.signal ? previous + 1 : 0;
}

export function confirmedRegression(streak: number) {
  return streak >= WINDOW.confirmations;
}

function round(value: number) {
  return Number(value.toFixed(4));
}
