import { describe, expect, it } from "vitest";
import {
  ablationCause,
  ablationHypotheses,
  attributeCredit,
  changedFields,
} from "../src/lib/intelligence/meta/credit";
import {
  planHypotheses,
  recordExperimentMeta,
} from "../src/lib/intelligence/meta/foundry-meta";
import {
  hypothesesFromExperience,
  mechanismOf,
  orderByMetaPolicy,
  updateMetaPolicy,
  emptyMetaPolicy,
} from "../src/lib/intelligence/meta/meta-policy";
import {
  cognitiveTelemetry,
  configurationVector,
} from "../src/lib/intelligence/meta/telemetry";
import { MemoryIntelStore } from "../src/lib/intelligence/store/memory-store";
import type {
  Experience,
  ExperimentDecision,
  Hypothesis,
  StrategyVersion,
} from "../src/lib/intelligence/types";

describe("cognitive telemetry", () => {
  it("measures from the record and says null where the record is silent", () => {
    const telemetry = cognitiveTelemetry({
      actions: [
        { action: "USE_TOOL", toolId: "compute.run", outcome: "ok" },
        { action: "USE_TOOL", toolId: "compute.run", outcome: "failed" },
        { action: "REPLAN", outcome: "ok" },
        { action: "VERIFY", outcome: "ok" },
        { action: "FINISH", outcome: "ok" },
      ],
      verified: true,
      falseCompletion: false,
      tokens: 4200,
      hypotheses: { confirmed: 2, rejected: 2, rejectedWithCounter: 1 },
    });
    expect(telemetry).toMatchObject({
      hypothesisPrecision: 0.5,
      rejectionQuality: 0.5,
      replanUsefulness: 1,
      toolChoiceQuality: 0.5,
      evidenceEfficiency: 0.2,
      verificationCoverage: 1,
      memoryUsefulness: null,
      switchQuality: null,
      falseCompletionAvoided: 1,
      tokensPerVerifiedSuccess: 4200,
    });
  });
});

function row(
  vector: Record<string, string>,
  verified: boolean,
  index: number,
): Experience {
  return {
    id: `r${index}`,
    source: "trial",
    taskRef: `t${index}`,
    taskType: "math",
    capabilityIds: ["math.word"],
    difficulty: null,
    strategyVersionId: null,
    model: null,
    skills: [],
    tools: [],
    trajectory: { configuration: vector },
    verification: { verdicts: [] },
    outcome: verified ? "verified_success" : "failure",
    failureClass: null,
    repairs: 0,
    costUsd: 0,
    tokens: 1000,
    latencyMs: 0,
    confidence: null,
    qualityScore: 0.5,
    fingerprint: `f${index}`,
    partition: "dev",
    provenance: {},
    createdAt: new Date().toISOString(),
  } as Experience;
}

describe("credit assignment", () => {
  const base = configurationVector({ genome: {}, model: "m", skills: [] });
  const deep = configurationVector({
    genome: { computeTier: "DEEP" },
    model: "m",
    skills: [],
  });
  const both = configurationVector({
    genome: { computeTier: "DEEP", math: { computeFirst: true } },
    model: "m",
    skills: [],
  });

  it("attributes an effect only across configurations that differ in one dimension", () => {
    let index = 0;
    const rows = [
      ...[1, 0, 0, 0, 0, 0].map((v) => row(base, Boolean(v), index++)),
      ...[1, 1, 1, 1, 1, 0].map((v) => row(deep, Boolean(v), index++)),
      ...[1, 1, 1, 1, 1, 1].map((v) => row(both, Boolean(v), index++)),
    ];
    const effects = attributeCredit(rows);
    // base vs deep differ in "tier" only; deep vs both in "math" only;
    // base vs both differ in two -- never compared.
    expect(effects.map((effect) => effect.dimension).sort()).toEqual([
      "math",
      "tier",
    ]);
    const tier = effects.find((effect) => effect.dimension === "tier")!;
    expect(tier).toMatchObject({
      from: "STANDARD",
      to: "DEEP",
      significant: true,
    });
    expect(tier.effect).toBeGreaterThan(0.4);
    // Product rows never count.
    expect(
      attributeCredit(
        rows.map((entry) => ({ ...entry, source: "product" as const })),
      ),
    ).toEqual([]);
  });

  it("splits a multi-change winner and names a cause only when one change carries the gain", () => {
    const champion = {};
    const winner = {
      computeTier: "DEEP" as const,
      math: { computeFirst: true },
    };
    expect(changedFields(champion, winner).sort()).toEqual([
      "computeTier",
      "math",
    ]);
    const variants = ablationHypotheses(champion, winner);
    expect(variants.map((variant) => variant.intervention)).toEqual([
      { computeTier: "DEEP" },
      { math: { computeFirst: true } },
    ]);
    expect(
      ablationCause({
        winnerGain: 0.3,
        variants: [
          { field: "computeTier", gain: 0.05, n: 8 },
          { field: "math", gain: 0.28, n: 8 },
        ],
      }),
    ).toMatchObject({ field: "math" });
    // Both halves carry part of it: no single cause.
    expect(
      ablationCause({
        winnerGain: 0.3,
        variants: [
          { field: "computeTier", gain: 0.15, n: 8 },
          { field: "math", gain: 0.15, n: 8 },
        ],
      }),
    ).toBeNull();
  });
});

describe("meta-policy", () => {
  const h = (
    intervention: Hypothesis["intervention"],
    gap: Hypothesis["gap"] = "verification",
  ): Hypothesis => ({
    id: JSON.stringify(intervention),
    gap,
    statement: "x",
    intervention,
    expected: "y",
  });

  it("classifies each hypothesis by the mechanism it changes", () => {
    expect(mechanismOf(h({ team: { topology: "solver_adversary" } }))).toBe(
      "topology",
    );
    expect(mechanismOf(h({ computeTier: "DEEP" }))).toBe("compute_tier");
    expect(mechanismOf(h({ tools: { include: ["gen.x@v1"] } }))).toBe(
      "generated_tool",
    );
    expect(mechanismOf(h({ math: { computeFirst: true } }))).toBe("tool_use");
    expect(mechanismOf(h({ research: { citeEverySentence: true } }))).toBe(
      "verifier",
    );
  });

  it("spends trials on the mechanisms that paid off, and still explores", () => {
    let policy = emptyMetaPolicy();
    for (let i = 0; i < 8; i += 1) {
      policy = updateMetaPolicy(policy, {
        gap: "verification",
        mechanism: "topology",
        improved: i < 6,
        effect: 0.2,
        extraTokens: 2000,
      });
      policy = updateMetaPolicy(policy, {
        gap: "verification",
        mechanism: "compute_tier",
        improved: false,
        effect: 0,
        extraTokens: 8000,
      });
    }
    const pool = [
      h({ computeTier: "DEEP" }),
      h({ team: { topology: "solver_adversary" } }),
    ];
    let topologyFirst = 0;
    for (let seed = 0; seed < 50; seed += 1)
      if (orderByMetaPolicy(pool, policy, `s${seed}`)[0]!.intervention.team)
        topologyFirst += 1;
    expect(topologyFirst).toBeGreaterThan(45);
    // Deterministic per cycle id.
    expect(orderByMetaPolicy(pool, policy, "c1")).toEqual(
      orderByMetaPolicy(pool, policy, "c1"),
    );
    // No record at all: the library's order stands.
    expect(orderByMetaPolicy(pool, emptyMetaPolicy(), "x")).toEqual(pool);
    // An unseen mechanism ranks above one that keeps failing: exploration.
    const withNew = [
      h({ computeTier: "DEEP" }),
      h({ memory: { limit: 4 } }, "verification"),
    ];
    expect(orderByMetaPolicy(withNew, policy, "e1")[0]!.intervention).toEqual({
      memory: { limit: 4 },
    });
  });

  it("turns a weakness shared by several tasks into one bounded hypothesis", () => {
    const weak = (index: number, task: string) =>
      ({
        ...row({}, false, index),
        taskRef: task,
        trajectory: {
          telemetry: cognitiveTelemetry({
            actions: [{ action: "FINISH", outcome: "ok" }],
            verified: false,
            falseCompletion: true,
            tokens: 100,
          }),
        },
      }) as Experience;
    const rows = [weak(1, "a"), weak(2, "b"), weak(3, "c")];
    const hypotheses = hypothesesFromExperience({
      arm: "coding",
      experience: rows,
    });
    expect(hypotheses.map((entry) => entry.intervention)).toEqual([
      {
        directives: [
          "Before finishing, verify the result with a tool or an independent check.",
        ],
      },
      { team: { topology: "solver_adversary" } },
    ]);
    expect(hypotheses[0]!.origin).toBe("experience");
    // Two tasks are not a pattern.
    expect(
      hypothesesFromExperience({ arm: "coding", experience: rows.slice(0, 2) }),
    ).toEqual([]);
  });
});

describe("the Foundry learns which change caused a win", () => {
  it("leaves an ablation plan for a multi-change winner, runs it next, and names the cause", async () => {
    const store = new MemoryIntelStore();
    const champion = { id: "champ", genome: {} } as StrategyVersion;
    const hypothesis: Hypothesis = {
      id: "h-both",
      gap: "verification",
      statement: "tier and compute-first",
      intervention: { computeTier: "DEEP", math: { computeFirst: true } },
      expected: "",
    };
    const winner = {
      id: "win",
      genome: hypothesis.intervention,
      mutation: { hypothesis: "h-both" },
    } as unknown as StrategyVersion;
    const comparison = (versionId: string, challenger: number) => ({
      versionId,
      partition: "dev" as const,
      tasks: 10,
      champion: { verified: 4, n: 10 },
      challenger: { verified: challenger, n: 10 },
      probabilityBetter: 0.95,
      discordant: { challengerOnly: 3, championOnly: 0 },
      signTestP: 0.05,
      costRatio: 1.2,
      falseCompletionDelta: 0,
    });
    const improved: ExperimentDecision = {
      outcome: "improved",
      winnerVersionId: "win",
      summary: "better",
      comparisons: [comparison("win", 7)],
    };
    await recordExperimentMeta(store, {
      cycleId: "c1",
      capabilityId: "math.word",
      champion,
      challengers: [winner],
      hypotheses: [hypothesis],
      decision: improved,
      ablation: null,
    });
    const meta = await store.listArtifacts({ kind: "meta_policy" });
    expect(meta[0]!.content.stats).toEqual([
      expect.objectContaining({
        mechanism: "compute_tier",
        tried: 1,
        improved: 1,
      }),
    ]);

    // The next cycle for this capability tests the single changes.
    const planned = await planHypotheses(store, {
      capabilityId: "math.word",
      cycleId: "c2",
      pool: [],
      limit: 2,
    });
    expect(planned.ablation?.kind).toBe("ablation_result");
    expect(planned.hypotheses.map((entry) => entry.intervention)).toEqual([
      { computeTier: "DEEP" },
      { math: { computeFirst: true } },
    ]);
    expect((await store.listGenerationRuns(5))[0]?.kind).toBe("ablation");

    const variants = planned.hypotheses.map(
      (entry, index) =>
        ({
          id: `v${index}`,
          genome: entry.intervention,
          mutation: { hypothesis: entry.id },
        }) as unknown as StrategyVersion,
    );
    await recordExperimentMeta(store, {
      cycleId: "c2",
      capabilityId: "math.word",
      champion,
      challengers: variants,
      hypotheses: planned.hypotheses,
      decision: {
        outcome: "improved",
        winnerVersionId: "v1",
        summary: "",
        comparisons: [comparison("v0", 4), comparison("v1", 7)],
      },
      ablation: planned.ablation,
    });
    const causal = await store.listArtifacts({ kind: "causal_memory" });
    expect(causal[0]!.content).toMatchObject({
      intervention: "math",
      direction: "improves",
    });
    const resolved = await store.listArtifacts({ kind: "ablation_result" });
    expect(resolved[0]!.status).toBe("active");
  });
});
