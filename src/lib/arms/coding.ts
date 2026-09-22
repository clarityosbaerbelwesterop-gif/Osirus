import type { ModelRole } from "../models/provider";
import type { Capability } from "../runtime/types";
import {
  commandCheck,
  secretLeakCheck,
  structureCheck,
} from "../verification/checks";
import { BaseArm } from "./base";
import type { ArmId, ArmStageContext, RoutingInput } from "./types";

type CommandEvidence = {
  command: string;
  exitCode: number | null;
  stdout?: string;
  stderr?: string;
};

const FENCE = /```([a-z0-9+#.-]*)\n([\s\S]*?)```/g;

export function extractCodeBlocks(answer: string) {
  const blocks: Array<{ language: string; code: string }> = [];
  for (const match of answer.matchAll(FENCE)) {
    blocks.push({ language: match[1] || "text", code: match[2] ?? "" });
  }
  return blocks;
}

/**
 * Code produced by this arm is not verified until something runs it.
 *
 * The test and build checks below are required and return "inconclusive" while
 * no sandbox is configured, which caps the verdict at "unverified". That is
 * deliberate: a coding result that compiles in nobody's environment has not
 * been shown to work, and the engine must not report it as though it had.
 */
export class CodingArm extends BaseArm {
  readonly id: ArmId = "coding";

  canHandle(input: RoutingInput): number {
    const text = input.objective.toLowerCase();
    let score = 0;
    if (
      /\b(code|function|class|refactor|bug|stack ?trace|compile|typescript|javascript|python|rust|go|sql|api|endpoint|implement|patch|diff)\b/.test(
        text,
      )
    ) {
      score += 0.5;
    }
    if (/```|\bnpm\b|\byarn\b|\bpytest\b|\bcargo\b|\bgit\b/.test(text)) {
      score += 0.25;
    }
    if (/\b(write|fix|add|change|migrate|rename|test)\b/.test(text)) {
      score += 0.15;
    }
    return Math.min(score, 1);
  }

  protected primaryCapability(): Capability {
    return "coding";
  }

  protected modelRole(): ModelRole {
    return "CODING";
  }

  protected additionalStages() {
    return [
      {
        key: "ground-task",
        name: "Ground the coding task",
        kind: "understand",
      },
    ];
  }

  protected answerDirectives(): string[] {
    return [
      "Produce the code the task asks for, in fenced blocks tagged with the language.",
      "Name the file path each block belongs to immediately above it.",
      "State explicitly which tests or builds you did NOT run; never imply code was executed.",
      "Prefer the smallest change that satisfies the task over a rewrite.",
    ];
  }

  protected checksFor(context: ArmStageContext, answer: string) {
    const blocks = extractCodeBlocks(answer);
    const testResult = context.state.testResult as CommandEvidence | undefined;
    const buildResult = context.state.buildResult as
      CommandEvidence | undefined;

    return [
      structureCheck({
        id: "code-present",
        required: true,
        requiredFields: ["answer"],
        minLength: 20,
      }),
      {
        id: "code-blocks",
        type: "STRUCTURE" as const,
        required: true,
        run: () =>
          blocks.length > 0
            ? {
                status: "passed" as const,
                detail: `Answer contains ${blocks.length} fenced code block(s).`,
                evidence: {
                  languages: blocks.map((block) => block.language),
                  bytes: blocks.reduce(
                    (total, block) => total + block.code.length,
                    0,
                  ),
                },
              }
            : {
                status: "failed" as const,
                detail: "A coding answer must contain at least one code block.",
              },
      },
      {
        id: "json-blocks-parse",
        type: "STRUCTURE" as const,
        required: false,
        run: () => {
          const jsonBlocks = blocks.filter(
            (block) => block.language.toLowerCase() === "json",
          );
          if (jsonBlocks.length === 0) {
            return {
              status: "inconclusive" as const,
              detail: "No JSON blocks to parse.",
            };
          }
          const broken: string[] = [];
          for (const [index, block] of jsonBlocks.entries()) {
            try {
              JSON.parse(block.code);
            } catch (error) {
              broken.push(
                `block ${index + 1}: ${
                  error instanceof Error ? error.message : "parse error"
                }`,
              );
            }
          }
          return broken.length === 0
            ? {
                status: "passed" as const,
                detail: `${jsonBlocks.length} JSON block(s) parse.`,
                evidence: { blocks: jsonBlocks.length },
              }
            : {
                status: "failed" as const,
                detail: `Malformed JSON: ${broken.join("; ")}.`,
                evidence: { broken },
              };
        },
      },
      commandCheck({
        id: "tests",
        type: "TEST",
        required: true,
        result: testResult ?? null,
      }),
      commandCheck({
        id: "build",
        type: "BUILD",
        required: true,
        result: buildResult ?? null,
      }),
      secretLeakCheck(),
    ];
  }
}
