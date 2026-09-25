import { describe, expect, it } from "vitest";
import { TEAM_TASKS } from "../src/lib/agent/pulse/team-suite";
import {
  settleDisagreement,
  teamWorthwhile,
  topologyOf,
  weighAttacks,
  type CheckRunner,
} from "../src/lib/agent/team";
import { runArenaTask } from "../src/lib/arena/harness";
import { registryCheckRunner } from "../src/lib/arms/team-runtime";
import {
  architectureOf,
  hypothesesFor,
} from "../src/lib/intelligence/strategies/genomes";
import {
  delegationValue,
  estimateTopologies,
  topologyHypothesis,
} from "../src/lib/intelligence/routing/value-of-compute";
import type {
  Experience,
  StrategyVersion,
} from "../src/lib/intelligence/types";
import type { ModelProvider } from "../src/lib/models/provider";
import { LocalWorkspaceDriver } from "../src/lib/sandbox/local";
import { genomeSchema } from "../src/lib/strategy/runtime";
import { ToolRegistry } from "../src/lib/tools/registry";

/** A check runner that answers compute checks with a fixed table. */
function table(values: Record<string, number>): CheckRunner {
  return async (check) =>
    check.kind === "compute" && check.expression in values
      ? {
          ran: true,
          observed: String(values[check.expression]),
          passed: true,
          evidenceRef: `compute:${check.expression}`,
        }
      : null;
}

describe("team topology", () => {
  it("reads the topology from the genome; the M26 critic is solver_critic", () => {
    expect(topologyOf({})).toBe("single");
    expect(topologyOf({ team: { critic: true } })).toBe("solver_critic");
    expect(
      topologyOf({ team: { critic: true, topology: "solver_adversary" } }),
    ).toBe("solver_adversary");
    expect(
      architectureOf({ team: { topology: "parallel_solvers_judge" } }),
    ).toBe("parallel_solvers_judge");
    expect(() =>
      genomeSchema.parse({ team: { topology: "swarm_of_100" } }),
    ).toThrow();
    expect(() => genomeSchema.parse({ team: { solvers: 5 } })).toThrow();
  });

  it("forms a team only while the draft is uncertain", () => {
    const base = { openHypotheses: 0, contradictions: 0 };
    expect(
      teamWorthwhile({
        topology: "parallel_solvers_judge",
        verification: "verified",
        ...base,
      }).form,
    ).toBe(false);
    expect(
      teamWorthwhile({
        topology: "parallel_solvers_judge",
        verification: "rejected",
        ...base,
      }).form,
    ).toBe(true);
    expect(
      teamWorthwhile({ topology: "single", verification: "rejected", ...base })
        .form,
    ).toBe(false);
  });
});

describe("disagreement engine", () => {
  it("lets a recomputation beat a majority", async () => {
    const settled = await settleDisagreement({
      drafts: [
        {
          answer: "45",
          claim: "45",
          owner: "a",
          check: { kind: "compute", expression: "4*12" },
        },
        { answer: "45!", claim: "45", owner: "b" },
        { answer: "48", claim: "48", owner: "c" },
      ],
      runCheck: table({ "4*12": 48 }),
    });
    expect(settled.majority).toBe("45");
    expect(settled.answer).toBe("48");
    expect(settled.resolution).toBe("discriminating_test");
    const byClaim = Object.fromEntries(
      settled.blackboard.map((entry) => [entry.claim, entry.status]),
    );
    expect(byClaim).toEqual({ "45": "refuted", "48": "confirmed" });
  });

  it("never falls back to a vote: without a deciding test the first draft stays, disputed", async () => {
    const settled = await settleDisagreement({
      drafts: [
        { answer: "first", claim: "7", owner: "a" },
        { answer: "second", claim: "9", owner: "b" },
        { answer: "third", claim: "9", owner: "c" },
      ],
      runCheck: table({}),
    });
    expect(settled.majority).toBe("9");
    expect(settled.answer).toBe("first");
    expect(settled.resolution).toBe("unresolved");
    expect(
      settled.blackboard.every((entry) => entry.status === "disputed"),
    ).toBe(true);
  });

  it("escalates once to a test the judge names", async () => {
    const settled = await settleDisagreement({
      drafts: [
        { answer: "a", claim: "12", owner: "a" },
        { answer: "b", claim: "14", owner: "b" },
      ],
      runCheck: table({ "2*7": 14 }),
      discriminate: async () => ({ kind: "compute", expression: "2*7" }),
    });
    expect(settled.resolution).toBe("escalated_test");
    expect(settled.answer).toBe("b");
  });

  it("runs the same check once", async () => {
    let runs = 0;
    const counting: CheckRunner = async (check) => {
      runs += 1;
      return table({ "1+1": 2 })(check);
    };
    await settleDisagreement({
      drafts: [
        {
          answer: "2",
          claim: "2",
          owner: "a",
          check: { kind: "compute", expression: "1+1" },
        },
        {
          answer: "3",
          claim: "3",
          owner: "b",
          check: { kind: "compute", expression: "1+1" },
        },
      ],
      runCheck: counting,
    });
    expect(runs).toBe(1);
  });

  it("counts an attack only when its check confirms it", async () => {
    const weighed = await weighAttacks({
      claim: "96",
      runCheck: table({ "40+35+27": 102, "50+46": 96 }),
      issues: [
        {
          kind: "arithmetic",
          statement: "sum is off",
          check: { kind: "compute", expression: "40+35+27" },
        },
        {
          kind: "arithmetic",
          statement: "other sum",
          check: { kind: "compute", expression: "50+46" },
        },
        { kind: "assumption", statement: "shipping?" },
      ],
    });
    expect(weighed.confirmed).toEqual(["sum is off (observed: 102)"]);
    expect(weighed.open).toEqual([
      "other sum (checked, not confirmed)",
      "shipping?",
    ]);
  });

  it("runs checks only through tools the arm is offered", async () => {
    const registry = new ToolRegistry();
    const run = registryCheckRunner(
      registry,
      {
        runId: "r",
        stageId: "s",
        armId: "general",
        organizationId: "o",
        workspaceId: "w",
      },
      "general",
    );
    expect(
      await run({ kind: "command", cmd: "rm", args: ["-rf", "/"] }),
    ).toBeNull();
  });
});

function experience(
  versionId: string,
  outcome: Experience["outcome"],
  tokens: number,
): Experience {
  return {
    id: `${versionId}-${Math.random()}`,
    source: "trial",
    taskRef: null,
    taskType: "math",
    capabilityIds: ["math.word"],
    difficulty: null,
    strategyVersionId: versionId,
    model: null,
    skills: [],
    tools: [],
    trajectory: {},
    verification: { verdicts: [] },
    outcome,
    failureClass: null,
    repairs: 0,
    costUsd: 0,
    tokens,
    latencyMs: 0,
    confidence: null,
    qualityScore: 0,
    fingerprint: "f",
    partition: null,
    provenance: {},
    createdAt: new Date().toISOString(),
  } as Experience;
}

describe("value of delegation", () => {
  const versions = new Map<string, StrategyVersion>([
    ["single", { id: "single", genome: {} } as StrategyVersion],
    [
      "team",
      {
        id: "team",
        genome: { team: { topology: "parallel_solvers_judge", solvers: 2 } },
      } as StrategyVersion,
    ],
  ]);

  it("recommends a team only when its measured gain outweighs its tokens", () => {
    const rows = [
      ...["verified_success", "failed", "failed", "failed"].map((o) =>
        experience("single", o as Experience["outcome"], 2000),
      ),
      ...[
        "verified_success",
        "verified_success",
        "verified_success",
        "failed",
      ].map((o) => experience("team", o as Experience["outcome"], 5000)),
    ];
    const estimates = estimateTopologies(rows, versions, "math.word");
    const single = estimates.find((e) => e.topology === "single")!;
    const team = estimates.find(
      (e) => e.topology === "parallel_solvers_judge",
    )!;
    const value = delegationValue(single, team);
    expect(value.measured).toBe(true);
    expect(value.worthwhile).toBe(true);
    expect(value.extraKTokens).toBe(3);
    // The same gain at 40k extra tokens does not pay.
    expect(
      delegationValue(single, { ...team, meanTokens: 42_000 }).worthwhile,
    ).toBe(false);
    const hypothesis = topologyHypothesis(estimates, {}, "math_science");
    expect(hypothesis?.intervention).toEqual({
      team: { topology: "parallel_solvers_judge", solvers: 2 },
    });
    expect(hypothesis?.statement).toMatch(/favours parallel_solvers_judge/);
  });

  it("explores an unmeasured topology as a paired trial, never as a rollout", () => {
    const hypothesis = topologyHypothesis(
      estimateTopologies([], versions, "math.word"),
      {},
      "coding",
    );
    expect(hypothesis?.intervention).toEqual({
      team: { topology: "solver_adversary" },
    });
    expect(hypothesis?.statement).toMatch(/unmeasured/);
  });

  it("offers team hypotheses in the Foundry library", () => {
    const math = hypothesesFor(
      "math_science",
      [{ kind: "verification" } as never],
      {},
      8,
    );
    expect(
      math.some(
        (h) =>
          (h.intervention.team as { topology?: string } | undefined)
            ?.topology === "parallel_solvers_judge",
      ),
    ).toBe(true);
  });
});

describe("team pulse", () => {
  it("settles by test where a single worker and a vote are wrong", async () => {
    for (const task of TEAM_TASKS) {
      const record = await task.run();
      expect(record.verifiedSuccess, record.id).toBe(true);
      expect(record.single.verified, record.id).toBe(false);
      if (record.majority?.pick)
        expect(record.majority.verified, record.id).toBe(false);
      expect(record.testsRun, record.id).toBeGreaterThan(0);
    }
  }, 60_000);
});

/** Answers team roles by request id; loop decisions from a script. */
function teamProvider(decisions: unknown[], roles: Record<string, unknown>) {
  let index = 0;
  return {
    modelId: () => "scripted",
    structured: async <T>(input: {
      requestId?: string;
      validate: (value: unknown) => T;
    }) => {
      const role = Object.keys(roles).find((key) =>
        input.requestId?.endsWith(`:${key}`),
      );
      if (role)
        return {
          value: input.validate(roles[role]),
          usage: { inputTokens: 10, outputTokens: 5, cost: 0 },
        };
      const next = decisions[Math.min(index, decisions.length - 1)];
      const value = input.validate(next);
      index += 1;
      return { value, usage: { inputTokens: 10, outputTokens: 5, cost: 0 } };
    },
    complete: async () => ({ text: "", usage: {} }),
    stream: async function* () {},
    capabilities: async () => ({}),
    healthCheck: async () => true,
    cancel: async () => undefined,
    normalizeUsage: () => ({}),
    normalizeError: () => new Error("x"),
  } as unknown as ModelProvider;
}

describe("a production arm runs its policy's team", () => {
  it("replaces a draft a recomputation refutes", async () => {
    const result = await runArenaTask(
      {
        id: "team-in-arm",
        suite: "compound",
        objective: "How many bottles are in 4 crates of 12?",
        composition: ["general"],
        expect: {},
      },
      {
        provider: teamProvider(
          [
            {
              action: "FINISH",
              summary: "Answer",
              answer: "There are 45 bottles.",
            },
          ],
          {
            restate: {
              claim: "45",
              check: { kind: "compute", expression: "4 * 12" },
            },
            "solver-2": {
              answer: "4 crates of 12 hold 48 bottles.",
              claim: "48",
              check: { kind: "compute", expression: "4 * 12" },
            },
          },
        ),
        sandbox: async () => new LocalWorkspaceDriver(),
        policy: {
          strategyVersionId: null,
          label: "team trial",
          genome: { team: { topology: "parallel_solvers_judge", solvers: 2 } },
          assignment: "trial",
        },
      },
    );
    expect(result.events.join("\n")).toMatch(/team\.settled/);
    expect(result.answerExcerpt).toMatch(/48 bottles/);
  }, 60_000);
});
