import { checkArithmetic } from "../arms/math-science";
import type { CheckOutcome, VerificationCheck } from "../verification/engine";
import { computeEvidenceCheck } from "../verification/compute-evidence";
import type { ProblemFormalization } from "./formalization";
import { underdeterminedFailureDetail } from "./formalization";

// M37 — Verification gates before FINISH.
//
// Sanity checks (sign, magnitude, domain), recomputation against tool
// evidence, and counterexample awareness for universal claims. These reuse
// the existing verification engine — no second evaluator.

type ComputeEvidence = {
  toolId: string;
  ok: boolean;
  input?: unknown;
  data?: unknown;
};

const UNIVERSAL_CLAIM =
  /\b(for all|forall|every|always|never|in general|universally|any\s+\w+\s+such that|proven for all)\b/i;
const COUNTEREXAMPLE_ATTEMPT =
  /\bcounterexample|counter-example|tested (?:at|for|with)|checked (?:at|for|edge case)|falsif/i;

function numbersIn(text: string): number[] {
  const values: number[] = [];
  for (const match of text.matchAll(/-?\d+(?:\.\d+)?(?:e[-+]?\d+)?/gi)) {
    const value = Number(match[0]);
    if (Number.isFinite(value)) values.push(value);
  }
  return values;
}

/** Order-of-magnitude and domain sanity on stated results. */
export function sanityGateCheck(
  answer: string,
  formalization?: ProblemFormalization,
): CheckOutcome {
  const line = answer.match(/^\s*result\s*:(.*)$/im)?.[1]?.trim();
  if (!line) {
    return {
      status: "inconclusive",
      detail: "No Result: line to sanity-check.",
    };
  }
  const values = numbersIn(line);
  if (values.length === 0) {
    return {
      status: "inconclusive",
      detail: "Result line has no numeric value to sanity-check.",
    };
  }
  const failures: string[] = [];
  for (const value of values) {
    if (!Number.isFinite(value)) failures.push("non-finite value in Result:");
    if (/\bprobability|chance|fraction\b/i.test(answer) && (value < 0 || value > 1)) {
      failures.push(`probability-like result ${value} outside [0, 1]`);
    }
    if (/\bheight|distance|length|metres?\b/i.test(answer) && value < 0) {
      failures.push(`non-negative quantity reported as ${value}`);
    }
    if (/\btime|seconds?\b/i.test(answer) && value < 0) {
      failures.push(`time reported as negative (${value})`);
    }
    if (Math.abs(value) > 1e15) {
      failures.push(`magnitude ${value} exceeds plausible bound 1e15`);
    }
  }
  if (formalization?.underdetermined) {
    const failure = underdeterminedFailureDetail(formalization, answer);
    if (failure) {
      return { status: "failed", detail: failure };
    }
  }
  return failures.length
    ? {
        status: "failed",
        detail: `Sanity check failed: ${failures.join("; ")}.`,
        evidence: { failures },
      }
    : {
        status: "passed",
        detail: "Stated result passes numeric sanity checks.",
        evidence: { values },
      };
}

/** Recompute simple arithmetic identities and tie to compute.run evidence. */
export function recomputationGateCheck(
  answer: string,
  evidence: ComputeEvidence[],
): CheckOutcome {
  const arithmetic = checkArithmetic(answer);
  const wrong = arithmetic.filter((claim) => !claim.agrees);
  if (wrong.length > 0) {
    return {
      status: "failed",
      detail: `Arithmetic recomputation disagrees: ${wrong[0]!.statement} (expected ${wrong[0]!.expected}, stated ${wrong[0]!.stated}).`,
      evidence: { wrong: wrong.slice(0, 3) },
    };
  }
  const compute = computeEvidenceCheck(answer, evidence);
  if (compute.status === "failed") return compute;
  if (compute.status === "inconclusive" && arithmetic.length === 0) {
    return compute;
  }
  return {
    status: "passed",
    detail: [
      arithmetic.length
        ? `${arithmetic.length} inline arithmetic identity(ies) recomputed.`
        : "No inline arithmetic to recompute.",
      compute.detail,
    ].join(" "),
    evidence: compute.evidence,
  };
}

/** Universal claims need counterexample search or explicit qualification. */
export function counterexampleGateCheck(
  answer: string,
  formalization?: ProblemFormalization,
): CheckOutcome {
  const claimsUniversal =
    UNIVERSAL_CLAIM.test(answer) ||
    Boolean(formalization?.needsCounterexampleSearch);
  if (!claimsUniversal) {
    return {
      status: "passed",
      detail: "No universal claim requiring counterexample search.",
    };
  }
  if (COUNTEREXAMPLE_ATTEMPT.test(answer)) {
    return {
      status: "passed",
      detail: "Universal claim is qualified or a counterexample search is recorded.",
    };
  }
  if (
    /\bfor all\b/i.test(answer) &&
    /\bprovided that|when\b/i.test(answer) &&
    !/\bproven for all\b/i.test(answer)
  ) {
    return {
      status: "passed",
      detail: "Universal claim is explicitly conditional.",
    };
  }
  return {
    status: "failed",
    detail:
      "Answer asserts universality without recording counterexample search or stating conditions.",
  };
}

export function mathScienceVerificationGates(input: {
  answer: string;
  toolEvidence: ComputeEvidence[];
  formalization?: ProblemFormalization;
}): VerificationCheck[] {
  const { answer, toolEvidence, formalization } = input;
  return [
    {
      id: "sanity-gate",
      type: "MATH",
      required: true,
      run: () => sanityGateCheck(answer, formalization),
    },
    {
      id: "recomputation-gate",
      type: "MATH",
      required: true,
      run: () => recomputationGateCheck(answer, toolEvidence),
    },
    {
      id: "counterexample-gate",
      type: "MATH",
      required: Boolean(formalization?.needsCounterexampleSearch),
      run: () => counterexampleGateCheck(answer, formalization),
    },
    {
      id: "underdetermined-honesty",
      type: "STRUCTURE",
      required: Boolean(formalization?.underdetermined),
      run: () => {
        if (!formalization?.underdetermined) {
          return {
            status: "passed",
            detail: "Problem is not underdetermined.",
          };
        }
        const failure = underdeterminedFailureDetail(formalization, answer);
        return failure
          ? { status: "failed", detail: failure }
          : {
              status: "passed",
              detail: "Underdetermined problem reported honestly.",
            };
      },
    },
  ];
}
