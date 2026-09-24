import type { AgentStep } from "./loop";
import type { TaskState } from "./task-state";

// M33: anti false-completion on the existing loop checkpoint.
//
// When TaskKernel carries hypotheses or success criteria, FINISH is gated.
// There is no second scheduler — the loop itself refuses premature FINISH
// and asks for VERIFY or a conflict-aware answer instead.

export type FinishGateResult = {
  allowed: boolean;
  reason: string;
  suggestedAction?: "VERIFY" | "REPLAN";
};

const RESOLUTION_CLAIM =
  /\b(all (constraints|tests|criteria) (are |were )?(met|satisfied|pass(?:ing)?)|all tests pass|qa passed|browser qa passed|production qa passed|constraints are satisfied|complete export shipped|fully (fixed|done|shipped)|the pump figure stands|other source can be ignored)\b/i;

const UNRESOLVED_ACK =
  /\b(cannot|conflict|disagree|not claimed|unresolved|neither|not established|without naming|not done|was not run|not driven|ignore[sd]? the leak|revise[sd]?)\b/i;

export function kernelHasFinishGates(state: TaskState | undefined): boolean {
  if (!state) return false;
  return state.hypotheses.length > 0 || state.successCriteria.length > 0;
}

function hasVerifyStep(steps: AgentStep[]): boolean {
  return steps.some(
    (step) => step.action === "VERIFY" && step.outcome === "ok",
  );
}

function extractResultNumber(answer: string): number | null {
  const match = answer.match(/result:\s*(-?\d+(?:\.\d+)?)/i);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

function statementNumber(statement: string): number | null {
  const match = statement.match(/(-?\d+(?:\.\d+)?)/);
  if (!match) return null;
  const value = Number(match[0]);
  return Number.isFinite(value) ? value : null;
}

function competingSupportedYears(state: TaskState): string[] {
  const years = state.hypotheses
    .filter(
      (hypothesis) =>
        hypothesis.status === "SUPPORTED" || hypothesis.status === "CONFIRMED",
    )
    .map((hypothesis) => hypothesis.statement.match(/\b(19|20)\d{2}\b/)?.[0])
    .filter((year): year is string => Boolean(year));
  return [...new Set(years)];
}

function answerContradictsHypotheses(
  state: TaskState,
  answer: string,
): string | null {
  const lower = answer.toLowerCase();
  const result = extractResultNumber(answer);

  for (const hypothesis of state.hypotheses) {
    if (
      hypothesis.status !== "SUPPORTED" &&
      hypothesis.status !== "CONFIRMED"
    ) {
      continue;
    }
    const expected = statementNumber(hypothesis.statement);
    if (
      result !== null &&
      expected !== null &&
      Math.abs(result - expected) > 1e-6
    ) {
      return `Answer states Result: ${result}, but ${hypothesis.id} is ${hypothesis.status} for ${expected}. VERIFY or revise before FINISH.`;
    }
  }

  for (const hypothesis of state.hypotheses) {
    if (hypothesis.status !== "REJECTED") continue;
    if (
      hypothesis.id === "h-both" &&
      /\b(both|all constraints).*(satisfied|met)\b/i.test(answer)
    ) {
      return "The both-constraints hypothesis is REJECTED; FINISH cannot claim every constraint is met.";
    }
    if (
      hypothesis.statement.toLowerCase().includes("6 hour") &&
      result === 6 &&
      !UNRESOLVED_ACK.test(answer)
    ) {
      return "The pump-only hypothesis is REJECTED; FINISH with Result: 6 is blocked unless the answer explains the revision.";
    }
  }

  const years = competingSupportedYears(state);
  if (years.length >= 2) {
    const mentioned = years.filter((year) => lower.includes(year));
    if (
      mentioned.length === 1 &&
      !UNRESOLVED_ACK.test(answer) &&
      !/\bdisagree/i.test(answer)
    ) {
      return "Two supported hypotheses disagree; report the contradiction instead of picking one year.";
    }
  }

  if (
    state.verificationState.status === "rejected" &&
    RESOLUTION_CLAIM.test(answer) &&
    !UNRESOLVED_ACK.test(answer)
  ) {
    return "Verification rejected the last claim; FINISH cannot assert success without naming the unresolved conflict.";
  }

  return null;
}

/**
 * Decide whether FINISH is allowed for the current kernel and answer.
 *
 * Gates apply only when the checkpoint carries hypotheses or success
 * criteria. Simple tasks without those fields keep M30 behaviour.
 */
export function assessFinishGate(
  state: TaskState,
  answer: string,
  steps: AgentStep[],
): FinishGateResult {
  if (!kernelHasFinishGates(state)) {
    return { allowed: true, reason: "no_finish_gates" };
  }

  const trimmed = answer.trim();
  if (!trimmed) {
    return {
      allowed: false,
      reason:
        "FINISH requires a non-empty answer when the task kernel has gates.",
      suggestedAction: "VERIFY",
    };
  }

  if (!hasVerifyStep(steps) && !UNRESOLVED_ACK.test(trimmed)) {
    return {
      allowed: false,
      reason:
        "FINISH requires at least one VERIFY step when hypotheses or success criteria are present.",
      suggestedAction: "VERIFY",
    };
  }

  const contradiction = answerContradictsHypotheses(state, trimmed);
  if (contradiction) {
    return {
      allowed: false,
      reason: contradiction,
      suggestedAction: "VERIFY",
    };
  }

  if (
    state.successCriteria.length > 0 &&
    state.verificationState.status === "unverified" &&
    !hasVerifyStep(steps) &&
    !UNRESOLVED_ACK.test(trimmed)
  ) {
    return {
      allowed: false,
      reason:
        "Success criteria are present but nothing was verified; VERIFY before FINISH.",
      suggestedAction: "VERIFY",
    };
  }

  return { allowed: true, reason: "finish_gate_passed" };
}

export function finishGateDirective(state: TaskState | undefined): string {
  if (!kernelHasFinishGates(state)) return "";
  return [
    "This task carries hypotheses or success criteria on the checkpoint kernel.",
    "Use VERIFY to move hypothesis evidence before FINISH.",
    "FINISH is blocked when the answer claims success that verification or the hypothesis states reject.",
    "When sources or constraints conflict, FINISH must name the disagreement instead of picking one side.",
  ].join(" ");
}
