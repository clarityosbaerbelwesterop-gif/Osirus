import type { ExperienceOutcome } from "../intelligence/types";
import type { CheckStatus, VerdictStatus } from "./engine";

// The one capability outcome the pulse, the watchdog, the Foundry and the
// product experience agree on.
//
// "The run finished and there is an answer" is not a verified capability.
// An outcome is derived from evidence that exists outside the model's own
// claim: verdicts from the VerificationEngine, deterministic checks (tests,
// recomputation, fetched sources, browser observations), the finish gate,
// and the TaskState hypotheses. A provider refusal or a missing browser is
// an infrastructure failure, never a capability regression.

export const CAPABILITY_OUTCOMES = [
  "VERIFIED_SUCCESS",
  "SUCCESS_UNVERIFIED",
  "PARTIAL",
  "REJECTED",
  "FALSE_COMPLETION",
  "INCONCLUSIVE",
  "INFRASTRUCTURE_FAILURE",
] as const;

export type CapabilityOutcome = (typeof CAPABILITY_OUTCOMES)[number];

export type OutcomeEvidence = {
  /** A provider refusal, a missing sandbox or browser, a runner that threw. */
  infrastructureError?: string | null;
  /** Nothing can be judged, and the reason why (e.g. no live model offline). */
  inconclusive?: string | null;
  /** The run or loop produced a final answer. */
  finished: boolean;
  /** The final answer asserts that the work is done or correct. */
  claimedSuccess?: boolean;
  verdicts?: VerdictStatus[];
  /** Deterministic checks: exit codes, recomputation, sources, DOM. */
  checks?: CheckStatus[];
  /** The M33 finish gate refused a FINISH and it was never satisfied. */
  finishGateRefused?: boolean;
  /** A VERIFY step ran without any verifier behind it. */
  verifiedWithoutVerifier?: boolean;
  /** Contract coverage: how many required deliverables have evidence. */
  coverage?: { satisfied: number; required: number };
  hypotheses?: { confirmed: number; rejected: number; open: number };
};

export type DerivedOutcome = { outcome: CapabilityOutcome; reason: string };

/** The rule. Each branch names the claim it refuses to let a run make. */
export function deriveOutcome(evidence: OutcomeEvidence): DerivedOutcome {
  if (evidence.infrastructureError)
    return {
      outcome: "INFRASTRUCTURE_FAILURE",
      reason: evidence.infrastructureError,
    };
  if (evidence.inconclusive)
    return { outcome: "INCONCLUSIVE", reason: evidence.inconclusive };

  const verdicts = evidence.verdicts ?? [];
  const checks = evidence.checks ?? [];
  const failed =
    verdicts.includes("rejected") ||
    checks.includes("failed") ||
    Boolean(evidence.finishGateRefused);
  const coverage = evidence.coverage;
  const partlyCovered =
    coverage !== undefined &&
    coverage.required > 0 &&
    coverage.satisfied > 0 &&
    coverage.satisfied < coverage.required;

  if (!evidence.finished)
    return failed || checks.length || verdicts.length
      ? { outcome: "REJECTED", reason: "no final answer" }
      : { outcome: "REJECTED", reason: "the run did not finish" };

  if (failed) {
    // Saying "done" against failing evidence is worse than failing.
    if (evidence.claimedSuccess)
      return {
        outcome: "FALSE_COMPLETION",
        reason: "claimed success against failing evidence",
      };
    return partlyCovered
      ? { outcome: "PARTIAL", reason: "some deliverables have evidence" }
      : { outcome: "REJECTED", reason: "evidence rejects the result" };
  }

  if (verdicts.includes("conflicted"))
    return { outcome: "INCONCLUSIVE", reason: "verifiers disagree" };

  const positive =
    checks.includes("passed") ||
    (verdicts.length > 0 &&
      verdicts.every((verdict) => verdict === "verified"));
  if (!positive || evidence.verifiedWithoutVerifier) {
    return {
      outcome: "SUCCESS_UNVERIFIED",
      reason: evidence.verifiedWithoutVerifier
        ? "VERIFY ran with no verifier"
        : "no independent evidence",
    };
  }
  if (partlyCovered)
    return { outcome: "PARTIAL", reason: "not every deliverable is verified" };
  return { outcome: "VERIFIED_SUCCESS", reason: "independent evidence" };
}

/** Outcomes that say something about capability; the rest are excluded. */
export function countsAsSample(outcome: CapabilityOutcome) {
  return outcome !== "INFRASTRUCTURE_FAILURE" && outcome !== "INCONCLUSIVE";
}

export function isVerified(outcome: CapabilityOutcome) {
  return outcome === "VERIFIED_SUCCESS";
}

/** Map onto the Experience Engine's existing outcome column. */
export function toExperienceOutcome(
  outcome: CapabilityOutcome,
): ExperienceOutcome {
  switch (outcome) {
    case "VERIFIED_SUCCESS":
      return "verified_success";
    case "SUCCESS_UNVERIFIED":
      return "success";
    case "FALSE_COMPLETION":
      return "false_completion";
    case "PARTIAL":
    case "REJECTED":
      return "failure";
    case "INCONCLUSIVE":
    case "INFRASTRUCTURE_FAILURE":
      return "error";
  }
}

/** Failure class that keeps an excluded outcome out of every statistic. */
export function excludedFailureClass(
  outcome: CapabilityOutcome,
  reason: string,
): string | null {
  if (outcome === "INFRASTRUCTURE_FAILURE")
    return `infra:${slug(reason)}`.slice(0, 80);
  if (outcome === "INCONCLUSIVE")
    return `inconclusive:${slug(reason)}`.slice(0, 80);
  return null;
}

function slug(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

const INFRASTRUCTURE =
  /provider[_:]|rate_limited|insufficient_credit|credential_rejected|not_configured|chromium|browser (?:unavailable|missing|failed to launch)|spawn .* ENOENT|sandbox_unavailable|ECONNRESET|ETIMEDOUT|fetch failed/i;

/** Whether a free-text failure names infrastructure rather than reasoning. */
export function looksLikeInfrastructure(text: string | null | undefined) {
  return Boolean(text && INFRASTRUCTURE.test(text));
}

/**
 * The suites written before this contract report three booleans. Translate
 * them without inventing verification they did not have.
 */
export function outcomeFromFlags(record: {
  success: boolean;
  verifiedSuccess: boolean;
  notes?: string;
}): DerivedOutcome {
  if (!record.success && looksLikeInfrastructure(record.notes))
    return {
      outcome: "INFRASTRUCTURE_FAILURE",
      reason: (record.notes ?? "infrastructure").slice(0, 160),
    };
  if (record.verifiedSuccess)
    return { outcome: "VERIFIED_SUCCESS", reason: "suite grader passed" };
  if (record.success)
    return {
      outcome: "SUCCESS_UNVERIFIED",
      reason: "finished without grader evidence",
    };
  return { outcome: "REJECTED", reason: "suite grader rejected" };
}
