import type { Activity, ModelId, ModelProgram } from "./types";

export type ProgramScope = "general" | "code" | "broad";

export interface ReasoningTrace {
  readonly modelId: ModelId;
  readonly scope: ProgramScope;
  readonly outsideProgram: boolean;
  readonly phases: readonly Activity[];
  readonly note: string;
}

const CODE =
  /\b(code|function|bug|test|sql|repo|patch|vuln|security|deploy|api)\b/i;
const RESEARCH = /\b(research|source|paper|cite)\b/i;
const VERIFY = /\b(verify|check|prove|correct)\b/i;
const PLAN = /\b(plan|strategy|roadmap)\b/i;
const CROSS = /\b(across|synthesis|domain|compare)\b/i;

function keep(
  program: Pick<ModelProgram, "ui">,
  phase: Activity,
): Activity | null {
  return program.ui.activities.includes(phase) ? phase : null;
}

/**
 * Real policy steps for a model program. These are not a spinner and not
 * a claim that a frontier model ran. The caller shows `phases` only as
 * steps that already finished, and shows waiting / api_fallback /
 * native_inference for the inference itself.
 */
export function runReasoningPolicy(
  program: Pick<ModelProgram, "id" | "ui">,
  text: string,
): ReasoningTrace {
  const phases: Activity[] = [];
  const push = (phase: Activity) => {
    const allowed = keep(program, phase);
    if (allowed) phases.push(allowed);
  };
  if (program.id === "quasnir") {
    const outside = text.trim().length > 0 && !CODE.test(text);
    push("code_analysis");
    if (VERIFY.test(text) || /\btest\b/i.test(text)) push("test_execution");
    if (/\b(security|vuln|scan)\b/i.test(text)) push("security_scan");
    if (/\bpatch\b/i.test(text)) push("patch_verification");
    return {
      modelId: "quasnir",
      scope: "code",
      outsideProgram: outside,
      phases,
      note: outside
        ? "QUASNIR covers code, logic, and security only. This request is outside that program."
        : "QUASNIR policy ran on the request text. It is not a trained coder.",
    };
  }
  if (program.id === "darus") {
    push("deep_reasoning");
    if (CROSS.test(text)) push("cross_domain_synthesis");
    if (RESEARCH.test(text)) push("research");
    if (PLAN.test(text)) push("planning");
    return {
      modelId: "darus",
      scope: "broad",
      outsideProgram: false,
      phases,
      note: "Darus policy is a broad-track hypothesis, not a measured result.",
    };
  }
  push("thinking");
  if (VERIFY.test(text)) push("verification");
  else if (RESEARCH.test(text)) push("research");
  else push("reasoning");
  return {
    modelId: "rouge",
    scope: "general",
    outsideProgram: false,
    phases,
    note: "Rouge policy classified the request. It is not a trained frontier model.",
  };
}
