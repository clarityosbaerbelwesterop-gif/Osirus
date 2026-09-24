import type { QaReport } from "../coding/browser-qa";
import {
  contractCoverage,
  contractProblems,
  isProductBuild,
  type BuildContract,
} from "../building/contract";
import type { ModelRole } from "../models/provider";
import {
  defineNode,
  validateGraph,
  type WorkflowGraph,
} from "../runtime/graph";
import type { Capability } from "../runtime/types";
import { secretLeakCheck, structureCheck } from "../verification/checks";
import { BaseArm, readState } from "./base";
import { CodingArm, type WorkspaceState } from "./coding";
import type {
  ArmId,
  ArmStageContext,
  RoutingInput,
  StageOutcome,
} from "./types";

/**
 * Building: products and deliverables.
 *
 * Two modes, decided by the objective. A product build ("build a landing page
 * for ...") writes a BuildContract, builds it in a coding workspace, serves
 * the result, runs browser QA against the contract's own acceptance probes,
 * and is verified by what the browser found. A deliverable ("draft a
 * specification ...") is the document builder this arm always had
 * (ArtifactBuilder mode): structure and outline coverage.
 *
 * A product build answered with prose has no diff and no QA report, and fails
 * verification. That is the point of the mode.
 */
export class BuildingArm extends CodingArm {
  readonly id: ArmId = "building";

  canHandle(input: RoutingInput): number {
    const text = input.objective.toLowerCase();
    let score = 0;
    if (
      /\b(write|draft|produce|create|build|design|outline|prepare|generate|make)\b/.test(
        text,
      )
    ) {
      score += 0.35;
    }
    if (
      /\b(document|report|spec|specification|proposal|plan|deck|readme|guide|checklist|template|policy|memo)\b/.test(
        text,
      )
    ) {
      score += 0.4;
    }
    if (isProductBuild(input.objective)) score += 0.45;
    if (/\b(section|chapter|structure|format)\b/.test(text)) score += 0.1;
    return Math.min(score, 1);
  }

  protected primaryCapability(): Capability {
    return "general";
  }

  protected modelRole(): ModelRole {
    return "STRONG";
  }

  protected additionalStages() {
    return [{ key: "design", name: "Design the deliverable", kind: "design" }];
  }

  protected skillAffinity(): string[] {
    return ["writing", "planning", "documentation", "frontend", "design"];
  }

  buildWorkflow(input?: RoutingInput): WorkflowGraph {
    if (!input || !isProductBuild(input.objective)) {
      // ArtifactBuilder mode: the document workflow, no workspace.
      return BaseArm.prototype.buildWorkflow.call(this);
    }
    const coding = super.buildWorkflow();
    const nodes = coding.nodes.map((node) =>
      node.key === "finalize-workspace"
        ? defineNode({ ...node, dependsOn: ["qa-preview"] })
        : node,
    );
    nodes.push(
      defineNode({
        key: "qa-preview",
        name: "Preview and browser QA",
        capability: "coding",
        dependsOn: ["run-checks"],
        failurePolicy: "continue",
        retryPolicy: { maxAttempts: 1, maxSlices: 2 },
        input: { stageKind: "qa_preview", armId: this.id },
      }),
    );
    const graph = { nodes };
    validateGraph(graph);
    return graph;
  }

  protected answerDirectives(input?: RoutingInput): string[] {
    const sections = input?.analysis?.successCriteria ?? [];
    return [
      "When a [build contract] is in the context and workspace.* tools are available, build the product in the workspace: create the files, make every screen's acceptance texts and selectors real, handle each listed state, and make the layout work at phone, iPad and desktop widths.",
      "A static product lives in index.html (plus CSS/JS files) at the repository root or in dist/. Declare <html lang>, a viewport meta tag, alt text on images and a name on every button.",
      "Never state that the page works in a browser unless QA evidence says so; say what was checked.",
      "For a document deliverable: produce the complete deliverable, not a description of it, with headings so the structure is visible.",
      sections.length
        ? `The result must satisfy: ${sections.join("; ")}.`
        : "Cover every part the objective asks for.",
      "Mark anything you could not produce as missing rather than omitting it silently.",
      ...super.answerDirectives(),
    ];
  }

  protected async customStage(context: ArmStageContext): Promise<StageOutcome> {
    switch (context.work.stageInput.stageKind as string) {
      case "design":
        return isProductBuild(context.work.objective)
          ? this.contractStage(context)
          : this.outlineStage(context);
      case "qa_preview":
        return this.qaStage(context);
      default:
        return super.customStage(context);
    }
  }

  private async outlineStage(context: ArmStageContext): Promise<StageOutcome> {
    const analysis = context.state.analysis as
      { successCriteria: string[] } | undefined;
    const outline = analysis?.successCriteria ?? [];
    context.state.outline = outline;
    return { kind: "COMPLETE", output: { outline, sections: outline.length } };
  }

  private async contractStage(context: ArmStageContext): Promise<StageOutcome> {
    const { buildContractSchema, CONTRACT_SYSTEM } =
      await import("../building/contract");
    const structured = this.structuredFor(context, "THINKING");
    const contract = await structured({
      system: CONTRACT_SYSTEM,
      user: `Objective:\n${context.work.objective}`,
      validate: (raw) => {
        const value = buildContractSchema.parse(raw);
        const problems = contractProblems(value);
        if (problems.length)
          throw new Error(`contract_invalid: ${problems.join("; ")}`);
        return value;
      },
      signal: context.signal,
    });
    context.state.buildContract = contract;
    await context.runtime.activity(
      "build.contract",
      `Build contract: ${contract.screens.length} screen(s), ${contract.userFlows.length} flow(s)`,
      {
        screens: contract.screens.map((screen) => ({
          path: screen.path,
          name: screen.name,
          states: screen.states,
        })),
        responsive: contract.responsive,
      },
      "user",
    );
    return {
      kind: "COMPLETE",
      output: { screens: contract.screens.length, stack: contract.stack },
    };
  }

  /**
   * Serve what was built and check it against the contract.
   *
   * In Vercel Sandbox a preview server runs inside the VM on the exposed
   * port. In tests and CI the workspace is served from this process. Which
   * QA ran -- a real browser or the HTTP fallback -- is recorded in the
   * report, and only a browser run can verify the product.
   */
  private async qaStage(context: ArmStageContext): Promise<StageOutcome> {
    const unavailable = (reason: string): StageOutcome => {
      const report: QaReport = {
        mode: "unavailable",
        url: "",
        status: null,
        title: null,
        consoleErrors: [],
        failedRequests: [],
        viewports: [],
        checks: [],
        reason,
      };
      context.state.qaReport = report;
      return { kind: "COMPLETE", output: { qa: "unavailable", reason } };
    };
    const contract = context.state.buildContract as BuildContract | undefined;
    if (!contract) return unavailable("No build contract for this run.");
    const session = await this.reopen(context);
    if (!session) return unavailable("No workspace for this run.");

    const { previewDirectory, contractProbes } =
      await import("../building/contract");
    const { browserQa, serveWorkspaceDirectory } =
      await import("../coding/browser-qa");
    const { PREVIEW_PORT } = await import("../coding/session");
    const files = await session.workspace.tree(".", 6, { filesOnly: true });
    const directory = previewDirectory(files);
    if (!directory)
      return unavailable(
        "Nothing to preview: no index.html in dist/, build/, out/, public/ or the repository root.",
      );
    const probes = contractProbes(contract);
    const handle = session.workspace.handle;
    let report: QaReport;
    const hostedUrl = handle.startBackground
      ? handle.previewUrl(PREVIEW_PORT)
      : null;
    // A hosted preview is reachable by anyone holding its URL. Serving the
    // root of a cloned repository would publish its whole source tree (a
    // private one included); only a build output directory, or a repository
    // this run created from nothing, is served that way.
    if (hostedUrl && directory === "." && session.record.repository)
      return unavailable(
        "Refusing to publish the root of a cloned repository as a preview; build into dist/, build/, out/ or public/.",
      );
    if (hostedUrl && handle.startBackground) {
      await handle.startBackground({
        cmd: "python3",
        args: [
          "-m",
          "http.server",
          String(PREVIEW_PORT),
          "--bind",
          "0.0.0.0",
          "--directory",
          directory,
        ],
        cwd: "repo",
      });
      await new Promise((resolve) => setTimeout(resolve, 1_500));
      // A real browser inside the VM, next to the preview server, at
      // localhost: the product is verified by what Chromium rendered. If the
      // browser cannot start there, the HTTP check runs and says so.
      const { SandboxBrowser } = await import("../computer/browser");
      try {
        report = await new SandboxBrowser(handle).run(
          `http://127.0.0.1:${PREVIEW_PORT}/`,
          probes,
        );
        report = { ...report, url: hostedUrl };
      } catch (error) {
        report = await browserQa().run(hostedUrl, probes);
        report = {
          ...report,
          reason: `No browser in the sandbox (${error instanceof Error ? error.message.slice(0, 160) : "unknown"}); HTTP check only.`,
        };
      }
      session.record.previewUrl = hostedUrl;
    } else {
      const served = await serveWorkspaceDirectory(
        session.workspace,
        directory,
      );
      try {
        report = await browserQa().run(served.url, probes);
      } finally {
        await served.close();
      }
    }
    context.state.qaReport = report;
    const { verificationArtifactFromQa } =
      await import("../building/verification-artifact");
    const artifact = verificationArtifactFromQa(contract, report);
    context.state.verificationArtifact = artifact;
    await session.refresh().catch(() => undefined);
    const failed = report.checks.filter((check) => !check.passed);
    await context.runtime.activity(
      failed.length || report.consoleErrors.length
        ? "qa.failed"
        : "qa.completed",
      `${report.mode === "browser" ? "Browser" : report.mode === "http" ? "HTTP-only" : "No"} QA: ${report.checks.length - failed.length}/${report.checks.length} checks passed`,
      {
        mode: report.mode,
        failed: failed.map((check) => check.id),
        consoleErrors: report.consoleErrors.slice(0, 5),
        evidenceRefs: artifact.evidenceRefs,
      },
      "user",
    );
    await context.runtime.repository
      .createArtifact({
        organizationId: context.identity.organizationId,
        workspaceId: context.identity.workspaceId,
        sessionId: context.work.sessionId,
        runId: context.work.runId,
        kind: artifact.kind,
        title: artifact.title,
        contentType: "text/markdown",
        content: { body: artifact.content },
        provenance: {
          producedBy: `${this.id}.qa_preview`,
          stageId: context.work.stageId,
        },
      })
      .catch(() => undefined);
    return {
      kind: "COMPLETE",
      output: {
        qa: report.mode,
        passed: report.checks.length - failed.length,
        failed: failed.length,
        verificationArtifact: artifact.title,
        evidenceRefs: artifact.evidenceRefs,
      },
    };
  }

  protected checksFor(context: ArmStageContext, answer: string) {
    if (!isProductBuild(context.work.objective))
      return this.documentChecks(context, answer);

    const contract = context.state.buildContract as BuildContract | undefined;
    const report = context.state.qaReport as QaReport | undefined;
    const workspace = readState<WorkspaceState | null>(
      context,
      "workspace",
      null,
    );
    const declared = new Set(
      workspace && "commands" in workspace
        ? workspace.commands.map((command) => command.phase)
        : [],
    );
    // A static product usually declares no test or build command. The
    // browser is its evidence; tests and build are required only where the
    // repository says it has them.
    const coding = super.checksFor(context, answer).map((check) =>
      check.id === "tests"
        ? { ...check, required: declared.has("test") }
        : check.id === "build"
          ? {
              ...check,
              required: declared.has("build") || declared.has("typecheck"),
            }
          : check,
    );

    return [
      ...coding,
      {
        id: "build-contract",
        type: "STRUCTURE" as const,
        required: true,
        run: () => {
          if (!contract)
            return {
              status: "failed" as const,
              detail:
                "A product build needs a build contract; none was written.",
            };
          const problems = contractProblems(contract);
          return problems.length === 0
            ? {
                status: "passed" as const,
                detail: `Contract: ${contract.screens.length} screen(s) with acceptance probes.`,
              }
            : {
                status: "failed" as const,
                detail: `Contract invalid: ${problems.join("; ")}.`,
              };
        },
      },
      {
        id: "browser-qa",
        type: "TEST" as const,
        required: true,
        run: () => {
          if (!report || report.mode === "unavailable")
            return {
              status: "inconclusive" as const,
              detail: `No QA ran${report?.reason ? `: ${report.reason}` : "."}`,
            };
          const failed = report.checks.filter((check) => !check.passed);
          if (failed.length || report.consoleErrors.length)
            return {
              status: "failed" as const,
              detail: [
                failed.length
                  ? `Failed: ${failed.map((check) => check.detail).join("; ")}`
                  : "",
                report.consoleErrors.length
                  ? `Console errors: ${report.consoleErrors.slice(0, 3).join("; ")}`
                  : "",
              ]
                .filter(Boolean)
                .join(" "),
              evidence: { mode: report.mode, failed: failed.map((c) => c.id) },
            };
          return report.mode === "browser"
            ? {
                status: "passed" as const,
                detail: `A browser loaded the preview: ${report.checks.length} check(s) passed at ${report.viewports.map((viewport) => viewport.name).join(", ")}.`,
                evidence: { url: report.url, viewports: report.viewports },
              }
            : {
                status: "inconclusive" as const,
                detail:
                  "Only an HTTP check ran (no browser here); the markup passed but nothing was rendered.",
              };
        },
      },
      {
        id: "contract-coverage",
        type: "TEST" as const,
        required: true,
        run: () => {
          if (!contract || !report || report.mode === "unavailable")
            return {
              status: "inconclusive" as const,
              detail: "No QA report to compare the contract against.",
            };
          if (report.mode !== "browser")
            return {
              status: "inconclusive" as const,
              detail:
                "Contract coverage needs a browser; only an HTTP check ran here.",
            };
          const coverage = contractCoverage(contract, report);
          return coverage.missing.length === 0
            ? {
                status: "passed" as const,
                detail: `All ${coverage.covered.length} acceptance probe(s) found.`,
              }
            : {
                status: "failed" as const,
                detail: `Acceptance probes not found: ${coverage.missing.join("; ")}.`,
                evidence: coverage,
              };
        },
      },
    ];
  }

  private documentChecks(context: ArmStageContext, answer: string) {
    const outline = (context.state.outline as string[] | undefined) ?? [];
    return [
      structureCheck({
        id: "deliverable-present",
        required: true,
        requiredFields: ["answer"],
        minLength: 120,
      }),
      {
        id: "has-structure",
        type: "STRUCTURE" as const,
        required: true,
        run: () => {
          const headings = answer.match(/^#{1,6}\s+\S|^\s*\d+\.\s+\S/gm) ?? [];
          return headings.length >= 2
            ? {
                status: "passed" as const,
                detail: `Deliverable has ${headings.length} structural markers.`,
                evidence: { headings: headings.length },
              }
            : {
                status: "failed" as const,
                detail:
                  "Deliverable has no visible structure; at least two headings or numbered sections are required.",
                evidence: { headings: headings.length },
              };
        },
      },
      {
        id: "outline-covered",
        type: "STRUCTURE" as const,
        required: false,
        run: () => {
          if (outline.length === 0) {
            return {
              status: "inconclusive" as const,
              detail: "No outline was produced to compare against.",
            };
          }
          const body = answer.toLowerCase();
          const missing = outline.filter((item) => {
            const terms = (item.toLowerCase().match(/[a-z]{4,}/g) ?? []).slice(
              0,
              6,
            );
            if (terms.length === 0) return false;
            return (
              terms.filter((term) => body.includes(term)).length /
                terms.length <
              0.5
            );
          });
          return missing.length === 0
            ? {
                status: "passed" as const,
                detail: `All ${outline.length} planned section(s) appear in the deliverable.`,
                evidence: { outline },
              }
            : {
                status: "failed" as const,
                detail: `Planned section(s) missing from the deliverable: ${missing.join("; ")}.`,
                evidence: { missing },
              };
        },
      },
      secretLeakCheck(),
    ];
  }
}
