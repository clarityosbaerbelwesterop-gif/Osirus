import { describe, expect, it } from "vitest";
import { compileMemoryCandidate } from "../src/lib/memory";
import { memoryCandidates } from "../src/lib/memory/compiler-v2";
import { handoffFor } from "../src/lib/agent/handoff";
import { performanceHints, toolStats } from "../src/lib/tools/performance";

const state = {
  workspace: {
    repository: "https://github.com/acme/widgets",
    frameworks: ["Vitest", "TypeScript compiler"],
  },
  checkRuns: [
    { phase: "test", command: "npm run test", exitCode: 0 },
    { phase: "build", command: "npm run build", exitCode: 0 },
  ],
  toolEvidence: [
    {
      toolId: "workspace.run",
      ok: true,
      data: {
        command: "npm run test",
        exitCode: 1,
        analysis: { failureClass: "assertion", evidence: "expected 5, got -1" },
      },
    },
    {
      toolId: "workspace.run",
      ok: true,
      data: { command: "npm run test", exitCode: 0, analysis: null },
    },
  ],
  researchClaims: [
    {
      statement: "The registry is operated by the MCP project.",
      status: "SUPPORTED",
      confidence: 0.8,
    },
    {
      statement: "It lists every server in existence.",
      status: "INSUFFICIENT",
      confidence: 0.2,
    },
  ],
  retrieved: [{ url: "https://registry.modelcontextprotocol.io/" }],
};

describe("memory compiler V2", () => {
  it("derives experience from recorded commands and repairs, not prose", () => {
    const candidates = memoryCandidates({
      runId: "r1",
      armId: "coding",
      objective: "Fix the add test",
      answer: "Fixed.",
      verdicts: ["verified"],
      state,
    });
    const contents = candidates.map((candidate) => candidate.content);
    expect(contents).toContain(
      "In https://github.com/acme/widgets, `npm run test` is the test command; it exited 0 in run r1.",
    );
    expect(
      contents.some((text) =>
        /failed with a assertion failure .* passed after the run's change/.test(
          text,
        ),
      ),
    ).toBe(true);
    expect(
      contents.some((text) => text.startsWith("The registry is operated")),
    ).toBe(true);
    expect(
      contents.some((text) => text.startsWith("It lists every server")),
    ).toBe(false);
  });

  it("promotes nothing from a run that was not verified", () => {
    for (const verdicts of [["unverified"], ["verified", "rejected"], []]) {
      const candidates = memoryCandidates({
        runId: "r2",
        armId: "coding",
        objective: "x",
        answer: "y",
        verdicts,
        state,
      });
      for (const candidate of candidates) {
        expect(compileMemoryCandidate(candidate).decision).toBe("WORKING_ONLY");
      }
    }
  });

  it("promotes verified experience and marks a changed command as a conflict", () => {
    const [summary, testCommand] = memoryCandidates({
      runId: "r3",
      armId: "coding",
      objective: "x",
      answer: "y",
      verdicts: ["verified"],
      state,
    });
    expect(compileMemoryCandidate(summary!).decision).toBe(
      "PROMOTE_SECOND_BRAIN",
    );
    expect(
      compileMemoryCandidate(testCommand!, [
        {
          id: "old",
          tier: "second",
          kind: "pattern",
          content: "old",
          source: {},
          updatedAt: "",
          subjectKey: testCommand!.subjectKey,
          canonicalValue: "yarn test",
        },
      ]).decision,
    ).toBe("MARK_CONFLICT");
  });
});

describe("handoffs and tool records", () => {
  it("hands over typed evidence, never a transcript", () => {
    const coding = handoffFor(
      "coding",
      { ...state, workspaceDiff: "--- a/x\n+++ b/x\n-a\n+b\n" },
      "verified",
    );
    expect(coding.kind).toBe("change_evidence");
    if (coding.kind === "change_evidence") {
      expect(coding.commands.map((c) => c.exitCode)).toEqual([0, 0]);
      expect(coding.diffSummary).toContain("+++ b/x");
      expect(coding.diffSummary).not.toContain("+b");
    }
    const research = handoffFor("research", state, "unverified");
    expect(research.kind).toBe("research_facts");
    if (research.kind === "research_facts") {
      expect(research.verdict).toBe("unverified");
      expect(research.facts.map((fact) => fact.status)).toEqual(["SUPPORTED"]);
      expect(research.facts[0]!.sources).toEqual([
        "https://registry.modelcontextprotocol.io/",
      ]);
    }
  });

  it("reports tool performance as a hint for offered tools only", () => {
    const stats = toolStats([
      {
        tool_name: "workspace.run",
        calls: "10",
        completed: "9",
        p50: "1200.4",
        top_failure: "timeout",
      },
      {
        tool_name: "git.deliver",
        calls: "3",
        completed: "3",
        p50: null,
        top_failure: null,
      },
    ]);
    expect(performanceHints(stats, ["workspace.run"])).toEqual([
      "workspace.run: 90% success over 10 call(s), median 1200 ms, most common failure timeout",
    ]);
  });
});
