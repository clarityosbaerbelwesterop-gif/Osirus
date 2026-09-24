import { describe, expect, it } from "vitest";
import {
  extractCausalGraph,
  renderCausalNarrative,
} from "../src/lib/memory/causal";
import {
  assembleCausalWorldModel,
  buildCausalWorldModelFromOutcome,
  formatCausalContext,
} from "../src/lib/memory/causal-world-model";
import { memoryCandidates } from "../src/lib/memory/compiler-v2";
import {
  rankByTemporal,
  temporalDecay,
  temporalScore,
} from "../src/lib/memory/temporal";

const runState = {
  workspace: {
    repository: "https://github.com/acme/widgets",
    frameworks: ["Vitest"],
  },
  checkRuns: [
    { phase: "test", command: "npm run test", exitCode: 1 },
    { phase: "test", command: "npm run test", exitCode: 0 },
  ],
  toolEvidence: [
    {
      toolId: "workspace.run",
      ok: true,
      data: {
        command: "npm run test",
        exitCode: 1,
        analysis: { failureClass: "assertion", evidence: "expected 5" },
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
      statement: "Advisory locks serialize migrations.",
      status: "SUPPORTED",
      confidence: 0.82,
    },
  ],
  retrieved: [{ url: "https://neon.tech/docs" }],
  agentSteps: [
    {
      index: 0,
      action: "USE_TOOL",
      toolId: "workspace.run",
      outcome: "ok",
      summary: "Ran tests",
    },
    {
      index: 1,
      action: "VERIFY",
      outcome: "ok",
      summary: "Checked answer",
    },
  ],
};

describe("Memory OS II temporal model", () => {
  it("decays older items but never below the floor", () => {
    const recent = temporalDecay(new Date());
    const old = temporalDecay("2020-01-01T00:00:00.000Z");
    expect(recent).toBe(1);
    expect(old).toBeGreaterThan(0);
    expect(old).toBeLessThan(recent);
  });

  it("ranks fresher high-importance items above stale ones", () => {
    const ranked = rankByTemporal(
      [
        { id: "stale", updatedAt: "2020-01-01T00:00:00.000Z", importance: 0.9 },
        { id: "fresh", updatedAt: new Date().toISOString(), importance: 0.5 },
      ],
      () => 1,
    );
    expect(ranked[0]?.id).toBe("fresh");
    expect(temporalScore(1, "2020-01-01T00:00:00.000Z", 0.2)).toBeLessThan(
      temporalScore(1, new Date().toISOString(), 0.2),
    );
  });
});

describe("Memory OS II causal extraction", () => {
  it("links actions to outcomes from recorded check runs and repairs", () => {
    const { events, links } = extractCausalGraph({
      runId: "run-1",
      armId: "coding",
      objective: "Fix tests",
      answer: "Done",
      verdicts: ["verified"],
      state: runState,
    });
    expect(events.some((event) => event.kind === "action")).toBe(true);
    expect(events.some((event) => event.kind === "outcome")).toBe(true);
    expect(links.some((edge) => edge.relation === "caused")).toBe(true);
    expect(links.some((edge) => edge.relation === "enabled")).toBe(true);
  });

  it("renders causal chains as decision-ready narrative", () => {
    const graph = extractCausalGraph({
      runId: "run-2",
      armId: "coding",
      objective: "x",
      answer: "y",
      verdicts: ["verified"],
      state: runState,
    });
    const narrative = renderCausalNarrative(graph.events, graph.links, 4);
    expect(narrative.length).toBeGreaterThan(0);
    expect(narrative[0]).toContain("→");
  });

  it("connects research retrieval to supported claims", () => {
    const { links } = extractCausalGraph({
      runId: "run-3",
      armId: "research",
      objective: "locks",
      answer: "yes",
      verdicts: ["verified"],
      state: runState,
    });
    expect(
      links.some(
        (edge) =>
          edge.relation === "caused" && edge.provenance.kind === "research",
      ),
    ).toBe(true);
  });
});

describe("Memory OS II causal world model assembly", () => {
  it("assembles narrative and ranked events for the first brain", () => {
    const model = buildCausalWorldModelFromOutcome({
      runId: "run-4",
      armId: "coding",
      objective: "tests",
      answer: "fixed",
      verdicts: ["verified"],
      state: runState,
    });
    expect(model.narrative.length).toBeGreaterThan(0);
    expect(model.rankedEvents[0]?.temporalScore).toBeGreaterThan(0);
    const context = formatCausalContext(model, 4);
    expect(context.some((line) => line.startsWith("[causal]"))).toBe(true);
  });

  it("merges relational edges from persisted entities", () => {
    const model = assembleCausalWorldModel({
      events: [],
      links: [],
      nodes: [
        {
          id: "a",
          label: "repo:widgets",
          kind: "repository",
          confidence: 0.9,
          updatedAt: new Date().toISOString(),
        },
        {
          id: "b",
          label: "Vitest",
          kind: "framework",
          confidence: 0.8,
          updatedAt: new Date().toISOString(),
        },
      ],
      edges: [
        {
          from: "repo:widgets",
          to: "Vitest",
          relation: "uses",
          confidence: 0.85,
        },
      ],
    });
    const context = formatCausalContext(model, 3);
    expect(context.some((line) => line.startsWith("[relational]"))).toBe(true);
  });

  it("compiler v2 candidates and causal graph share the same run evidence", () => {
    const outcome = {
      runId: "run-5",
      armId: "coding",
      objective: "Fix",
      answer: "ok",
      verdicts: ["verified"],
      state: runState,
    };
    const candidates = memoryCandidates(outcome);
    const causal = extractCausalGraph(outcome);
    expect(candidates.length).toBeGreaterThan(0);
    expect(causal.events.length).toBeGreaterThan(0);
  });
});
