import { executeArmPolicy, type ArmExecution } from "./arm-policy";
import { gradeArm, forbidsTrainedClaim, staticSecurityScan } from "./behavior";
import { quoteNative, type NativeQuote } from "./pricing";
import type { ReasoningTrace } from "./reasoning";
import {
  LOCKED_LOOP_SURFACES,
  type CapabilityArm,
  type ModelProgram,
} from "./types";

/**
 * Fallback uses the selected program's arms, behavior contract, and price
 * card. That is the same path a native answer would be constrained by.
 * It is not a measured equal score, and it is not AGI, ASI, or RSI.
 * `measuredEqual` stays false because this process does not compare the
 * API text to a native benchmark.
 */

export interface FixtureCheck {
  readonly armId: string;
  readonly passed: boolean;
}

export interface ProgramConstraint {
  readonly armIds: readonly string[];
  readonly system: string;
  readonly quote: NativeQuote;
  readonly checks: readonly FixtureCheck[];
  readonly measuredEqual: false;
  readonly budgetNote: string;
  readonly executions: readonly ArmExecution[];
}

const HINTS: readonly {
  readonly pattern: RegExp;
  readonly tokens: readonly string[];
}[] = [
  {
    pattern: /\b(code|function|bug|repo|sql|api)\b/i,
    tokens: ["CODING", "DEBUGGING", "REPOSITORY", "DATABASE", "ARCHITECTURE"],
  },
  {
    pattern: /\b(security|vuln|scan)\b/i,
    tokens: ["SECURITY", "VULNERABILITY"],
  },
  { pattern: /\btests?\b/i, tokens: ["TESTING"] },
  { pattern: /\b(patch|review)\b/i, tokens: ["CODE_REVIEW", "DEBUGGING"] },
  { pattern: /\b(research|source|paper|cite)\b/i, tokens: ["RESEARCH"] },
  { pattern: /\b(math|arithmetic|number)\b/i, tokens: ["MATH"] },
  { pattern: /\b(plan|strategy|roadmap)\b/i, tokens: ["PLANNING", "STRATEGY"] },
  {
    pattern: /\b(verify|verification|prove|judge|correct)\b/i,
    tokens: ["VERIFICATION"],
  },
  { pattern: /\bmemory\b/i, tokens: ["MEMORY"] },
  { pattern: /\btools?\b/i, tokens: ["TOOL"] },
  { pattern: /\b(science|physics)\b/i, tokens: ["SCIENCE"] },
  { pattern: /\bthink(?:ing)?\b/i, tokens: ["THINKING"] },
  {
    pattern: /\b(cyber|security|vuln|scan)\b/i,
    tokens: ["CYBER", "SECURITY", "VULN"],
  },
  { pattern: /\b(terminal|shell|echo)\b/i, tokens: ["TERMINAL"] },
  { pattern: /\blong[- ]horizon\b/i, tokens: ["LONG_HORIZON"] },
  { pattern: /\b(rsi|gradient)\b/i, tokens: ["RSI"] },
  {
    pattern: /\b(math|arithmetic|\d+\s*[+*/-]\s*\d+)\b/i,
    tokens: ["MATH", "LOGIC"],
  },
];

function armTokens(arm: CapabilityArm): string {
  return arm.id.toUpperCase();
}

/** Route the request onto this program's capability arms. At most three. */
export function selectArms(
  program: Pick<ModelProgram, "arms">,
  text: string,
): readonly CapabilityArm[] {
  const matched = program.arms.filter((arm) => {
    const id = armTokens(arm);
    return HINTS.some(
      (hint) =>
        hint.pattern.test(text) &&
        hint.tokens.some((token) => id.includes(token)),
    );
  });
  const chosen = (matched.length ? matched : program.arms.slice(0, 1)).slice(
    0,
    3,
  );
  return chosen;
}

export function programSystem(input: {
  program: ModelProgram;
  arms: readonly CapabilityArm[];
  trace: ReasoningTrace;
  executions?: readonly ArmExecution[];
}): string {
  const objectives = input.program.objectives
    .map((item) => item.statement)
    .join(" ");
  const arms = input.arms
    .map((arm) => `${arm.id}: ${arm.task.instruction}`)
    .join(" | ");
  return [
    `You are answering inside the ${input.program.displayName} program (${input.program.id}).`,
    `This reply is API fallback for that program, not the native checkpoint ${input.program.nativeModelId}.`,
    "Do not claim to be the trained native model. Do not claim AGI, ASI, RSI, or a benchmark score. Those are targets, not results.",
    `Behavior: ${objectives}`,
    `Active capability arms: ${arms}`,
    `Program phases already recorded: ${input.trace.phases.join(", ") || "none"}.`,
    `Arm steps already run: ${(input.executions ?? []).flatMap((item) => item.steps).join(" | ") || "none"}.`,
    `Do not change locked surfaces: ${LOCKED_LOOP_SURFACES.join(", ")}.`,
    input.trace.outsideProgram ? input.trace.note : "",
  ]
    .filter((line) => line.length > 0)
    .join("\n");
}

/**
 * Eval hook for the selected arms' own fixtures. The API text is not graded
 * as a native score. `measuredEqual` is false on purpose.
 */
export function runFixtureEvalHook(arms: readonly CapabilityArm[]): {
  readonly measuredEqual: false;
  readonly checks: readonly FixtureCheck[];
} {
  return {
    measuredEqual: false,
    checks: arms.map((arm) => {
      const sample = arm.dataset.samples[0];
      if (!sample) return { armId: arm.id, passed: false };
      return {
        armId: arm.id,
        passed: gradeArm(arm.task.grader, sample).passed,
      };
    }),
  };
}

const BENCHMARK_CLAIM =
  /native benchmark|equal to the native|matches the native model|\bAGI\b|\bASI\b|recursive self-improvement/i;
const LOCKED_CLAIM =
  /changed (evaluation_integrity|security_boundary|budget_limit|approval_gate|trust_root)/i;

export function applyBehaviorGate(
  program: Pick<ModelProgram, "id" | "displayName">,
  text: string,
): {
  readonly text: string;
  readonly withheld: boolean;
  readonly reasons: readonly string[];
} {
  const reasons: string[] = [];
  const claim = forbidsTrainedClaim(text, program.displayName);
  if (claim) reasons.push(claim);
  if (BENCHMARK_CLAIM.test(text)) {
    reasons.push("unmeasured benchmark or identity claim");
  }
  if (LOCKED_CLAIM.test(text)) reasons.push("locked surface claim");
  const findings = staticSecurityScan(text);
  if (findings.length) reasons.push(`security scan: ${findings.join(",")}`);
  if (!reasons.length) return { text, withheld: false, reasons };
  if (reasons.length === 1 && claim) {
    return {
      text: "The fallback text was withheld because it described itself as the native model. No checkpoint was used.",
      withheld: true,
      reasons,
    };
  }
  return {
    text: "The fallback text was withheld by the selected program's behavior gate. No checkpoint was used, and no benchmark equality was measured.",
    withheld: true,
    reasons,
  };
}

export function constrainProgram(input: {
  program: ModelProgram;
  trace: ReasoningTrace;
  text: string;
  inputTokens: number;
  outputTokens: number;
}): ProgramConstraint {
  const arms = selectArms(input.program, input.text);
  const executions = arms.map((arm) => executeArmPolicy(arm, input.text));
  const hook = runFixtureEvalHook(arms);
  const quote = quoteNative(
    input.program.id,
    input.inputTokens,
    input.outputTokens,
  );
  const budgetNote =
    quote.eurInput > 0
      ? "Program card recorded. EUR is not converted into the USD budget and is not billed. Same card, not a measured cost match."
      : "Program card recorded. The USD figure is not charged on API fallback. Same card, not a measured cost match.";
  return {
    armIds: arms.map((arm) => arm.id),
    system: programSystem({
      program: input.program,
      arms,
      trace: input.trace,
      executions,
    }),
    quote,
    checks: hook.checks,
    measuredEqual: false,
    budgetNote,
    executions,
  };
}
