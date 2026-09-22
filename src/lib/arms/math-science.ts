import type { ModelRole } from "../models/provider";
import type { Capability } from "../runtime/types";
import {
  mathCheck,
  secretLeakCheck,
  structureCheck,
} from "../verification/checks";
import { computeEvidenceCheck } from "../verification/compute-evidence";
import { BaseArm } from "./base";
import type { ArmId, ArmStageContext, RoutingInput } from "./types";

const ARITHMETIC =
  /(-?\d+(?:\.\d+)?)\s*([+\-*/×÷])\s*(-?\d+(?:\.\d+)?)\s*=\s*(-?\d+(?:\.\d+)?)/g;

export type ArithmeticClaim = {
  statement: string;
  expected: number;
  stated: number;
  agrees: boolean;
};

/**
 * Re-computes every simple arithmetic identity the answer asserts.
 *
 * This is a genuine independent computation, not a model re-reading itself, so
 * a disagreement is deterministic evidence that the answer is wrong. It only
 * covers two-operand statements -- anything richer needs a solver, and until
 * one exists the engine says "inconclusive" rather than implying it checked.
 */
export function checkArithmetic(answer: string): ArithmeticClaim[] {
  const claims: ArithmeticClaim[] = [];
  for (const match of answer.matchAll(ARITHMETIC)) {
    const left = Number(match[1]);
    const right = Number(match[3]);
    const stated = Number(match[4]);
    if (!Number.isFinite(left) || !Number.isFinite(right)) continue;
    let expected: number;
    switch (match[2]) {
      case "+":
        expected = left + right;
        break;
      case "-":
        expected = left - right;
        break;
      case "*":
      case "×":
        expected = left * right;
        break;
      default:
        if (right === 0) continue;
        expected = left / right;
    }
    const tolerance = Math.max(Math.abs(expected) * 1e-9, 1e-9);
    claims.push({
      statement: match[0],
      expected,
      stated,
      agrees: Math.abs(expected - stated) <= tolerance,
    });
  }
  return claims;
}

export class MathScienceArm extends BaseArm {
  readonly id: ArmId = "math_science";

  canHandle(input: RoutingInput): number {
    const text = input.objective.toLowerCase();
    let score = 0;
    if (
      /\b(math|equation|integral|derivative|matrix|probability|physics|chemistry|proof|prove|theorem|solve|calculate|compute)\b/.test(
        text,
      )
    ) {
      score += 0.55;
    }
    if (/[0-9]\s*[+\-*/^=]\s*[0-9]|\\frac|\\int|\bmol\b|\bjoule/.test(text)) {
      score += 0.25;
    }
    return Math.min(score, 1);
  }

  protected primaryCapability(): Capability {
    return "math_science";
  }

  protected modelRole(): ModelRole {
    return "MATH";
  }

  protected additionalStages() {
    return [
      { key: "parse-problem", name: "Parse the problem", kind: "understand" },
    ];
  }

  protected skillAffinity(): string[] {
    return ["math", "science", "reasoning"];
  }

  protected answerDirectives(): string[] {
    return [
      "Compute every number with the compute.run tool. Never do arithmetic, algebra or unit conversion in your head.",
      "Use op 'dimension' with expectUnit to check a physical result's units before stating it.",
      "Use data.analyze for any table or dataset. For facts or constants you do not know, say they are needed rather than inventing them.",
      "Show the derivation step by step, each step checkable on its own.",
      "End with a line beginning 'Result:' carrying the final answer and its units.",
      "State assumptions explicitly.",
      "Call a derivation a derivation. Do not describe it as a verified or formal proof.",
    ];
  }

  protected checksFor(context: ArmStageContext, answer: string) {
    const claims = checkArithmetic(answer);
    const wrong = claims.filter((claim) => !claim.agrees);

    return [
      structureCheck({
        id: "result-line",
        required: true,
        requiredFields: ["answer"],
        minLength: 20,
      }),
      {
        id: "result-stated",
        type: "STRUCTURE" as const,
        required: true,
        run: () =>
          /^\s*result\s*:/im.test(answer)
            ? {
                status: "passed" as const,
                detail: "Answer states a final result line.",
                evidence: {
                  line: (answer.match(/^\s*result\s*:.*/im) ?? [""])[0].slice(
                    0,
                    300,
                  ),
                },
              }
            : {
                status: "failed" as const,
                detail: "Answer does not state a final 'Result:' line.",
              },
      },
      {
        id: "computed-result",
        type: "MATH" as const,
        required: true,
        run: () =>
          computeEvidenceCheck(
            answer,
            (context.state.toolEvidence as
              Parameters<typeof computeEvidenceCheck>[1] | undefined) ?? [],
          ),
      },
      mathCheck({
        id: "arithmetic",
        method: "numeric",
        required: true,
        agrees: claims.length === 0 ? null : wrong.length === 0,
        expected: wrong[0] ? String(wrong[0].expected) : undefined,
        actual: wrong[0] ? String(wrong[0].stated) : undefined,
        tolerance: 1e-9,
      }),
      {
        id: "not-claimed-as-proof",
        type: "STRUCTURE" as const,
        required: true,
        run: () =>
          /\b(formally verified|machine[- ]checked|proof verified|verified proof)\b/i.test(
            answer,
          )
            ? {
                status: "failed" as const,
                detail:
                  "Answer claims formal verification that this run did not perform.",
              }
            : {
                status: "passed" as const,
                detail: "No unsupported claim of formal verification.",
                evidence: { arithmeticClaimsChecked: claims.length },
              },
      },
      secretLeakCheck(),
    ];
  }
}
