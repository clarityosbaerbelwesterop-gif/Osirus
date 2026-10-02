/**
 * AI Lab — checkpoint registry contract (Phase H implements the store).
 *
 * A Checkpoint record makes training artifacts auditable: every checkpoint
 * points at its parent (resume lineage), its metrics (measured results only —
 * never projections, per handoff gate 3), and its storage location.
 */

import {
  isIsoDateString,
  isNonEmptyString,
  isNonNegativeInteger,
  isRecord,
} from "./common";

export interface Checkpoint {
  /** Unique registry id, e.g. "ckpt_quesnir1b_step5000". */
  readonly id: string;
  /**
   * Honest model identifier (see ModelBackend.modelId in model-backend.ts).
   * Foreign weights are never registered as self-trained checkpoints.
   */
  readonly modelId: string;
  /** Optimizer step at which this checkpoint was taken (0 = initial). */
  readonly step: number;
  /**
   * Id of the parent checkpoint this run resumed from, if any. Chains of
   * parentId reconstruct the full training lineage.
   */
  readonly parentId?: string;
  /**
   * Reference to the measured evaluation results for this checkpoint
   * (experiment-run id or artifact URI). Absent until the eval spine has
   * actually graded the checkpoint.
   */
  readonly metricsRef?: string;
  /** Storage location of the artifact (local path or object-store URI). */
  readonly storageUri: string;
  /** ISO 8601 creation timestamp of the registry record. */
  readonly createdAt: string;
}

/**
 * Validate an unknown value against the Checkpoint contract.
 * Returns a list of human-readable errors; empty array means valid.
 */
export function validateCheckpoint(value: unknown): string[] {
  const errors: string[] = [];
  if (!isRecord(value)) {
    return ["checkpoint must be an object"];
  }
  if (!isNonEmptyString(value.id)) {
    errors.push("id must be a non-empty string");
  }
  if (!isNonEmptyString(value.modelId)) {
    errors.push("modelId must be a non-empty string");
  }
  if (!isNonNegativeInteger(value.step)) {
    errors.push("step must be a non-negative integer");
  }
  if (value.parentId !== undefined && !isNonEmptyString(value.parentId)) {
    errors.push("parentId must be a non-empty string when present");
  }
  if (value.metricsRef !== undefined && !isNonEmptyString(value.metricsRef)) {
    errors.push("metricsRef must be a non-empty string when present");
  }
  if (!isNonEmptyString(value.storageUri)) {
    errors.push("storageUri must be a non-empty string");
  }
  if (!isIsoDateString(value.createdAt)) {
    errors.push("createdAt must be an ISO 8601 date string");
  }
  return errors;
}
