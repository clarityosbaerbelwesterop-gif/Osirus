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
import { BaseArm, readState } from "./base";
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

/** What the run state remembers about the workspace between stages. */
export type WorkspaceState =
  | { status: "NOT_CONFIGURED" | "FAILED" | "LOST"; reason: string }
  | {
      status: "ready" | "stopped";
      driver: string;
      handle: string;
      repository: string | null;
      branch: string | null;
      commands: import("../coding/commands").DiscoveredCommand[];
      languages: string[];
      frameworks: string[];
    };

const CLAIMS_TESTS_PASS =
  /\b(all )?(the )?tests? (now )?(pass(es|ed|ing)?|are (green|passing)|succeed(ed|s)?)\b|\btests? (run )?green\b/i;
const CLAIMS_BUILD_PASS =
  /\bbuild (now )?(pass(es|ed)?|succeed(s|ed)?|is green|works)\b|\bbuilds? (cleanly|successfully)\b/i;

/**
 * The coding arm works in a real repository.
 *
 * With a sandbox, the run gets a persistent workspace: the repository is
 * cloned (or initialised), mapped, and its own commands discovered; the agent
 * loop inspects, edits and runs them; then the repository's checks run once
 * more, independently of anything the model said, and their exit codes are
 * the test and build evidence. Without a sandbox the arm still answers, and
 * the required test and build checks come back inconclusive -- the verdict
 * is "unverified", because code nobody ran has not been shown to work.
 */
export class CodingArm extends BaseArm {
  readonly id: ArmId = "coding";

  canHandle(input: RoutingInput): number {
    const text = input.objective.toLowerCase();
    let score = 0;
    if (
      /\b(code|function|class|refactor|bug|stack ?trace|compile|typescript|javascript|python|rust|go|sql|api|endpoint|implement|patch|diff|repo(sitory)?)\b/.test(
        text,
      )
    ) {
      score += 0.5;
    }
    if (
      /```|\bnpm\b|\byarn\b|\bpytest\b|\bcargo\b|\bgit\b|github\.com\//.test(
        text,
      )
    ) {
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

  protected loopBounds() {
    return {
      maxSteps: 30,
      maxModelCalls: 32,
      maxToolCalls: 28,
      maxWallMs: 200_000,
      maxConsecutiveFailures: 4,
      yieldOnWallClock: true,
    };
  }

  buildWorkflow(): WorkflowGraph {
    const base = super.buildWorkflow();
    // open-workspace -> answer -> run-checks -> finalize-workspace -> verify.
    // The verifier reads the checks' exit codes, so they run before it; the
    // workspace is stopped (files kept) before verification so a slow verify
    // does not hold a VM.
    const nodes = base.nodes.map((node) => {
      if (node.key === "answer")
        return defineNode({ ...node, dependsOn: ["open-workspace"] });
      if (node.key === "verify")
        return defineNode({ ...node, dependsOn: ["finalize-workspace"] });
      return node;
    });
    nodes.push(
      defineNode({
        key: "open-workspace",
        name: "Open the coding workspace",
        capability: "coding",
        dependsOn: [this.additionalStages().at(-1)?.key ?? "plan"],
        // No workspace is not a failed run: the answer proceeds without one
        // and the verdict is capped at unverified.
        failurePolicy: "continue",
        retryPolicy: { maxAttempts: 2, maxSlices: 3 },
        input: { stageKind: "open_workspace", armId: this.id },
      }),
      defineNode({
        key: "run-checks",
        name: "Run the repository's checks",
        capability: "coding",
        dependsOn: ["answer"],
        failurePolicy: "continue",
        retryPolicy: { maxAttempts: 1, maxSlices: 3 },
        input: { stageKind: "run_checks", armId: this.id },
      }),
      defineNode({
        key: "finalize-workspace",
        name: "Save and stop the workspace",
        capability: "coding",
        dependsOn: ["run-checks"],
        failurePolicy: "continue",
        retryPolicy: { maxAttempts: 2, maxSlices: 2 },
        input: { stageKind: "finalize_workspace", armId: this.id },
      }),
    );
    const graph = { nodes };
    validateGraph(graph);
    return graph;
  }

  protected async customStage(context: ArmStageContext) {
    switch (context.work.stageInput.stageKind as string) {
      case "open_workspace":
        return this.openWorkspaceStage(context);
      case "run_checks":
        return this.runChecksStage(context);
      case "finalize_workspace":
        return this.finalizeWorkspaceStage(context);
      case "check_code":
        return this.checkCodeStage(context);
      default:
        return super.customStage(context);
    }
  }

  protected async workspaceStore(context: ArmStageContext) {
    const { DbWorkspaceStore } = await import("../coding/db-store");
    return new DbWorkspaceStore(context.identity.userId);
  }

  /** Reattach to this run's workspace, or null when there is none to use. */
  protected async reopen(context: ArmStageContext) {
    const state = readState<WorkspaceState | null>(context, "workspace", null);
    if (!state || (state.status !== "ready" && state.status !== "stopped"))
      return null;
    const { resolveSandbox } = await import("../sandbox");
    const driver = await resolveSandbox();
    if (!driver.availability().configured || !driver.reattach) return null;
    const { WorkspaceSession } = await import("../coding/session");
    const store = await this.workspaceStore(context);
    const record = await store.load(context.work.runId);
    if (!record) return null;
    const handle = await driver.reattach(record.handle);
    if (!handle) {
      context.state.workspace = {
        status: "LOST",
        reason: "The workspace sandbox no longer exists.",
      } satisfies WorkspaceState;
      return null;
    }
    return WorkspaceSession.attach(handle, record, store);
  }

  protected async openWorkspaceStage(
    context: ArmStageContext,
  ): Promise<StageOutcome> {
    const { resolveSandbox } = await import("../sandbox");
    const driver = await resolveSandbox();
    const availability = driver.availability();
    if (!availability.configured) {
      context.state.workspace = {
        status: "NOT_CONFIGURED",
        reason: availability.reason,
      } satisfies WorkspaceState;
      await context.runtime.activity(
        "workspace.not_configured",
        "No coding workspace: hosted execution is not configured here",
        { reason: availability.reason },
      );
      return {
        kind: "COMPLETE",
        output: { workspace: "NOT_CONFIGURED", reason: availability.reason },
      };
    }

    const { WorkspaceSession, repositoryInObjective } =
      await import("../coding/session");
    const repository = repositoryInObjective(context.work.objective);
    let readToken: string | null = null;
    if (repository) {
      const { githubCredential } = await import("../connectors/github");
      readToken = await githubCredential(
        {
          userId: context.identity.userId,
          organizationId: context.identity.organizationId,
          workspaceId: context.identity.workspaceId,
        },
        "repo:read",
      ).catch(() => null);
    }
    try {
      const { session, created } = await WorkspaceSession.open({
        driver,
        store: await this.workspaceStore(context),
        runId: context.work.runId,
        repository,
        readToken,
        signal: context.signal,
      });
      const map = session.record.repositoryMap;
      context.state.workspace = {
        status: "ready",
        driver: driver.id,
        handle: session.record.handle,
        repository: session.record.repository,
        branch: session.record.branch,
        commands: session.commands,
        languages: (map?.languages ?? []).map((entry) => entry.language),
        frameworks: map?.frameworks ?? [],
      } satisfies WorkspaceState;
      await context.runtime.activity(
        created ? "workspace.opened" : "workspace.resumed",
        repository
          ? `Workspace ready with ${repository}`
          : "Workspace ready with a new repository",
        {
          driver: driver.id,
          commands: session.commands.map(
            (command) =>
              `${command.phase}: ${command.cmd} ${command.args.join(" ")}`,
          ),
          frameworks: map?.frameworks ?? [],
        },
        "user",
      );
      await session.workspace.handle
        .keepAlive?.(10 * 60 * 1000)
        .catch(() => undefined);
      return {
        kind: "COMPLETE",
        output: {
          workspace: "ready",
          driver: driver.id,
          repository,
          commands: session.commands.length,
          fileCount: map?.fileCount ?? 0,
        },
      };
    } catch (error) {
      const reason = error instanceof Error ? error.message : "open_failed";
      context.state.workspace = {
        status: "FAILED",
        reason: reason.slice(0, 300),
      } satisfies WorkspaceState;
      await context.runtime.activity(
        "workspace.failed",
        "The coding workspace could not be opened",
        { reason: reason.slice(0, 300) },
      );
      return {
        kind: "COMPLETE",
        output: { workspace: "FAILED", reason: reason.slice(0, 300) },
      };
    }
  }

  /**
   * With a workspace, the loop gets the repository as tools and delivery
   * behind approval. Without one, it answers the way it always could.
   */
  protected async answerStage(context: ArmStageContext): Promise<StageOutcome> {
    const session = await this.reopen(context);
    if (!session) return super.answerStage(context);
    const record = session.record;
    const identity = {
      userId: context.identity.userId,
      organizationId: context.identity.organizationId,
      workspaceId: context.identity.workspaceId,
    };
    const { workspaceTools } = await import("../coding/tools");
    const { deliveryTool } = await import("../coding/delivery");
    const github = await import("../connectors/github");
    const { buildToolbox } = await import("../agent/toolbox");
    const toolbox = await buildToolbox(context, {
      armId: this.id,
      extensions: [
        () => [
          ...workspaceTools(
            async () => session.workspace,
            () => session.commands,
          ),
          deliveryTool({
            workspace: async () => session.workspace,
            repository: () =>
              record.repository
                ? github.parseGithubRepository(record.repository)
                : null,
            baseBranch: () => record.branch ?? "main",
            writeCredential: () =>
              github.githubCredential(identity, "repo:write"),
            openPullRequest: github.openPullRequest,
          }),
        ],
      ],
    });
    try {
      return await this.loopAnswer(context, toolbox);
    } finally {
      await toolbox.dispose();
      await session.refresh().catch(() => undefined);
      context.state.workspaceDiff = (record.diff ?? "").slice(0, 20_000);
    }
  }

  protected async runChecksStage(
    context: ArmStageContext,
  ): Promise<StageOutcome> {
    const session = await this.reopen(context);
    if (!session) return this.checkCodeStage(context);
    const runs = await session.runChecks(context.signal);
    context.state.checkRuns = runs;
    context.state.workspaceDiff = (session.record.diff ?? "").slice(0, 20_000);
    const find = (phase: string) => runs.find((run) => run.phase === phase);
    const evidence = (run: (typeof runs)[number] | undefined) =>
      run
        ? {
            command: run.command,
            exitCode: run.exitCode,
            stdout: run.stdout,
            stderr: run.stderr,
            durationMs: run.durationMs,
          }
        : null;
    // A phase that did not run because an earlier one failed is the earlier
    // failure's evidence: a typecheck error means the build is not green.
    const firstFailure = runs.find((run) => run.exitCode !== 0);
    context.state.testResult = evidence(find("test")) ?? evidence(firstFailure);
    context.state.buildResult =
      evidence(find("build")) ??
      evidence(find("typecheck")) ??
      evidence(firstFailure);
    await context.runtime.activity(
      firstFailure ? "workspace.checks_failed" : "workspace.checks_passed",
      runs.length === 0
        ? "The repository declares no checks to run"
        : firstFailure
          ? `${firstFailure.phase} failed (${firstFailure.analysis?.failureClass ?? "unknown"})`
          : `${runs.map((run) => run.phase).join(", ")} passed`,
      {
        runs: runs.map((run) => ({
          phase: run.phase,
          command: run.command,
          exitCode: run.exitCode,
        })),
      },
      "user",
    );
    return {
      kind: "COMPLETE",
      output: {
        runs: runs.map((run) => ({
          phase: run.phase,
          command: run.command,
          exitCode: run.exitCode,
          failureClass: run.analysis?.failureClass ?? null,
        })),
      },
    };
  }

  protected async finalizeWorkspaceStage(
    context: ArmStageContext,
  ): Promise<StageOutcome> {
    const session = await this.reopen(context);
    if (!session) return { kind: "COMPLETE", output: { workspace: "none" } };
    await session.finalize();
    const state = readState<WorkspaceState | null>(context, "workspace", null);
    if (state && state.status === "ready")
      context.state.workspace = { ...state, status: "stopped" };
    return {
      kind: "COMPLETE",
      output: {
        workspace: "stopped",
        diffBytes: session.record.diff?.length ?? 0,
        commands: session.record.commandLog.length,
      },
    };
  }

  /**
   * Fallback when there is no workspace: syntax-check the code blocks the
   * answer contains. With no sandbox every result carries a null exit code,
   * which the verification engine reads as inconclusive -- so the verdict is
   * "unverified", never "verified".
   */
  protected async checkCodeStage(
    context: ArmStageContext,
  ): Promise<StageOutcome> {
    const answer = (context.state.answer as string | undefined) ?? "";
    const files = extractFiles(answer).filter((file) =>
      Boolean(syntaxCheckFor(file.path)),
    );

    const { resolveSandbox, unavailableResult, isSafeRelativePath } =
      await import("../sandbox");
    // The path came out of model output, which the objective influences. A
    // file naming ../../etc/cron.d/anything is dropped rather than written,
    // even though the sandbox that would receive it is ephemeral.
    const safe = files.filter((file) => isSafeRelativePath(file.path));
    const refused = files.length - safe.length;
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

    if (safe.length === 0) {
      const result = unavailableResult(
        "syntax check",
        refused > 0
          ? `Every candidate file named a path outside the working directory (${refused} refused).`
          : "No file in the answer is in a language this run can check.",
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
        safe.map((file) => ({ path: file.path, content: file.content })),
      );
      const failures: CommandEvidence[] = [];
      let last: CommandEvidence | null = null;
      for (const file of safe) {
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
          : `${safe.length} generated file(s) parse`,
        { driver: availability.driver, checked: safe.length, refused },
      );
      return {
        kind: "COMPLETE",
        output: {
          sandbox: availability.driver,
          checkedFiles: safe.length,
          refusedPaths: refused,
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

  // The routing input is accepted so subclasses can shape directives by it.
  protected answerDirectives(input?: RoutingInput): string[] {
    void input;
    return [
      "When workspace.* tools are available, work in the repository: inspect with workspace.tree, workspace.search and workspace.read before editing.",
      "Form a hypothesis, make the smallest edit that tests it (prefer workspace.replace over rewriting a file), then run the relevant discovered command with workspace.run.",
      "When a command fails, read its analysis, repair, and run it again. An environment, network or permission failure is not a code defect: report it instead of editing code.",
      "Never state that tests or builds pass unless a workspace.run result in your observations shows exit code 0 for them.",
      "Use git.deliver only when the objective asks for a pull request or a push.",
      "Without workspace tools: produce the code in fenced blocks tagged with the language, name the file path immediately above each block, and state that nothing was executed.",
      "The final answer lists the files changed, the commands run with their exit codes, and anything left unverified.",
    ];
  }

  protected checksFor(context: ArmStageContext, answer: string) {
    const blocks = extractCodeBlocks(answer);
    const testResult = context.state.testResult as CommandEvidence | undefined;
    const buildResult = context.state.buildResult as
      CommandEvidence | undefined;
    const diff = readState<string>(context, "workspaceDiff", "");
    const checkRuns = readState<
      Array<{ phase: string; command: string; exitCode: number | null }>
    >(context, "checkRuns", []);

    return [
      structureCheck({
        id: "code-present",
        required: true,
        requiredFields: ["answer"],
        minLength: 20,
      }),
      {
        id: "change-evidence",
        type: "STRUCTURE" as const,
        required: true,
        run: () =>
          diff.trim().length > 0
            ? {
                status: "passed" as const,
                detail: "The workspace holds a real change.",
                evidence: { diffBytes: diff.length },
              }
            : blocks.length > 0
              ? {
                  status: "passed" as const,
                  detail: `Answer contains ${blocks.length} fenced code block(s).`,
                  evidence: {
                    languages: blocks.map((block) => block.language),
                  },
                }
              : {
                  status: "failed" as const,
                  detail:
                    "No change in the workspace and no code in the answer.",
                },
      },
      {
        id: "claims-match-evidence",
        type: "SECURITY" as const,
        required: true,
        run: () => {
          const problems: string[] = [];
          if (
            CLAIMS_TESTS_PASS.test(answer) &&
            !/\b(not|never|didn'?t|did not|couldn'?t|could not|unable)\b[^.]{0,40}\btests?\b/i.test(
              answer,
            ) &&
            testResult?.exitCode !== 0
          )
            problems.push(
              "the answer says tests pass, but no test run exited 0",
            );
          if (CLAIMS_BUILD_PASS.test(answer) && buildResult?.exitCode !== 0)
            problems.push(
              "the answer says the build passes, but no build exited 0",
            );
          return problems.length === 0
            ? {
                status: "passed" as const,
                detail:
                  "The answer claims nothing the command log contradicts.",
              }
            : {
                status: "failed" as const,
                detail: `False completion: ${problems.join("; ")}.`,
              };
        },
      },
      {
        id: "static-checks",
        type: "BUILD" as const,
        required: false,
        run: () => {
          const staticRuns = checkRuns.filter((run) =>
            ["format", "lint", "typecheck"].includes(run.phase),
          );
          if (staticRuns.length === 0)
            return {
              status: "inconclusive" as const,
              detail: "No format, lint or typecheck command ran.",
            };
          const failed = staticRuns.filter((run) => run.exitCode !== 0);
          return failed.length === 0
            ? {
                status: "passed" as const,
                detail: staticRuns
                  .map((run) => `${run.phase} exit 0`)
                  .join(", "),
                evidence: { runs: staticRuns },
              }
            : {
                status: "failed" as const,
                detail: failed
                  .map((run) => `${run.phase} exit ${run.exitCode}`)
                  .join(", "),
                evidence: { runs: staticRuns },
              };
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
