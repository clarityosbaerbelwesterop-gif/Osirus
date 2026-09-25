import { describe, expect, it } from "vitest";
import {
  addFacts,
  assessMissionGate,
  createMission,
  handoffLoss,
  reconcileMission,
  recordHandoff,
  recordSwitch,
  seedForStage,
} from "../src/lib/agent/mission";
import { createTaskState } from "../src/lib/agent/task-state";
import { runArenaTask } from "../src/lib/arena/harness";
import { gateVerdicts } from "../src/lib/arms/mission-runtime";
import type { ModelProvider } from "../src/lib/models/provider";
import {
  MemoryMissionStore,
  MissionConflictError,
  updateMission,
} from "../src/lib/runtime/missions";
import { LocalWorkspaceDriver } from "../src/lib/sandbox/local";

function mission() {
  return createMission({
    objective: "Find the rate, compute the total, build the report",
    successCriteria: ["The total is computed from a sourced rate"],
    nodes: [
      { key: "s0-research", capability: "research" },
      { key: "s1-math_science", capability: "math_science" },
      { key: "s2-coding", capability: "coding" },
    ],
  });
}

function kernel(overrides: Partial<ReturnType<typeof createTaskState>> = {}) {
  return { ...createTaskState({ objective: "x" } as never), ...overrides };
}

describe("mission state", () => {
  it("keeps facts with provenance and verified facts first", () => {
    let state = addFacts(mission(), [
      {
        statement: "The VAT rate is 19%",
        provenance: {
          capability: "research",
          stageKey: "s0-research",
          kind: "research",
        },
        evidenceRefs: ["https://example.test/vat"],
        verified: true,
        volatility: "slow",
      },
      {
        statement: "The customer wants a PDF",
        provenance: {
          capability: "research",
          stageKey: "s0-research",
          kind: "memory",
        },
        evidenceRefs: [],
        verified: false,
        volatility: "slow",
      },
    ]);
    // The same statement seen again merges; it does not duplicate.
    state = addFacts(state, [
      {
        statement: "the VAT rate is 19%.",
        provenance: {
          capability: "math_science",
          stageKey: "s1-math_science",
          kind: "compute",
        },
        evidenceRefs: ["compute:1"],
        verified: true,
        volatility: "static",
      },
    ]);
    expect(state.facts).toHaveLength(2);
    expect(state.facts[0]!.verified).toBe(true);
    expect(state.facts[0]!.evidenceRefs).toEqual([
      "https://example.test/vat",
      "compute:1",
    ]);
    const seed = seedForStage(state, "coding");
    expect(seed.task.knownFacts?.[0]).toMatch(
      /VAT rate is 19% \[verified; from research\/research; refs https:\/\/example.test\/vat/,
    );
  });

  it("keeps rejected hypotheses and flags a contradiction between capabilities", () => {
    let state = reconcileMission(mission(), {
      stageKey: "s0-research",
      capability: "research",
      kernel: kernel({
        hypotheses: [
          {
            id: "h1",
            statement: "The discount applies before tax",
            confidence: 0.6,
            supportingEvidence: ["doc:1"],
            counterEvidence: [],
            falsifiers: [],
            status: "SUPPORTED",
          },
          {
            id: "h2",
            statement: "The rate is 16%",
            confidence: 0.3,
            supportingEvidence: [],
            counterEvidence: ["doc:2"],
            falsifiers: [],
            status: "REJECTED",
          },
        ],
      }),
    });
    const seed = seedForStage(state, "math_science");
    expect(seed.context.join(" ")).toMatch(
      /rejected hypotheses.*The rate is 16%/,
    );
    state = reconcileMission(state, {
      stageKey: "s1-math_science",
      capability: "math_science",
      kernel: kernel({
        hypotheses: [
          {
            id: "h9",
            statement: "the discount applies before tax",
            confidence: 0.2,
            supportingEvidence: [],
            counterEvidence: ["compute:7"],
            falsifiers: [],
            status: "REJECTED",
          },
        ],
      }),
    });
    expect(state.contradictions).toEqual([
      {
        statement: "the discount applies before tax",
        between: ["research", "math_science"],
      },
    ]);
  });

  it("finishes a mission only on evidence for the whole contract", () => {
    const state = mission();
    const verified = (key: string, capability: string) => ({
      key,
      capability,
      verdict: "verified",
    });
    expect(
      assessMissionGate(state, [
        verified("s0-research", "research"),
        verified("s1-math_science", "math_science"),
        verified("s2-coding", "coding"),
      ]).status,
    ).toBe("complete");
    // Correct code with a rejected research claim is not complete.
    const rejectedResearch = assessMissionGate(state, [
      { key: "s0-research", capability: "research", verdict: "rejected" },
      verified("s1-math_science", "math_science"),
      verified("s2-coding", "coding"),
    ]);
    expect(rejectedResearch.status).toBe("failed");
    expect(rejectedResearch.missing[0]).toMatch(/research/);
    // A good last stage does not rescue failed tests earlier on.
    expect(
      assessMissionGate(state, [
        verified("s0-research", "research"),
        { key: "s1-coding", capability: "coding", verdict: "rejected" },
        verified("s2-building", "building"),
      ]).status,
    ).toBe("failed");
    // Unverified work is partial, never complete.
    expect(
      assessMissionGate(state, [
        verified("s0-research", "research"),
        {
          key: "s1-math_science",
          capability: "math_science",
          verdict: "unverified",
        },
      ]).status,
    ).toBe("partial");
    // An open contradiction between capabilities fails the mission.
    expect(
      assessMissionGate(
        {
          ...state,
          contradictions: [{ statement: "x", between: ["research", "coding"] }],
        },
        [verified("s0-research", "research")],
      ).status,
    ).toBe("failed");
  });

  it("reads the latest verdict per node and of the latest contract check", () => {
    const rows = [
      {
        ordinal: 1,
        verdict: "rejected",
        armId: "research",
        segment: 0,
        kind: "verify",
      },
      {
        ordinal: 5,
        verdict: "rejected",
        armId: "research",
        segment: 1,
        kind: "meta_verify",
      },
      {
        ordinal: 7,
        verdict: "verified",
        armId: "research",
        segment: 0,
        kind: "verify",
      },
      {
        ordinal: 9,
        verdict: "verified",
        armId: "research",
        segment: 2,
        kind: "meta_verify",
      },
      {
        ordinal: 3,
        verdict: null,
        armId: "research",
        segment: 0,
        kind: "answer",
      },
    ];
    expect(gateVerdicts(rows)).toEqual([
      { key: "s0-research", capability: "research", verdict: "verified" },
      {
        key: "meta-2",
        capability: "research",
        verdict: "verified",
        meta: true,
      },
    ]);
  });

  it("records a capability switch with its reason, evidence and new nodes", () => {
    const state = recordSwitch(
      mission(),
      {
        from: { capability: "research", stageKey: "s0-research" },
        to: "math_science",
        reason: "The source gives a formula that has to be evaluated",
        evidence: ["doc:3"],
        addedNodes: ["s3-math_science", "s4-research"],
      },
      [
        {
          key: "s3-math_science",
          capability: "math_science",
          objective: "Evaluate it",
        },
        { key: "s4-research", capability: "research", objective: "Continue" },
      ],
    );
    expect(state.switches).toHaveLength(1);
    expect(state.nodes.at(-2)?.inserted).toEqual({
      reason: "The source gives a formula that has to be evaluated",
      evidence: ["doc:3"],
      after: "s0-research",
    });
    expect(state.planRevisions.at(-1)?.reason).toBe(
      "capability switch to math_science",
    );
  });

  it("measures handoff loss", () => {
    expect(handoffLoss(recordHandoff(mission(), 10, 10))).toBe(0);
    expect(handoffLoss(recordHandoff(mission(), 10, 4))).toBe(0.6);
  });
});

describe("mission store", () => {
  it("lets two concurrent reconciliations both land", async () => {
    const store = new MemoryMissionStore();
    await store.create("run", mission());
    await Promise.all([
      updateMission(store, "run", (state) => ({
        ...state,
        openQuestions: [...state.openQuestions, "a"],
      })),
      updateMission(store, "run", (state) => ({
        ...state,
        openQuestions: [...state.openQuestions, "b"],
      })),
    ]);
    const final = await store.load("run");
    expect(final?.state.openQuestions.sort()).toEqual(["a", "b"]);
    expect(final?.version).toBe(3);
  });

  it("gives up loudly instead of overwriting when the row keeps moving", async () => {
    const store = new MemoryMissionStore();
    await store.create("run", mission());
    const racing = {
      load: store.load.bind(store),
      create: store.create.bind(store),
      save: async () => false,
    };
    await expect(
      updateMission(racing, "run", (state) => state, 3),
    ).rejects.toBeInstanceOf(MissionConflictError);
  });
});

function decisionProvider(decisions: unknown[]): ModelProvider {
  let index = 0;
  return {
    modelId: () => "scripted",
    structured: async <T>(input: { validate: (value: unknown) => T }) => {
      const next = decisions[Math.min(index, decisions.length - 1)];
      // Only a loop decision parses as one; everything else falls back.
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

describe("capability switching in a running mission", () => {
  it("adds the capability a stage finds missing, then continues the original one", async () => {
    const result = await runArenaTask(
      {
        id: "switch-math-to-research",
        suite: "compound",
        objective:
          "Compute the yearly cost of the plan at the current list price.",
        composition: ["math_science"],
        expect: {},
      },
      {
        provider: decisionProvider([
          {
            action: "SPAWN_WORKER",
            summary: "The list price is an external parameter I do not have",
            workerTask: {
              objective: "Establish the current list price of the plan",
              capability: "general",
            },
          },
          {
            action: "FINISH",
            summary: "Hand over",
            answer:
              "The yearly cost needs the current list price; a segment was added to establish it.",
          },
        ]),
        sandbox: async () => new LocalWorkspaceDriver(),
      },
    );
    expect(result.mission?.switches).toBe(1);
    const inserted = result.stages.filter((key) => /^s1-general-/.test(key));
    const continued = result.stages.filter((key) =>
      /^s2-math_science-/.test(key),
    );
    expect(inserted.length).toBeGreaterThan(0);
    expect(continued).toEqual([
      "s2-math_science-answer",
      "s2-math_science-verify",
    ]);
    // The original segment's verify ran before the inserted research, and
    // the continuation after it.
    const index = (key: string) => result.stages.indexOf(key);
    expect(index(inserted[0]!)).toBeGreaterThan(
      index("s0-math_science-answer"),
    );
    expect(index("s2-math_science-answer")).toBeGreaterThan(
      index(inserted.at(-1)!),
    );
    expect(result.mission?.planRevisions).toBeGreaterThanOrEqual(1);
    expect(result.events.join("\n")).toMatch(/mission.capability_added/);
  }, 60_000);
});
