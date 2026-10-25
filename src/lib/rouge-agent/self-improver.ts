import { createHash } from "node:crypto";
import type {
  RougeCheckResult,
  RougeCodePatch,
  RougeLearnedSkill,
} from "./types";

export interface SkillExtractionInput {
  objective: string;
  previousFailures: RougeCheckResult[];
  winningPatches: RougeCodePatch[];
  verifiedChecks: RougeCheckResult[];
  tokensSavedByCache?: number;
}

/**
 * Recursive skill self-improvement engine for the Rouge Agent.
 *
 * Extracts procedural and strategic skills from every repair transition
 * (failed check -> verified fix), updates empirical confidence scores,
 * and prunes skills that cause regressions.
 */
export class RougeSkillSelfImprover {
  private readonly skills = new Map<string, RougeLearnedSkill>();

  constructor(initialSkills: RougeLearnedSkill[] = []) {
    for (const skill of initialSkills) {
      this.skills.set(skill.slug, { ...skill });
    }
  }

  listActiveSkills(minConfidence = 0.5): RougeLearnedSkill[] {
    return [...this.skills.values()]
      .filter((s) => s.confidence >= minConfidence)
      .sort(
        (a, b) =>
          b.confidence - a.confidence || b.successCount - a.successCount,
      );
  }

  matchSkillsForObjective(
    objective: string,
    failingChecks: string[] = [],
  ): RougeLearnedSkill[] {
    const haystack = `${objective} ${failingChecks.join(" ")}`.toLowerCase();
    return this.listActiveSkills().filter((skill) => {
      const tokens = skill.triggerPattern
        .toLowerCase()
        .split(/[\s,|]+/)
        .filter((t) => t.length >= 3);
      return (
        tokens.length === 0 || tokens.some((token) => haystack.includes(token))
      );
    });
  }

  /**
   * Synthesize or upgrade a skill when a repair round turns failing checks
   * into 100% verified checks.
   */
  extractFromVerifiedRepair(
    input: SkillExtractionInput,
  ): RougeLearnedSkill | null {
    if (
      input.previousFailures.length === 0 ||
      !input.verifiedChecks.every((c) => c.passed)
    ) {
      return null;
    }

    const failureKinds = [
      ...new Set(input.previousFailures.map((f) => f.kind)),
    ].sort();
    const failureNames = input.previousFailures.map((f) => f.name).join(", ");
    const touchedFiles = input.winningPatches.map((p) => p.file);
    const slugBase = `${failureKinds.join("-")}-repair-${createHash("sha256")
      .update(`${failureNames}:${touchedFiles.sort().join(",")}`)
      .digest("hex")
      .slice(0, 8)}`;

    const existing = this.skills.get(slugBase);
    const now = new Date().toISOString();

    if (existing) {
      const nextSuccess = existing.successCount + 1;
      const total = nextSuccess + existing.failureCount;
      const updated: RougeLearnedSkill = {
        ...existing,
        version: existing.version + 1,
        successCount: nextSuccess,
        tokensSaved: existing.tokensSaved + (input.tokensSavedByCache ?? 0),
        confidence: Math.min(0.99, Number((nextSuccess / total).toFixed(4))),
        updatedAt: now,
      };
      this.skills.set(slugBase, updated);
      return updated;
    }

    const created: RougeLearnedSkill = {
      id: `rskill_${slugBase}`,
      slug: slugBase,
      name: `Auto-Synthesized ${failureKinds.join("/").toUpperCase()} Repair Skill`,
      description: `Learned repair strategy resolving ${failureNames} across ${touchedFiles.join(", ") || "workspace"}.`,
      triggerPattern:
        `${failureKinds.join(" ")} ${failureNames} ${touchedFiles.join(" ")}`.trim(),
      repairStrategy: input.winningPatches.map(
        (p) =>
          `Apply verified ${p.authorRole} fix in ${p.file}: ${p.description}`,
      ),
      antiPatterns: input.previousFailures.map(
        (f) => `Avoid ${f.name} failure: ${f.output.slice(0, 140)}`,
      ),
      verificationInvariant: input.verifiedChecks
        .map((c) => `${c.name}=PASS`)
        .join(" && "),
      version: 1,
      successCount: 1,
      failureCount: 0,
      tokensSaved: input.tokensSavedByCache ?? 0,
      confidence: 0.85,
      updatedAt: now,
    };

    this.skills.set(slugBase, created);
    return created;
  }

  recordSkillOutcome(slug: string, succeeded: boolean, tokensSaved = 0): void {
    const existing = this.skills.get(slug);
    if (!existing) return;
    const successCount = existing.successCount + (succeeded ? 1 : 0);
    const failureCount = existing.failureCount + (succeeded ? 0 : 1);
    const total = Math.max(1, successCount + failureCount);
    const confidence = succeeded
      ? Math.min(
          0.99,
          Number(((successCount + 0.5) / (total + 0.5)).toFixed(4)),
        )
      : Math.max(0.1, Number((existing.confidence * 0.65).toFixed(4)));
    this.skills.set(slug, {
      ...existing,
      version: existing.version + 1,
      successCount,
      failureCount,
      tokensSaved: existing.tokensSaved + tokensSaved,
      confidence,
      updatedAt: new Date().toISOString(),
    });
  }
}
