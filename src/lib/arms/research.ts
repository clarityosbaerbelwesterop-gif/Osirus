import type { ModelRole } from "../models/provider";
import {
  defineNode,
  validateGraph,
  type WorkflowGraph,
} from "../runtime/graph";
import type { Capability } from "../runtime/types";
import type { CoverageReport } from "../research/citations";
import { buildEvidenceLedger } from "../research/evidence-ledger";
import { persistResearchNotes } from "../research/memory-notes";
import type {
  EvidenceLedger,
  ResearchPlan,
  VerifiedClaim,
} from "../research/types";
import {
  secretLeakCheck,
  sourceCheck,
  structureCheck,
} from "../verification/checks";
import { BaseArm } from "./base";
import type {
  ArmId,
  ArmStageContext,
  RoutingInput,
  StageOutcome,
} from "./types";

export type RetrievedDocument = {
  url: string;
  fetchedAt: string;
  bytes?: number;
};

const URL_PATTERN = /https?:\/\/[^\s<>()\[\]"']+/g;

export function extractCitations(answer: string): string[] {
  return [
    ...new Set(
      (answer.match(URL_PATTERN) ?? []).map((url) =>
        url.replace(/[.,;:]+$/, ""),
      ),
    ),
  ];
}

/**
 * Research that actually researches.
 *
 * The workflow fans out: after a plan, three workers gather in parallel with
 * different mandates -- primary sources, independent corroboration and
 * counter-evidence -- each running its own agent loop over the research tools.
 * Everything they fetch lands in the evidence store, which is the only thing
 * the synthesis stage may cite. Synthesis proposes claims with verbatim
 * excerpts; the citation verifier then accepts or rejects each one against
 * the stored documents. The answer the user reads is rendered from the
 * verified claims, so a rejected citation cannot reach it.
 */
export class ResearchArm extends BaseArm {
  readonly id: ArmId = "research";

  canHandle(input: RoutingInput): number {
    const text = input.objective.toLowerCase();
    let score = 0;
    if (
      /\b(research|investigate|sources?|cite|citation|evidence|literature|survey|find out|who|when did|according to)\b/.test(
        text,
      )
    ) {
      score += 0.5;
    }
    if (/\b(latest|current|recent|today|news|2\d{3})\b/.test(text)) {
      score += 0.25;
    }
    if (/\bcompare\b|\bversus\b|\bvs\.?\b/.test(text)) score += 0.1;
    return Math.min(score, 1);
  }

  protected primaryCapability(): Capability {
    return "research";
  }

  protected modelRole(): ModelRole {
    return "RESEARCH";
  }

  protected skillAffinity(): string[] {
    return ["research", "analysis", "sourcing"];
  }

  protected answerDirectives(): string[] {
    return [
      "Answer only from documents fetched in this run, and say plainly what the sources do not establish.",
      "Show disagreement between sources instead of resolving it by assertion.",
    ];
  }

  buildWorkflow(): WorkflowGraph {
    const base = (
      key: string,
      name: string,
      stageKind: string,
      dependsOn: string[],
      extra: Record<string, unknown> = {},
    ) =>
      defineNode({
        key,
        name,
        capability: "research",
        dependsOn,
        retryPolicy: { maxAttempts: 2, maxSlices: 6 },
        input: { stageKind, armId: this.id, ...extra },
      });
    const graph = {
      nodes: [
        base("understand", "Ground the question", "understand", []),
        base(
          "retrieve-memory",
          "Retrieve internal context",
          "retrieve_memory",
          ["understand"],
        ),
        base("plan-research", "Plan the research", "research_plan", [
          "retrieve-memory",
        ]),
        base(
          "gather-official",
          "Gather primary and official sources",
          "research_gather",
          ["plan-research"],
          { worker: "official" },
        ),
        base(
          "gather-independent",
          "Gather independent corroboration",
          "research_gather",
          ["plan-research"],
          { worker: "independent" },
        ),
        base(
          "gather-counter",
          "Search for counter-evidence",
          "research_gather",
          ["plan-research"],
          { worker: "counter" },
        ),
        {
          ...base(
            "synthesize",
            "Synthesise verified claims",
            "research_synthesize",
            ["gather-official", "gather-independent", "gather-counter"],
          ),
          requiresVerification: true,
        },
        {
          ...base("verify", "Verify citations and coverage", "verify", [
            "synthesize",
          ]),
          requiresVerification: true,
        },
      ],
    };
    validateGraph(graph);
    return graph;
  }

  private async store(context: ArmStageContext) {
    const injected = context.runtime.stores?.evidence;
    if (injected) return injected(context.work.runId, context.work.stageId);
    const { DbEvidenceStore } = await import("../research/db-store");
    return new DbEvidenceStore(
      context.identity.userId,
      context.work.runId,
      context.work.stageId,
    );
  }

  protected async customStage(context: ArmStageContext): Promise<StageOutcome> {
    const kind = context.work.stageInput.stageKind as string;
    if (kind === "research_plan") return this.planStageResearch(context);
    if (kind === "research_gather") return this.gatherStage(context);
    if (kind === "research_synthesize") return this.synthesizeStage(context);
    return super.customStage(context);
  }

  private async planStageResearch(
    context: ArmStageContext,
  ): Promise<StageOutcome> {
    const { planResearch } = await import("../research/pipeline");
    const plan = await planResearch(
      context.work.objective,
      this.structuredFor(context, "RESEARCH"),
      context.signal,
    );
    context.state.researchPlan = plan;
    await context.runtime.activity("research.planned", "Planned the research", {
      subquestions: plan.subquestions,
      informationNeeds: plan.informationNeeds?.length ?? 0,
      freshness: plan.freshness,
      queries: plan.queries.length,
      counterQueries: plan.counterQueries.length,
      stopCriteria: plan.stopCriteria ?? plan.stop,
    });
    return { kind: "COMPLETE", output: { plan } };
  }

  private async gatherStage(context: ArmStageContext): Promise<StageOutcome> {
    const { gather, fallbackPlan } = await import("../research/pipeline");
    const { agentDecisionSchema } = await import("../agent/decision");
    const { buildToolbox } = await import("../agent/toolbox");
    const plan =
      (context.state.researchPlan as ResearchPlan | undefined) ??
      fallbackPlan(context.work.objective);
    const worker =
      (context.work.stageInput.worker as
        "official" | "independent" | "counter") ?? "official";
    const toolbox = await buildToolbox(context, { armId: this.id });
    try {
      const structured = this.structuredFor(context, "RESEARCH");
      const result = await gather({
        worker,
        plan,
        store: await this.store(context),
        registry: toolbox.registry,
        decide: (input) =>
          structured({
            ...input,
            validate: (raw) => agentDecisionSchema.parse(raw),
          }),
        toolContext: {
          runId: context.work.runId,
          stageId: context.work.stageId,
          armId: this.id,
          organizationId: context.identity.organizationId,
          workspaceId: context.identity.workspaceId,
        },
        hooks: this.loopHooks(context, toolbox.record),
        signal: context.signal,
      });
      const fetched = toolbox.evidence.filter(
        (entry) => entry.toolId === "research.fetch" && entry.ok,
      ).length;
      await context.runtime.activity(
        "research.gathered",
        `${worker}: fetched ${fetched} document(s)`,
        {
          worker,
          fetched,
          loopStatus: result.status,
          steps: result.state.steps.length,
        },
      );
      return {
        kind: "COMPLETE",
        output: { worker, fetched, loopStatus: result.status },
      };
    } finally {
      await toolbox.dispose();
    }
  }

  private async synthesizeStage(
    context: ArmStageContext,
  ): Promise<StageOutcome> {
    const { synthesize, finalizeResearch, fallbackPlan } =
      await import("../research/pipeline");
    const plan =
      (context.state.researchPlan as ResearchPlan | undefined) ??
      fallbackPlan(context.work.objective);
    const store = await this.store(context);
    const documents = await store.documents();
    const synthesis = await synthesize({
      question: context.work.objective,
      plan,
      documents,
      structured: this.structuredFor(context, "RESEARCH"),
      signal: context.signal,
    });
    const outcome = await finalizeResearch({
      synthesis,
      documents,
      plan,
      store,
    });
    const priorLedger = context.state.researchLedger as
      EvidenceLedger | undefined;
    const ledger = buildEvidenceLedger({
      question: context.work.objective,
      plan,
      synthesis,
      verified: outcome.claims,
      documents,
      prior: priorLedger ?? null,
    });
    const memoryNotes = await persistResearchNotes({
      memory: context.runtime.memory,
      organizationId: context.identity.organizationId,
      workspaceId: context.identity.workspaceId,
      sessionId: context.work.sessionId,
      runId: context.work.runId,
      ledger,
    }).catch(() => ({ episodicId: null, semanticIds: [] }));

    await context.runtime.emitDelta(outcome.answer);
    const assistantMessageId = await context.runtime.repository.createMessage({
      organizationId: context.identity.organizationId,
      workspaceId: context.identity.workspaceId,
      sessionId: context.work.sessionId,
      runId: context.work.runId,
      role: "assistant",
      content: outcome.answer,
      metadata: { armId: this.id, research: true, coverage: outcome.coverage },
    });
    context.state.answer = outcome.answer;
    context.state.answers = [
      ...((context.state.answers as string[] | undefined) ?? []),
      outcome.answer,
    ];
    context.state.assistantMessageId = assistantMessageId;
    context.state.researchClaims = outcome.claims.map((claim) => ({
      statement: claim.statement,
      status: claim.status,
      confidence: claim.confidence,
      supporting: claim.supporting.length,
      contradicting: claim.contradicting.length,
      rejected: claim.rejectedCitations,
    }));
    context.state.researchCoverage = outcome.coverage;
    context.state.researchLedger = {
      question: ledger.question,
      claims: ledger.claims.map((claim) => ({
        id: claim.id,
        statement: claim.statement,
        kind: claim.kind,
        status: claim.status,
        confidence: claim.confidence,
        supporting: claim.supporting.length,
        contradicting: claim.contradicting.length,
      })),
      contradictions: ledger.contradictions.length,
      beliefUpdates: ledger.beliefUpdates,
      openQuestions: ledger.openQuestions,
      brief: ledger.brief,
      stopMet: ledger.stopMet,
      memoryNotes,
    };
    context.state.retrieved = documents.map((doc) => ({
      url: doc.url,
      fetchedAt: doc.retrievedAt,
    }));
    await context.runtime.activity(
      "research.synthesised",
      "Verified the research claims",
      {
        ...outcome.coverage,
        ledgerClaims: ledger.claims.length,
        contradictions: ledger.contradictions.length,
        beliefUpdates: ledger.beliefUpdates.length,
        stopMet: ledger.stopMet,
      },
    );
    return {
      kind: "COMPLETE",
      output: { assistantMessageId, coverage: outcome.coverage },
    };
  }

  protected checksFor(context: ArmStageContext, answer: string) {
    const retrieved =
      (context.state.retrieved as RetrievedDocument[] | undefined) ?? [];
    const claims =
      (context.state.researchClaims as
        | Array<
            Pick<VerifiedClaim, "status" | "statement"> & {
              rejected: VerifiedClaim["rejectedCitations"];
            }
          >
        | undefined) ?? [];
    const coverageReport = context.state.researchCoverage as
      CoverageReport | undefined;
    const citations = extractCitations(answer);

    return [
      structureCheck({
        id: "answer-present",
        required: true,
        requiredFields: ["answer"],
        minLength: 40,
      }),
      sourceCheck({
        citations,
        retrieved,
        minimumCitations: 0,
        required: true,
      }),
      {
        id: "claims-supported",
        type: "SOURCE" as const,
        required: true,
        run: () => {
          if (!coverageReport || coverageReport.documents === 0) {
            return {
              status: "inconclusive" as const,
              detail:
                "No documents were retrieved, so no claim could be checked.",
            };
          }
          const supported = claims.filter(
            (claim) =>
              claim.status === "SUPPORTED" || claim.status === "CONTESTED",
          ).length;
          const ratio = claims.length ? supported / claims.length : 0;
          return supported > 0 && ratio >= 0.5
            ? {
                status: "passed" as const,
                detail: `${supported} of ${claims.length} claim(s) are backed by verbatim excerpts from retrieved documents.`,
                evidence: { ...coverageReport },
              }
            : {
                status: "failed" as const,
                detail: `Only ${supported} of ${claims.length} claim(s) are backed by retrieved evidence.`,
                evidence: { ...coverageReport },
              };
        },
      },
      {
        id: "source-diversity",
        type: "SOURCE" as const,
        required: false,
        run: () =>
          !coverageReport
            ? { status: "inconclusive" as const, detail: "No coverage report." }
            : coverageReport.meetsStopRule
              ? {
                  status: "passed" as const,
                  detail: `${coverageReport.documents} documents from ${coverageReport.publishers} publisher(s).`,
                  evidence: { ...coverageReport.authorities },
                }
              : {
                  status: "failed" as const,
                  detail: `Coverage below the plan's floor: ${coverageReport.documents} documents from ${coverageReport.publishers} publisher(s).`,
                },
      },
      secretLeakCheck(),
    ];
  }
}
