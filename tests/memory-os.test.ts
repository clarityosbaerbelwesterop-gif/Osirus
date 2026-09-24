import { describe, expect, it, vi } from "vitest";
import {
  buildMemoryContextLines,
  bundleFromItems,
  classifyMemoryPlane,
} from "../src/lib/memory/planes";
import { MemoryOS } from "../src/lib/memory/os";
import type { MemoryItem } from "../src/lib/memory";

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

describe("memory planes", () => {
  it("routes run summaries to episodic and patterns to procedural", () => {
    expect(
      classifyMemoryPlane(
        memory("e1", "Objective: Atlas", { kind: "run_summary" }),
      ),
    ).toBe("episodic");
    expect(
      classifyMemoryPlane(
        memory("p1", "npm run test", {
          kind: "pattern",
          source: { memory: "experience.command" },
        }),
      ),
    ).toBe("procedural");
    expect(
      classifyMemoryPlane(
        memory("s1", "Use schema v3", {
          kind: "decision",
          importance: 0.9,
        }),
      ),
    ).toBe("strategic");
    expect(classifyMemoryPlane(memory("f1", "Neon uses advisory locks"))).toBe(
      "semantic",
    );
  });

  it("builds plane-prefixed context lines", () => {
    const bundle = bundleFromItems([
      memory("e1", "Prior run on Atlas", { kind: "run_summary" }),
      memory("f1", "Atlas preview uses port 4173"),
    ]);
    expect(bundle.contextLines).toEqual([
      "[episodic/second/verified] Prior run on Atlas",
      "[semantic/second/verified] Atlas preview uses port 4173",
    ]);
    expect(buildMemoryContextLines(bundle.planes)).toEqual(bundle.contextLines);
  });
});

describe("MemoryOS coordinator", () => {
  it("merges episodic and lexical retrieval into a bundle", async () => {
    const episodic = memory("ep1", "Last Atlas run", { kind: "run_summary" });
    const semantic = memory("sem1", "Atlas preview uses port 4173");
    const repository = {
      retrieve: vi.fn(async () => [semantic]),
      episodicByObjective: vi.fn(async () => [episodic]),
      countContradictions: vi.fn(async () => 1),
    };
    const os = new MemoryOS("actor");
    os.repository.retrieve = repository.retrieve;
    os.repository.episodicByObjective = repository.episodicByObjective;
    os.repository.countContradictions = repository.countContradictions;

    const bundle = await os.retrieveBundle({
      workspaceId: "ws",
      objective: "Continue Atlas preview",
    });

    expect(bundle.planes.episodic.map((item) => item.id)).toEqual(["ep1"]);
    expect(bundle.planes.semantic.map((item) => item.id)).toEqual(["sem1"]);
    expect(bundle.contradictionsPending).toBe(1);
    expect(bundle.contextLines[0]).toContain("[episodic/");
  });

  it("delegates contradiction resolution to the repository", async () => {
    const os = new MemoryOS("actor");
    os.repository.resolveConflict = vi.fn(async () => undefined);
    await os.resolveContradiction({
      workspaceId: "ws",
      winningMemoryId: "win",
      rejectedMemoryIds: ["lose"],
    });
    expect(os.repository.resolveConflict).toHaveBeenCalledWith({
      workspaceId: "ws",
      winningMemoryId: "win",
      rejectedMemoryIds: ["lose"],
    });
  });
});
