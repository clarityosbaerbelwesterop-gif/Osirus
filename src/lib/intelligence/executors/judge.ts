import { extractNumber } from "../evals/math-tasks";
import type { TaskVerify, TrialResult } from "../types";

// The independent judge of a trial. The agent's own verdict is recorded but
// never trusted as the label: coding trials are judged by the hidden test
// suite run in the workspace after the agent finished, quantitative trials by
// the computed answer, text trials by required and forbidden content.

export type RunEvidence = {
  status: "completed" | "failed";
  answer: string;
  verdicts: string[];
  hiddenCheck: { exitCode: number | null; output: string } | null;
  notes: string[];
};

export function judge(verify: TaskVerify, run: RunEvidence) {
  switch (verify.kind) {
    case "tests": {
      if (!run.hiddenCheck)
        return {
          passed: false,
          detail:
            run.status === "completed"
              ? "The hidden tests never ran: no workspace reached the check stage."
              : "The run failed before the hidden tests could run.",
        };
      const passed = run.hiddenCheck.exitCode === 0;
      return {
        passed,
        detail: passed
          ? "Hidden and visible tests pass."
          : `Hidden tests fail (exit ${run.hiddenCheck.exitCode ?? "none"}): ${run.hiddenCheck.output.slice(-300)}`,
      };
    }
    case "numeric": {
      const value = extractNumber(run.answer);
      if (value === null)
        return { passed: false, detail: "No numeric answer." };
      const tolerance = Math.max(
        verify.tolerance,
        Math.abs(verify.value) * 1e-6,
      );
      const passed = Math.abs(value - verify.value) <= tolerance;
      return {
        passed,
        detail: passed
          ? `Answer ${value} matches ${verify.value}.`
          : `Answer ${value} is not ${verify.value} (±${verify.tolerance}).`,
      };
    }
    case "includes": {
      const lower = run.answer.toLowerCase();
      const missing = verify.all.filter(
        (text) => !lower.includes(text.toLowerCase()),
      );
      const forbidden = (verify.none ?? []).filter((text) =>
        lower.includes(text.toLowerCase()),
      );
      const passed = missing.length === 0 && forbidden.length === 0;
      return {
        passed,
        detail: passed
          ? "Required content present, forbidden content absent."
          : `Missing: ${missing.join(", ") || "none"}; forbidden: ${forbidden.join(", ") || "none"}.`,
      };
    }
  }
}

const PROVIDER_FAILURES = [
  "insufficient_credit",
  "rate_limited",
  "provider_unavailable",
  "credential_rejected",
  "model_not_configured",
  "timeout",
];

/** A short failure class for experience and gap analysis. */
export function failureClassOf(
  verify: TaskVerify,
  run: RunEvidence,
  check: { passed: boolean },
): string | null {
  if (check.passed) return null;
  const notes = run.notes.join(" ");
  const provider = PROVIDER_FAILURES.find((code) => notes.includes(code));
  if (provider) return `provider:${provider}`;
  if (run.status === "failed") {
    const stage = notes.match(/(\S+) failed: ([a-z_]+)/);
    return stage ? `stage:${stage[2]}` : "stage:failed";
  }
  if (verify.kind === "tests") {
    if (!run.hiddenCheck) return "no_workspace_check";
    if (/SyntaxError|ReferenceError|TypeError/.test(run.hiddenCheck.output))
      return "runtime_error";
    return "wrong_fix";
  }
  if (verify.kind === "numeric")
    return extractNumber(run.answer) === null ? "no_answer" : "wrong_answer";
  return "content_mismatch";
}

export function trialResultFrom(input: {
  verify: TaskVerify;
  run: RunEvidence;
  costUsd: number;
  tokens: number;
  latencyMs: number;
  modelCalls: number;
  toolCalls: number;
  repairs: number;
}): TrialResult {
  const check = judge(input.verify, input.run);
  return {
    success: input.run.status === "completed",
    verified: check.passed,
    // The agent finished and reported a result, but the independent check
    // says it is wrong: the most expensive failure there is.
    falseCompletion: input.run.status === "completed" && !check.passed,
    failureClass: failureClassOf(input.verify, input.run, check),
    costUsd: input.costUsd,
    tokens: input.tokens,
    latencyMs: input.latencyMs,
    modelCalls: input.modelCalls,
    toolCalls: input.toolCalls,
    repairs: input.repairs,
    verdicts: input.run.verdicts,
    notes: input.run.notes.slice(0, 12),
    answerExcerpt: input.run.answer.slice(0, 600),
    check,
  };
}
