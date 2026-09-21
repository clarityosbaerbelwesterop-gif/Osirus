import { describe, expect, it } from "vitest";
import { buildFirstBrain } from "../src/lib/context/builder";
import {
  compileMemoryCandidate,
  lexicalRetrieve,
  type MemoryItem,
} from "../src/lib/memory";
import { buildFreshWorkerHandoff } from "../src/lib/runtime/handoff";
import { osirusCapabilityPack } from "../src/lib/skills/capability-pack";
import { selectSkills, type Skill } from "../src/lib/skills";

function memory(
  id: string,
  content: string,
  overrides: Partial<MemoryItem> = {},
): MemoryItem {
  return {
    id,
    tier: "second",
    kind: "fact",
    content,
    source: { test: true },
    updatedAt: "2026-09-21T00:00:00.000Z",
    confidence: 0.8,
    importance: 0.8,
    verificationStatus: "verified",
    contradictionStatus: "none",
    ...overrides,
  };
}

describe("three-brain memory and progressive skills", () => {
  it("retrieves relevant memory and excludes unrelated memory", () => {
    const results = lexicalRetrieve("Neon migration locking", [
      memory(
        "relevant",
        "Neon migration replay uses advisory locking for checkpoints.",
      ),
      memory(
        "irrelevant",
        "The product color palette uses a midnight blue accent.",
      ),
    ]);
    expect(results.map((item) => item.id)).toEqual(["relevant"]);
  });

  it("promotes useful knowledge but does not store every response", () => {
    expect(
      compileMemoryCandidate({
        content: "The workspace build command is npm run build.",
        kind: "project_map",
        source: { type: "verified-run" },
        importance: 0.8,
        confidence: 0.9,
        verified: true,
        authoritative: true,
        recurring: true,
        scope: "workspace",
      }).decision,
    ).toBe("DISTILL_THIRD_BRAIN");
    expect(
      compileMemoryCandidate({
        content: "ok",
        kind: "transient",
        source: { type: "model" },
        importance: 0.1,
      }).decision,
    ).toBe("WORKING_ONLY");
  });

  it("marks conflicting canonical memory instead of treating both values as true", () => {
    const existing = memory("old", "Production database is region A.", {
      subjectKey: "production-db-region",
      canonicalValue: "A",
    });
    const result = compileMemoryCandidate(
      {
        content:
          "Fresh authoritative source says the production database is region B.",
        kind: "fact",
        source: { type: "authoritative" },
        subjectKey: "production-db-region",
        canonicalValue: "B",
        verified: true,
        authoritative: true,
        importance: 0.9,
      },
      [existing],
    );
    expect(result).toMatchObject({
      decision: "MARK_CONFLICT",
      existingMemoryId: "old",
    });
  });

  it("respects the first-brain token budget and records omissions", () => {
    const firstBrain = buildFirstBrain({
      objective: "Implement a safe migration.",
      runtimeContract: "R".repeat(4000),
      memory: ["M".repeat(4000)],
      skills: ["S".repeat(4000)],
      budget: {
        maxTokens: 300,
        buckets: {
          runtime: 80,
          objective: 80,
          plan: 20,
          dialogue: 20,
          memory: 60,
          sources: 10,
          artifacts: 10,
          skills: 30,
          tools: 10,
          verification: 10,
        },
      },
    });
    expect(firstBrain.usedTokens).toBeLessThanOrEqual(300);
    expect(firstBrain.omitted.length).toBeGreaterThan(0);
  });

  it("creates a compact fresh-worker handoff without a transcript", () => {
    const handoff = buildFreshWorkerHandoff({
      objective: "O".repeat(5000),
      importantMemoryIds: Array.from(
        { length: 20 },
        (_, index) => `m-${index}`,
      ),
      artifactIds: Array.from({ length: 20 }, (_, index) => `a-${index}`),
      events: [
        {
          id: "event",
          runId: "run",
          sequence: 1,
          type: "verification.failed",
          visibility: "internal",
          summary: "F".repeat(1000),
          at: "2026-09-21T00:00:00.000Z",
          data: {},
        },
      ],
    });
    expect(handoff.objective.length).toBeLessThanOrEqual(2000);
    expect(handoff.importantMemoryIds).toHaveLength(12);
    expect(handoff.artifactIds).toHaveLength(12);
    expect(handoff.failures[0]?.summary.length).toBeLessThanOrEqual(320);
  });

  it("indexes all 168 supplied skills while selecting no more than eight", () => {
    expect(osirusCapabilityPack).toHaveLength(168);
    const skills: Skill[] = osirusCapabilityPack.map((skill) => ({
      ...skill,
      state: "enabled",
    }));
    const selected = selectSkills(
      "Create a Next.js coding plan with tests and verification.",
      skills,
      ["coding"],
    );
    expect(selected.length).toBeLessThanOrEqual(8);
    expect(selected.every((skill) => skill.risk !== "high")).toBe(true);
  });
});
