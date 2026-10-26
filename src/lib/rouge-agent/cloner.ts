import { createHash } from "node:crypto";
import type {
  RougeCloneOutcome,
  RougeCloneRole,
  RougeCloneSpec,
  RougeCodePatch,
  RougeLearnedSkill,
} from "./types";

export interface CloneTaskContext {
  objective: string;
  iteration: number;
  failingChecks: string[];
  workspaceFiles: Record<string, string>;
  skills: RougeLearnedSkill[];
  maxParallelClones: number;
  maxCloneDepth: number;
}

export type CloneExecutor = (
  spec: RougeCloneSpec,
  context: CloneTaskContext,
) => Promise<{
  summary: string;
  patches: RougeCodePatch[];
  findings: string[];
  confidence: number;
  tokensUsed?: number;
  cachedHit?: boolean;
  subCloneRequests?: Array<{
    role: RougeCloneRole;
    subObjective: string;
    assignedFiles?: string[];
  }>;
}>;

const DEFAULT_ROLE_PIPELINE: RougeCloneRole[] = [
  "architect",
  "solver",
  "security_auditor",
  "verifier",
  "refactorer",
];

function deterministicCloneId(
  parentId: string | null,
  role: RougeCloneRole,
  subObjective: string,
  iteration: number,
): string {
  const digest = createHash("sha256")
    .update(`${parentId ?? "root"}:${role}:${iteration}:${subObjective}`)
    .digest("hex")
    .slice(0, 12);
  return `clone-${role}-${digest}`;
}

/**
 * Self-cloning orchestrator for the Rouge Agent.
 *
 * Spawns specialized parallel clones (architect, solver, security_auditor,
 * verifier, refactorer, optimizer), supports recursive child cloning up to
 * `maxCloneDepth`, and adjudicates conflicting file patches using verifier
 * and security auditor findings rather than majority voting.
 */
export class RougeSelfCloner {
  constructor(
    private readonly maxParallelClones = 5,
    private readonly maxCloneDepth = 3,
  ) {}

  planInitialClones(context: CloneTaskContext): RougeCloneSpec[] {
    const fileKeys = Object.keys(context.workspaceFiles);
    const activeSkillSlugs = context.skills.map((s) => s.slug);
    const roles: RougeCloneRole[] =
      context.failingChecks.length > 0
        ? ["solver", "verifier", "security_auditor", "refactorer"]
        : DEFAULT_ROLE_PIPELINE.slice(0, this.maxParallelClones);

    return roles.slice(0, this.maxParallelClones).map((role) => {
      const subObjective = this.subObjectiveForRole(role, context);
      return {
        id: deterministicCloneId(null, role, subObjective, context.iteration),
        parentCloneId: null,
        generation: 1,
        role,
        subObjective,
        assignedFiles: fileKeys,
        skillsApplied: activeSkillSlugs,
      };
    });
  }

  private subObjectiveForRole(
    role: RougeCloneRole,
    context: CloneTaskContext,
  ): string {
    const failureNote =
      context.failingChecks.length > 0
        ? ` Resolve failing checks: ${context.failingChecks.join("; ")}.`
        : "";
    switch (role) {
      case "architect":
        return `Decompose system invariants and interface contracts for: ${context.objective}.${failureNote}`;
      case "solver":
        return `Implement complete, production-ready code changes for: ${context.objective}.${failureNote}`;
      case "security_auditor":
        return `Audit for SSRF, injection, authz/RLS bypass, TOCTOU, and secret leaks in: ${context.objective}.${failureNote}`;
      case "verifier":
        return `Falsify assumptions, check edge cases, and validate deterministic invariants for: ${context.objective}.${failureNote}`;
      case "refactorer":
        return `Eliminate dead code, tighten types, and ensure clean formatting for: ${context.objective}.${failureNote}`;
      case "optimizer":
        return `Optimize runtime latency, caching, and token efficiency for: ${context.objective}.${failureNote}`;
    }
  }

  async executeClones(
    context: CloneTaskContext,
    executor: CloneExecutor,
  ): Promise<RougeCloneOutcome[]> {
    const rootSpecs = this.planInitialClones(context);
    const allOutcomes: RougeCloneOutcome[] = [];

    const runWave = async (specs: RougeCloneSpec[]): Promise<void> => {
      const bounded = specs.slice(0, this.maxParallelClones);
      const waveResults = await Promise.all(
        bounded.map(async (spec) => {
          const raw = await executor(spec, context);
          const outcome: RougeCloneOutcome = {
            clone: spec,
            status:
              raw.confidence >= 0.7 &&
              !raw.findings.some((f) => /critical|blocker/i.test(f))
                ? "verified"
                : "needs_repair",
            summary: raw.summary,
            patches: raw.patches.map((p) => ({
              ...p,
              authorCloneId: spec.id,
              authorRole: spec.role,
            })),
            findings: raw.findings,
            confidence: Math.max(0, Math.min(1, raw.confidence)),
            tokensUsed: raw.tokensUsed ?? 0,
            cachedHit: raw.cachedHit ?? false,
          };
          return { outcome, subRequests: raw.subCloneRequests ?? [] };
        }),
      );

      const childSpecs: RougeCloneSpec[] = [];
      for (const { outcome, subRequests } of waveResults) {
        allOutcomes.push(outcome);
        if (outcome.clone.generation < this.maxCloneDepth) {
          for (const req of subRequests) {
            childSpecs.push({
              id: deterministicCloneId(
                outcome.clone.id,
                req.role,
                req.subObjective,
                context.iteration,
              ),
              parentCloneId: outcome.clone.id,
              generation: outcome.clone.generation + 1,
              role: req.role,
              subObjective: req.subObjective,
              assignedFiles: req.assignedFiles ?? outcome.clone.assignedFiles,
              skillsApplied: outcome.clone.skillsApplied,
            });
          }
        }
      }

      if (childSpecs.length > 0) {
        await runWave(childSpecs);
      }
    };

    await runWave(rootSpecs);
    return allOutcomes;
  }

  /**
   * Adjudicates and merges patches across parallel clones.
   * Security auditor and verifier vetoes block unsafe patches; highest-confidence
   * verified patches win per file without duplicate writes.
   */
  adjudicatePatches(outcomes: RougeCloneOutcome[]): {
    acceptedPatches: RougeCodePatch[];
    blockingFindings: string[];
  } {
    const blockingFindings = outcomes
      .filter(
        (o) =>
          o.clone.role === "security_auditor" || o.clone.role === "verifier",
      )
      .flatMap((o) =>
        o.findings.filter((f) => /critical|blocker|vulnerability/i.test(f)),
      );

    const byFile = new Map<string, { patch: RougeCodePatch; score: number }>();

    const rolePriority: Record<RougeCloneRole, number> = {
      security_auditor: 1.15,
      verifier: 1.1,
      solver: 1.05,
      refactorer: 1.0,
      optimizer: 1.0,
      architect: 0.95,
    };

    for (const outcome of outcomes) {
      if (outcome.status === "rejected") continue;
      const weight = rolePriority[outcome.clone.role] ?? 1.0;
      const score = outcome.confidence * weight;
      for (const patch of outcome.patches) {
        const current = byFile.get(patch.file);
        if (!current || score > current.score) {
          byFile.set(patch.file, { patch, score });
        }
      }
    }

    return {
      acceptedPatches: [...byFile.values()].map((entry) => entry.patch),
      blockingFindings,
    };
  }
}
