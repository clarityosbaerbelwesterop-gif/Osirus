import { randomUUID } from "node:crypto";
import {
  ROUGE_AGENT_DEFAULT_MODEL,
  ROUGE_AGENT_REVIEWER_MODEL,
} from "@/config/recommendations";
import { RougeSelfCloner, type CloneExecutor } from "./cloner";
import { RougeSkillSelfImprover } from "./self-improver";
import type {
  RougeAgentCheckpoint,
  RougeAgentConfig,
  RougeAgentRunResult,
  RougeCheckResult,
  RougeRepairIteration,
} from "./types";

export type DeterministicVerifier = (
  workspaceFiles: Record<string, string>,
  iteration: number,
) => Promise<RougeCheckResult[]>;

export interface RougeCodeLoopInput {
  runId?: string;
  objective: string;
  initialFiles?: Record<string, string>;
  checkpoint?: RougeAgentCheckpoint;
  config?: RougeAgentConfig;
  cloneExecutor: CloneExecutor;
  verifier: DeterministicVerifier;
}

/**
 * Unbounded / Long-Horizon Autonomous Code-Verify-Repair Loop Engine.
 *
 * Iterates through:
 *   1. Observe current workspace + failing check diagnostics
 *   2. Spawn specialized self-clones in parallel (solver, verifier, security, refactorer)
 *   3. Adjudicate patches and guard against regressions (automatic rollback if passing check count drops)
 *   4. Run deterministic verification suite (typecheck, lint, unit tests, security gates)
 *   5. Extract & evolve reusable skills when failing checks are repaired
 *   6. Yield a durable checkpoint when slice budget is reached so execution can continue
 *      across unlimited slices until 100% error-free (`verified_perfect`).
 */
export class RougeCodeLoopEngine {
  async run(input: RougeCodeLoopInput): Promise<RougeAgentRunResult> {
    const executorModelId =
      input.config?.executorModelId ?? ROUGE_AGENT_DEFAULT_MODEL;
    const reviewerModelId =
      input.config?.reviewerModelId &&
      input.config.reviewerModelId !== executorModelId
        ? input.config.reviewerModelId
        : executorModelId === ROUGE_AGENT_REVIEWER_MODEL
          ? "meta/llama-3.3-70b-instruct"
          : ROUGE_AGENT_REVIEWER_MODEL;
    const thinkingEffort = input.config?.thinkingEffort ?? "hoch";
    const subAgentCount = Math.max(
      0,
      Math.min(
        50,
        input.config?.subAgentCount ?? input.config?.maxParallelClones ?? 4,
      ),
    );
    const config: Required<RougeAgentConfig> = {
      executorModelId,
      reviewerModelId,
      thinkingEffort,
      subAgentCount,
      maxIterationsPerSlice: input.config?.maxIterationsPerSlice ?? 8,
      maxTotalIterations:
        input.config?.maxTotalIterations ?? Number.POSITIVE_INFINITY,
      maxCloneDepth: input.config?.maxCloneDepth ?? 3,
      maxParallelClones:
        input.config?.maxParallelClones ??
        Math.max(1, Math.min(8, subAgentCount || 4)),
      profile: input.config?.profile ?? "frontier-max",
      selfImproveSkills: input.config?.selfImproveSkills ?? true,
      selfHealingRecovery: input.config?.selfHealingRecovery ?? true,
    };

    const runId = input.checkpoint?.runId ?? input.runId ?? randomUUID();
    const cloner = new RougeSelfCloner(
      config.maxParallelClones,
      config.maxCloneDepth,
    );
    const improver = new RougeSkillSelfImprover(
      input.checkpoint?.activeSkills ?? [],
    );

    let workspaceFiles: Record<string, string> = {
      ...(input.checkpoint?.workspaceFiles ?? input.initialFiles ?? {}),
    };
    const history: RougeRepairIteration[] = [
      ...(input.checkpoint?.history ?? []),
    ];
    let previousFailedChecks: RougeCheckResult[] = (
      input.checkpoint?.lastCheckResults ?? []
    ).filter((c) => !c.passed);
    let previousPassingCount = (
      input.checkpoint?.lastCheckResults ?? []
    ).filter((c) => c.passed).length;

    const startIteration = input.checkpoint?.totalIterationsCompleted ?? 0;
    const continuations =
      input.checkpoint?.status === "yielded_for_continuation"
        ? input.checkpoint.continuationCount + 1
        : (input.checkpoint?.continuationCount ?? 0);

    let sliceIterations = 0;
    let selfHealedErrors = 0;
    let totalClonesSpawned = history.reduce(
      (sum, item) => sum + item.clonesSpawned,
      0,
    );
    let lastChecks: RougeCheckResult[] =
      input.checkpoint?.lastCheckResults ?? [];

    const resilientCloneExecutor: CloneExecutor = async (spec, ctx) => {
      try {
        return await input.cloneExecutor(spec, ctx);
      } catch (error) {
        if (!config.selfHealingRecovery) throw error;
        selfHealedErrors += 1;
        return {
          summary: `[self-healed:${spec.role}] Recovered from transient error (${error instanceof Error ? error.message.slice(0, 80) : "error"})`,
          patches: [],
          findings: [],
          confidence: 0.75,
          tokensUsed: 0,
          cachedHit: true,
        };
      }
    };

    while (
      sliceIterations < config.maxIterationsPerSlice &&
      startIteration + sliceIterations < config.maxTotalIterations
    ) {
      const startedAt = Date.now();
      const currentIteration = startIteration + sliceIterations + 1;
      sliceIterations += 1;

      const failingDescriptions = previousFailedChecks.map(
        (c) => `${c.name} (${c.kind}): ${c.output}`,
      );
      const matchedSkills = improver.matchSkillsForObjective(
        input.objective,
        failingDescriptions,
      );

      const snapshotBeforePatch = { ...workspaceFiles };
      const cloneOutcomes = await cloner.executeClones(
        {
          objective: input.objective,
          iteration: currentIteration,
          failingChecks: failingDescriptions,
          workspaceFiles,
          skills: matchedSkills,
          maxParallelClones: config.maxParallelClones,
          maxCloneDepth: config.maxCloneDepth,
        },
        resilientCloneExecutor,
      );
      totalClonesSpawned += cloneOutcomes.length;

      const { acceptedPatches, blockingFindings } =
        cloner.adjudicatePatches(cloneOutcomes);

      for (const patch of acceptedPatches) {
        workspaceFiles[patch.file] = patch.content;
      }

      let checks: RougeCheckResult[];
      try {
        checks = await input.verifier(workspaceFiles, currentIteration);
      } catch (error) {
        if (!config.selfHealingRecovery) throw error;
        selfHealedErrors += 1;
        checks = [
          {
            name: "verifier-self-healing-gate",
            kind: "contract",
            passed: false,
            output:
              error instanceof Error
                ? error.message.slice(0, 200)
                : "Verifier exception caught by self-healing loop",
            durationMs: 1,
          },
        ];
      }
      if (blockingFindings.length > 0) {
        checks.push({
          name: "security-auditor-clone-gate",
          kind: "security",
          passed: false,
          output: blockingFindings.join("; "),
          durationMs: 1,
        });
      }

      const passingNow = checks.filter((c) => c.passed).length;
      const allPassed = checks.length > 0 && checks.every((c) => c.passed);

      // Anti-regression guard: if a multi-iteration repair reduced the number
      // of passing checks, roll back the workspace files to the pre-patch state.
      if (
        !allPassed &&
        previousPassingCount > 0 &&
        passingNow < previousPassingCount
      ) {
        workspaceFiles = snapshotBeforePatch;
        for (const skill of matchedSkills) {
          improver.recordSkillOutcome(skill.slug, false);
        }
      }

      const synthesizedSlugs: string[] = [];
      const cachedTokensSaved = cloneOutcomes
        .filter((o) => o.cachedHit)
        .reduce((acc, o) => acc + Math.max(120, o.tokensUsed), 0);

      if (allPassed && config.selfImproveSkills) {
        for (const skill of matchedSkills) {
          improver.recordSkillOutcome(skill.slug, true, cachedTokensSaved);
        }
        const learned = improver.extractFromVerifiedRepair({
          objective: input.objective,
          previousFailures: previousFailedChecks,
          winningPatches: acceptedPatches,
          verifiedChecks: checks,
          tokensSavedByCache: cachedTokensSaved,
        });
        if (learned) synthesizedSlugs.push(learned.slug);
      }

      const failedNow = checks.filter((c) => !c.passed);
      const record: RougeRepairIteration = {
        iteration: currentIteration,
        clonesSpawned: cloneOutcomes.length,
        patchesApplied: acceptedPatches,
        checks,
        allPassed,
        failingSummary:
          failedNow.length > 0
            ? failedNow.map((f) => `${f.name}: ${f.output}`).join(" | ")
            : null,
        skillsSynthesized: synthesizedSlugs,
        durationMs: Math.max(1, Date.now() - startedAt),
      };
      history.push(record);
      lastChecks = checks;

      if (allPassed) {
        const evolvedSkills = improver.listActiveSkills(0);
        const checkpoint: RougeAgentCheckpoint = {
          runId,
          objective: input.objective,
          iteration: currentIteration,
          totalIterationsCompleted: currentIteration,
          continuationCount: continuations,
          status: "verified_perfect",
          workspaceFiles,
          history,
          activeSkills: evolvedSkills,
          lastCheckResults: checks,
        };
        return {
          runId,
          status: "verified_perfect",
          objective: input.objective,
          executorModelId: config.executorModelId,
          reviewerModelId: config.reviewerModelId,
          thinkingEffort: config.thinkingEffort,
          subAgentCount: config.subAgentCount,
          profile: config.profile,
          iterations: currentIteration,
          continuations,
          totalClonesSpawned,
          selfHealedErrors,
          finalPatches: history.flatMap((h) => h.patchesApplied),
          finalChecks: checks,
          evolvedSkills,
          checkpoint,
          summary: `Verified 100% error-free after ${currentIteration} iteration(s) and ${totalClonesSpawned} self-clones.`,
        };
      }

      previousFailedChecks = failedNow;
      previousPassingCount = Math.max(previousPassingCount, passingNow);
    }

    const totalDone = startIteration + sliceIterations;
    const canContinue = totalDone < config.maxTotalIterations;
    const status = canContinue ? "yielded_for_continuation" : "failed";
    const evolvedSkills = improver.listActiveSkills(0);
    const checkpoint: RougeAgentCheckpoint = {
      runId,
      objective: input.objective,
      iteration: totalDone,
      totalIterationsCompleted: totalDone,
      continuationCount: continuations,
      status,
      workspaceFiles,
      history,
      activeSkills: evolvedSkills,
      lastCheckResults: lastChecks,
    };

    return {
      runId,
      status,
      objective: input.objective,
      executorModelId: config.executorModelId,
      reviewerModelId: config.reviewerModelId,
      thinkingEffort: config.thinkingEffort,
      subAgentCount: config.subAgentCount,
      profile: config.profile,
      iterations: totalDone,
      continuations,
      totalClonesSpawned,
      selfHealedErrors,
      finalPatches: history.flatMap((h) => h.patchesApplied),
      finalChecks: lastChecks,
      evolvedSkills,
      checkpoint,
      summary:
        status === "yielded_for_continuation"
          ? `Slice completed ${sliceIterations} iteration(s); checkpointed for seamless continuation.`
          : `Reached maximum total iterations (${totalDone}) with unresolved checks.`,
    };
  }

  /**
   * Drives a Rouge Agent loop across multiple slices automatically until
   * `verified_perfect` is reached (or `maxContinuations` safety ceiling).
   */
  async runUntilPerfect(
    input: RougeCodeLoopInput & { maxContinuations?: number },
  ): Promise<RougeAgentRunResult> {
    const maxContinuations = input.maxContinuations ?? 25;
    let current = await this.run(input);
    let rounds = 0;
    while (
      current.status === "yielded_for_continuation" &&
      rounds < maxContinuations
    ) {
      rounds += 1;
      current = await this.run({
        ...input,
        checkpoint: current.checkpoint,
      });
    }
    return current;
  }
}
