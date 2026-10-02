/**
 * AI Lab — dataset registry contract (Phase H implements the store).
 *
 * A Dataset record is the unit of data governance in the lab: no training
 * corpus exists without provenance, license evidence, dedup method, and
 * decontamination recorded (docs/ROUGE_RESEARCH_HANDOFF.md Stage A,
 * docs/AI_LAB_DEEPSEEK_REUSE.md §§ 3–4 — binding clauses land in Phase J).
 */

import {
  isIsoDateString,
  isNonEmptyString,
  isNonNegativeInteger,
  isRecord,
  isStringArray,
} from "./common";

export interface Dataset {
  /** Unique registry id, e.g. "ds_stackv2_20261002". */
  readonly id: string;
  /**
   * Human-readable source name, e.g. "bigcode/the-stack-v2". Must be a source
   * we can actually obtain and license — the DeepSeek 2T-token corpus was never
   * released and must never appear here (reuse doc § 2).
   */
  readonly source: string;
  /**
   * License identifier of the source (SPDX where applicable), with evidence
   * retained alongside the registry entry. Ingestion without license filtering
   * is prohibited.
   */
  readonly license: string;
  /** Resolvable URI proving provenance (repo URL + commit, DOI, archive id). */
  readonly provenanceUri: string;
  /**
   * Identifier of the dedup method applied, e.g. "minhash-lsh-v1" — the
   * near-duplicate filtering per spec § 27 / reuse doc § 3.
   */
  readonly dedupMethod: string;
  /**
   * Eval-set ids this dataset was decontaminated against (e.g. "humaneval",
   * "mbpp", "ds-1000", "multipl-e", future Rouge suites). Eval-set isolation
   * is non-negotiable.
   */
  readonly decontaminatedAgainst: readonly string[];
  /** Token count after tokenization, when known (set by the tokenize stage). */
  readonly tokenCount?: number;
  /** ISO 8601 creation timestamp of the registry record. */
  readonly createdAt: string;
}

/**
 * Validate an unknown value against the Dataset contract.
 * Returns a list of human-readable errors; empty array means valid.
 */
export function validateDataset(value: unknown): string[] {
  const errors: string[] = [];
  if (!isRecord(value)) {
    return ["dataset must be an object"];
  }
  if (!isNonEmptyString(value.id)) {
    errors.push("id must be a non-empty string");
  }
  if (!isNonEmptyString(value.source)) {
    errors.push("source must be a non-empty string");
  }
  if (!isNonEmptyString(value.license)) {
    errors.push("license must be a non-empty string");
  }
  if (!isNonEmptyString(value.provenanceUri)) {
    errors.push("provenanceUri must be a non-empty string");
  }
  if (!isNonEmptyString(value.dedupMethod)) {
    errors.push("dedupMethod must be a non-empty string");
  }
  if (!isStringArray(value.decontaminatedAgainst)) {
    errors.push("decontaminatedAgainst must be an array of non-empty strings");
  }
  if (
    value.tokenCount !== undefined &&
    !isNonNegativeInteger(value.tokenCount)
  ) {
    errors.push("tokenCount must be a non-negative integer when present");
  }
  if (!isIsoDateString(value.createdAt)) {
    errors.push("createdAt must be an ISO 8601 date string");
  }
  return errors;
}
