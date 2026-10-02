/**
 * AI Lab — shared validation helpers for the registry contracts.
 *
 * Pure TypeScript, zero dependencies (no zod, no runtime imports from src/).
 * Each `validate*` function in the contract files returns a `string[]` of
 * human-readable errors; an empty array means the value satisfies the contract.
 */

/** Narrow `unknown` to a plain record (non-null object, not an array). */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** True for strings that contain at least one non-whitespace character. */
export function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/** True for integers >= 0 (used for token counts and training steps). */
export function isNonNegativeInteger(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 0 &&
    Number.isFinite(value)
  );
}

/**
 * True for strings that parse as a valid date. Contract timestamps are ISO 8601
 * strings (e.g. "2026-10-02T00:00:00.000Z"); we accept anything `Date.parse`
 * understands but documents ISO 8601 as the canonical form.
 */
export function isIsoDateString(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

/** True for arrays whose every element is a non-empty string. */
export function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((entry) => isNonEmptyString(entry))
  );
}
