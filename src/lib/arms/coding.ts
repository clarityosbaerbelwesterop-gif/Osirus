import type { ModelRole } from "../models/provider";
import {
  defineNode,
  validateGraph,
  type WorkflowGraph,
} from "../runtime/graph";
import type { Capability } from "../runtime/types";
import {
  commandCheck,
  secretLeakCheck,
  structureCheck,
} from "../verification/checks";
import { BaseArm } from "./base";
import type {
  ArmId,
  ArmStageContext,
  RoutingInput,
  StageOutcome,
} from "./types";

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

const PATH_LINE =
  /(?:^|\n)[^\n]{0,80}?[`*\s(]((?:[\w.-]+\/)*[\w.-]+\.[a-z0-9]{1,8})[`*\s):]{0,3}[^\n]{0,20}\n+```/gi;

/**
 * Pair each code block with the file path named above it.
 *
 * The answering stage is told to name the path immediately above each block.
 * A block with no path is still returned, under a generated name, because
 * dropping it would quietly reduce what gets checked.
 */
export function extractFiles(answer: string) {
  const blocks = extractCodeBlocks(answer);
  const paths: string[] = [];
  for (const match of answer.matchAll(PATH_LINE)) {
    if (match[1]) paths.push(match[1]);
  }
  return blocks.map((block, index) => ({
    path: paths[index] ?? `generated/block-${index + 1}.${block.language}`,
    content: block.code,
    language: block.language,
  }));
}

/** Languages a syntax check exists for in the sandbox image. */
const SYNTAX_CHECKS: Array<[RegExp, (path: string) => [string, string[]]]> = [
  [/\.(js|mjs|cjs)$/i, (path) => ["node", ["--check", path]]],
  [/\.py$/i, (path) => ["python3", ["-m", "py_compile", path]]],
];

export function syntaxCheckFor(path: string) {
  for (const [pattern, build] of SYNTAX_CHECKS) {
    if (pattern.test(path)) return build(path);
  }
  return null;
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

  buildWorkflow(): WorkflowGraph {
    const base = super.buildWorkflow();
    // The check stage sits between answering and verifying: the verifier reads
    // its result, so it has to have run first.
    const nodes = base.nodes.map((node) =>
      node.key === "verify"
        ? defineNode({ ...node, dependsOn: ["check-code"] })
        : node,
    );
    nodes.push(
      defineNode({
        key: "check-code",
        name: "Check the generated code",
        capability: "coding",
        dependsOn: ["answer"],
        // Failing to check is not failing the run: the verifier reports the
        // result as inconclusive and the verdict lands at unverified.
        failurePolicy: "continue",
        retryPolicy: { maxAttempts: 1, maxSlices: 2 },
        input: { stageKind: "check_code", armId: this.id },
      }),
    );
    const graph = { nodes };
    validateGraph(graph);
    return graph;
  }

  protected async customStage(context: ArmStageContext) {
    if ((context.work.stageInput.stageKind as string) !== "check_code") {
      return super.customStage(context);
    }
    return this.checkCodeStage(context);
  }

  /**
   * Run the generated code through a real checker.
   *
   * With no sandbox configured every result carries a null exit code, which
   * the verification engine reads as inconclusive -- so the verdict is
   * "unverified", never "verified". Nothing here reports success for code that
   * was not executed.
   */
  private async checkCodeStage(
    context: ArmStageContext,
  ): Promise<StageOutcome> {
    const answer = (context.state.answer as string | undefined) ?? "";
    const files = extractFiles(answer).filter((file) =>
      Boolean(syntaxCheckFor(file.path)),
    );

    const { resolveSandbox, unavailableResult } = await import("../sandbox");
    const driver = await resolveSandbox();
    const availability = driver.availability();

    if (!availability.configured) {
      await context.runtime.activity(
        "sandbox.not_configured",
        "Generated code was not executed",
        { reason: availability.reason },
      );
      const result = unavailableResult("syntax check", availability.reason);
      context.state.buildResult = result;
      context.state.testResult = result;
      return {
        kind: "COMPLETE",
        output: {
          sandbox: "NOT_CONFIGURED",
          reason: availability.reason,
          candidateFiles: files.length,
        },
      };
    }

    if (files.length === 0) {
      const result = unavailableResult(
        "syntax check",
        "No file in the answer is in a language this run can check.",
      );
      context.state.buildResult = result;
      context.state.testResult = result;
      return {
        kind: "COMPLETE",
        output: { sandbox: availability.driver, checkedFiles: 0 },
      };
    }

    const sandbox = await driver.create({
      timeoutMs: 120_000,
      signal: context.signal,
    });
    try {
      await sandbox.writeFiles(
        files.map((file) => ({ path: file.path, content: file.content })),
      );
      const failures: CommandEvidence[] = [];
      let last: CommandEvidence | null = null;
      for (const file of files) {
        const check = syntaxCheckFor(file.path);
        if (!check) continue;
        const [cmd, args] = check;
        const result = await sandbox.runCommand({
          cmd,
          args,
          timeoutMs: 30_000,
          signal: context.signal,
        });
        last = result;
        if (result.exitCode !== 0) failures.push(result);
      }
      context.state.buildResult = failures[0] ?? last;
      await context.runtime.activity(
        failures.length > 0 ? "sandbox.check_failed" : "sandbox.check_passed",
        failures.length > 0
          ? `${failures.length} generated file(s) failed a syntax check`
          : `${files.length} generated file(s) parse`,
        { driver: availability.driver, checked: files.length },
      );
      return {
        kind: "COMPLETE",
        output: {
          sandbox: availability.driver,
          checkedFiles: files.length,
          failed: failures.length,
        },
      };
    } finally {
      await sandbox.stop();
    }
  }

  protected skillAffinity(): string[] {
    return ["engineering", "code", "testing", "debugging"];
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
