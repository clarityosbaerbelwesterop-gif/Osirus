/**
 * AI Lab — experiment registry contract (Phase H implements the store).
 *
 * An Experiment record fixes hypothesis, configuration, datasets, and
 * baselines *before* any run, so results stay attributable and comparable.
 * Statuses move draft → running → completed/aborted; timestamps are only set
 * when the corresponding transition actually happened.
 */

import {
  isIsoDateString,
  isNonEmptyString,
  isRecord,
  isStringArray,
} from "./common";

/** Lifecycle of an experiment. */
export const EXPERIMENT_STATUSES = [
  "draft",
  "running",
  "completed",
  "aborted",
] as const;

export type ExperimentStatus = (typeof EXPERIMENT_STATUSES)[number];

export interface Experiment {
  /** Unique registry id, e.g. "exp_quesnir_mix_ablation_001". */
  readonly id: string;
  /**
   * The falsifiable hypothesis under test, stated before the run
   * (e.g. "87/13 code/NL mix outperforms 50/50 on humaneval pass@1 at 1B").
   */
  readonly hypothesis: string;
  /**
   * Hash of the full run configuration (model, seed, hyperparameters, code
   * revision). Together with the seed recorded per eval run, this is the
   * reproducibility anchor.
   */
  readonly configHash: string;
  /** Ids of the Dataset records used for training in this experiment. */
  readonly datasetIds: readonly string[];
  /**
   * Ids of the baseline backends/checkpoints the experiment compares against
   * (e.g. Qwen2.5-Coder / DeepSeek-Coder baselines per the reuse doc § 5) or
   * of prior experiments serving as baselines.
   */
  readonly baselineIds: readonly string[];
  readonly status: ExperimentStatus;
  /** ISO 8601 timestamp of the draft → running transition. */
  readonly startedAt?: string;
  /** ISO 8601 timestamp of the running → completed/aborted transition. */
  readonly completedAt?: string;
}

/**
 * Validate an unknown value against the Experiment contract.
 * Returns a list of human-readable errors; empty array means valid.
 */
export function validateExperiment(value: unknown): string[] {
  const errors: string[] = [];
  if (!isRecord(value)) {
    return ["experiment must be an object"];
  }
  if (!isNonEmptyString(value.id)) {
    errors.push("id must be a non-empty string");
  }
  if (!isNonEmptyString(value.hypothesis)) {
    errors.push("hypothesis must be a non-empty string");
  }
  if (!isNonEmptyString(value.configHash)) {
    errors.push("configHash must be a non-empty string");
  }
  if (!isStringArray(value.datasetIds)) {
    errors.push("datasetIds must be an array of non-empty strings");
  }
  if (!isStringArray(value.baselineIds)) {
    errors.push("baselineIds must be an array of non-empty strings");
  }
  if (
    !isNonEmptyString(value.status) ||
    !(EXPERIMENT_STATUSES as readonly string[]).includes(value.status)
  ) {
    errors.push(`status must be one of: ${EXPERIMENT_STATUSES.join(", ")}`);
  }
  if (value.startedAt !== undefined && !isIsoDateString(value.startedAt)) {
    errors.push("startedAt must be an ISO 8601 date string when present");
  }
  if (value.completedAt !== undefined && !isIsoDateString(value.completedAt)) {
    errors.push("completedAt must be an ISO 8601 date string when present");
  }
  // Temporal consistency: an experiment cannot complete before it started.
  if (value.completedAt !== undefined && value.startedAt === undefined) {
    errors.push("completedAt requires startedAt to be set");
  }
  if (value.status === "completed" && value.completedAt === undefined) {
    errors.push("completed status requires completedAt");
  }
  return errors;
}
