import { describe, expect, it } from "vitest";
import { z } from "zod";
import { decisionProblems } from "../src/lib/agent/decision";
import {
  actionKey,
  frontier,
  horizonOf,
  openWait,
  parkingFor,
  pruneExpired,
  reconcileGoals,
  recordAction,
  revalidateMission,
  wakeFor,
  wakeState,
} from "../src/lib/agent/long-horizon";
import { addFacts, createMission } from "../src/lib/agent/mission";
import { longHorizonComparison } from "../src/lib/agent/pulse/long-horizon-suite";
import { createTaskState } from "../src/lib/agent/task-state";
import { runArenaTask } from "../src/lib/arena/harness";
import type { ModelProvider } from "../src/lib/models/provider";
import { settlementFor } from "../src/lib/runtime/settlement";
import { eventKeysFor } from "../src/lib/runtime/waits";
import { LocalWorkspaceDriver } from "../src/lib/sandbox/local";
import {
  ToolRegistry,
  type ActionLedger,
  type ToolDefinition,
} from "../src/lib/tools/registry";

const NOW = Date.parse("2026-09-25T12:00:00Z");

function mission() {
  return createMission({
    objective: "Ship and report",
    nodes: [{ key: "s0-general", capability: "general" }],
  });
}

describe("typed waits", () => {
  it("bounds every wait and parks it without a claim before it is due", () => {
    const schedule = wakeFor(
      {
        kind: "schedule",
        reason: "run at noon",
        until: "2030-01-01T00:00:00Z",
      },
      NOW,
    );
    // Clamped to seven days: a wait cannot park a run forever.
    expect(schedule).toEqual({ kind: "time", at: "2026-10-02T12:00:00.000Z" });
    expect(parkingFor(schedule, NOW)).toEqual({
      stageStatus: "blocked",
      retryDelaySeconds: 7 * 24 * 3600,
    });
    const ci = wakeFor(
      { kind: "ci", reason: "tests on main", ref: "main" },
      NOW,
    );
    expect(ci).toMatchObject({ kind: "poll", probe: "ci", ref: "main" });
    expect(parkingFor(ci, NOW)).toEqual({
      stageStatus: "blocked",
      retryDelaySeconds: 300,
    });
    const event = wakeFor(
      { kind: "external_event", reason: "partner", eventKey: "generic:*:x" },
      NOW,
    );
    expect(parkingFor(event, NOW).stageStatus).toBe("blocked");
    expect(parkingFor({ kind: "human" }, NOW)).toEqual({
      stageStatus: "waiting",
      retryDelaySeconds: 0,
    });
  });

  it("stores a typed wait so only a person makes the run wait for approval", () => {
    const polled = settlementFor(
      {
        kind: "WAITING",
        reason: "deployment",
        wake: wakeFor({ kind: "deployment", reason: "d", ref: "main" }, NOW),
        output: {},
      },
      NOW,
    );
    expect(polled.stageStatus).toBe("blocked");
    expect(polled.retryDelaySeconds).toBe(300);
    expect(polled.output).toMatchObject({
      waitingOn: "deployment",
      wait: { kind: "deployment", wake: { kind: "poll", ref: "main" } },
    });
    // A pre-M40 approval wait is stored exactly as before.
    expect(
      settlementFor({ kind: "WAITING", reason: "approval", output: {} }),
    ).toEqual({
      attemptStatus: "completed",
      stageStatus: "waiting",
      output: { waitingOn: "approval" },
      retryDelaySeconds: 0,
    });
  });

  it("wakes on time, on a probe, or at the deadline -- never on its own", async () => {
    const opened = openWait(mission(), {
      kind: "deployment",
      reason: "deploy",
      stageKey: "s0-general",
      wake: wakeFor({ kind: "deployment", reason: "d", ref: "main" }, NOW),
      since: new Date(NOW).toISOString(),
    });
    const wait = opened.wait;
    expect(horizonOf(opened.mission).nextWake).toBe("2026-09-25T14:00:00.000Z");
    const unmet = async () => ({ state: "unmet" as const });
    expect((await wakeState(wait, NOW + 60_000, unmet)).ready).toBe(false);
    const met = async () => ({ state: "met" as const, detail: "ready" });
    expect(await wakeState(wait, NOW + 60_000, met)).toEqual({
      ready: true,
      how: "ready",
      observed: true,
    });
    const late = await wakeState(wait, NOW + 3 * 3600_000, unmet);
    expect(late.ready).toBe(true);
    expect(late.observed).toBe(false);
    expect(late.how).toMatch(/not observed before/);
    // A person is never polled.
    expect(
      (await wakeState({ ...wait, wake: { kind: "human" } }, NOW * 2, met))
        .ready,
    ).toBe(false);
  });

  it("requires what each wait needs to end", () => {
    const base = { action: "WAIT" as const, summary: "wait" };
    expect(
      decisionProblems({ ...base, wait: { kind: "ci", reason: "x" } }),
    ).toEqual(["WAIT ci requires wait.ref."]);
    expect(
      decisionProblems({ ...base, wait: { kind: "schedule", reason: "x" } }),
    ).toEqual(["WAIT schedule requires wait.until."]);
    expect(
      decisionProblems({
        ...base,
        wait: { kind: "dependency", reason: "x", eventKey: "push:o/r:main" },
      }),
    ).toEqual([]);
  });

  it("maps a delivery to every key a wait can name", () => {
    expect(
      eventKeysFor({
        kind: "deployment",
        repository: "o/r",
        ref: "refs/heads/main",
      }).sort(),
    ).toEqual([
      "deployment",
      "deployment:*:main",
      "deployment:*:refs/heads/main",
      "deployment:o/r",
      "deployment:o/r:main",
      "deployment:o/r:refs/heads/main",
    ]);
  });
});

describe("temporal re-validation", () => {
  it("invalidates what expired, weakens what rested on it, and says so", () => {
    let state = addFacts(
      mission(),
      [
        {
          statement: "Production serves API version 1",
          provenance: { capability: "general", stageKey: "s0", kind: "tool" },
          evidenceRefs: ["tool:api.version:1"],
          verified: true,
          volatility: "event",
        },
        {
          statement: "The quote is valid",
          provenance: { capability: "general", stageKey: "s0", kind: "tool" },
          evidenceRefs: ["tool:quote:1"],
          verified: true,
          volatility: "slow",
          validUntil: new Date(NOW - 1000).toISOString(),
        },
        {
          statement: "Pi is about 3.14159",
          provenance: { capability: "math", stageKey: "s0", kind: "compute" },
          evidenceRefs: [],
          verified: true,
          volatility: "static",
        },
      ],
      new Date(NOW - 60_000).toISOString(),
    );
    state = {
      ...state,
      hypotheses: [
        {
          statement: "Clients can keep calling v1",
          status: "SUPPORTED",
          owner: "general",
          supporting: ["tool:api.version:1"],
          counter: [],
        },
      ],
    };
    const result = revalidateMission(state, NOW, { afterWait: true });
    expect(result.expired.sort()).toEqual([
      "Production serves API version 1",
      "The quote is valid",
    ]);
    expect(result.weakened).toEqual(["Clients can keep calling v1"]);
    expect(result.mission.hypotheses[0]!.status).toBe("WEAKENED");
    expect(
      result.mission.facts.find((fact) => /Pi/.test(fact.statement))
        ?.invalidated,
    ).toBeNull();
    expect(result.mission.planRevisions.at(-1)?.reason).toMatch(/resume/);
    // Nothing is deleted: the fact stays, marked, with its reason.
    expect(result.mission.facts).toHaveLength(3);
    // Without a wait, an event fact within its window stays valid.
    expect(revalidateMission(state, NOW).expired).toEqual([
      "The quote is valid",
    ]);
  });

  it("takes the most volatile sighting of a fact", () => {
    const state = addFacts(
      addFacts(mission(), [
        {
          statement: "The unit price is 12 EUR",
          provenance: { capability: "research", stageKey: "s0", kind: "seed" },
          evidenceRefs: [],
          verified: true,
          volatility: "slow",
        },
      ]),
      [
        {
          statement: "the unit price is 12 EUR.",
          provenance: { capability: "research", stageKey: "s0", kind: "tool" },
          evidenceRefs: ["tool:price"],
          verified: true,
          volatility: "event",
        },
      ],
    );
    expect(state.facts).toHaveLength(1);
    expect(state.facts[0]!.volatility).toBe("event");
  });

  it("drops an expired fact from a resumed kernel and asks to re-observe it", () => {
    const kernel = {
      ...createTaskState({ objective: "x" } as never),
      knownFacts: [
        "Production serves API version 1 [verified; from general/tool]",
        "Region is eu-central",
      ],
    };
    const pruned = pruneExpired(kernel, ["Production serves API version 1"]);
    expect(pruned.knownFacts).toEqual(["Region is eu-central"]);
    expect(pruned.openQuestions.at(-1)).toBe(
      "Re-observe: Production serves API version 1",
    );
  });
});

describe("goal stack", () => {
  it("resumes at the first active goal whose prerequisites are done", () => {
    const kernel = {
      ...createTaskState({ objective: "x" } as never),
      plan: [
        { id: "p1", title: "Build", status: "done" },
        { id: "p2", title: "Deploy", status: "blocked" },
        { id: "p3", title: "Report", status: "pending" },
      ],
    } as never;
    let state = reconcileGoals(mission(), kernel);
    expect(frontier(state)).toBeNull();
    state = {
      ...state,
      goals: state.goals!.map((goal) =>
        goal.id === "p2" ? { ...goal, status: "completed" as const } : goal,
      ),
    };
    expect(frontier(state)?.title).toBe("Report");
  });
});

function publishTool(effects: { count: number }): ToolDefinition {
  return {
    id: "release.publish",
    title: "Publish",
    summary: "Publish a release",
    trust: "builtin",
    effect: "external",
    risk: "medium",
    arms: ["general"],
    inputSchema: z.object({ version: z.string() }),
    run: async () => {
      effects.count += 1;
      return { ok: true };
    },
  } as ToolDefinition;
}

function memoryLedger(): ActionLedger & { state: ReturnType<typeof mission> } {
  const holder = { state: mission() };
  return {
    get state() {
      return holder.state;
    },
    lookup: async (key) => {
      const entry = holder.state.actions?.find((action) => action.key === key);
      return entry ? { phase: entry.phase, summary: entry.summary } : null;
    },
    record: async (entry) => {
      holder.state = recordAction(holder.state, entry);
    },
  };
}

const CONTEXT = {
  runId: "r",
  stageId: "s",
  armId: "general" as const,
  organizationId: "o",
  workspaceId: "w",
};

describe("action ledger", () => {
  it("runs an external action once across a replay", async () => {
    const effects = { count: 0 };
    const ledger = memoryLedger();
    const make = () =>
      new ToolRegistry({ approvalGate: async () => "approved" })
        .register(publishTool(effects))
        .useLedger(ledger);
    const first = await make().invoke({
      toolId: "release.publish",
      rawInput: { version: "2.1.0" },
      context: CONTEXT,
    });
    // A new worker after a crash replays the same call.
    const replay = await make().invoke({
      toolId: "release.publish",
      rawInput: { version: "2.1.0" },
      context: CONTEXT,
    });
    expect(first.ok && replay.ok).toBe(true);
    expect(effects.count).toBe(1);
    expect(replay.data).toMatchObject({ alreadyDone: true });
    // A different input is a different action.
    await make().invoke({
      toolId: "release.publish",
      rawInput: { version: "2.1.1" },
      context: CONTEXT,
    });
    expect(effects.count).toBe(2);
  });

  it("does not repeat a call that started but never recorded its end", async () => {
    const effects = { count: 0 };
    const ledger = memoryLedger();
    await ledger.record({
      key: actionKey("release.publish", { version: "2.1.0" }),
      toolId: "release.publish",
      phase: "intent",
      irreversible: true,
      summary: "started",
    });
    const result = await new ToolRegistry({
      approvalGate: async () => "approved",
    })
      .register(publishTool(effects))
      .useLedger(ledger)
      .invoke({
        toolId: "release.publish",
        rawInput: { version: "2.1.0" },
        context: CONTEXT,
      });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/^action_outcome_unknown/);
    expect(effects.count).toBe(0);
  });

  it("fails closed when the start cannot be recorded", async () => {
    const effects = { count: 0 };
    const result = await new ToolRegistry({
      approvalGate: async () => "approved",
    })
      .register(publishTool(effects))
      .useLedger({
        lookup: async () => null,
        record: async () => {
          throw new Error("down");
        },
      })
      .invoke({
        toolId: "release.publish",
        rawInput: { version: "2.1.0" },
        context: CONTEXT,
      });
    expect(result.error).toMatch(/^action_ledger_unavailable/);
    expect(effects.count).toBe(0);
  });

  it("keys an action by its input, whatever the property order", () => {
    expect(actionKey("t", { a: 1, b: { c: 2, d: 3 } })).toBe(
      actionKey("t", { b: { d: 3, c: 2 }, a: 1 }),
    );
    expect(actionKey("t", { a: 1 })).not.toBe(actionKey("t", { a: 2 }));
  });
});

describe("LONG_HORIZON pulse", () => {
  it("finishes verified across crashes and waits, spending nothing while waiting", async () => {
    const rows = await longHorizonComparison();
    for (const { horizon } of rows) {
      expect(horizon.verifiedSuccess, horizon.id).toBe(true);
      expect(horizon.falseCompletion, horizon.id).toBe(false);
      expect(horizon.modelCallsWhileWaiting, horizon.id).toBe(0);
      expect(horizon.duplicateExternalActions, horizon.id).toBe(0);
      expect(horizon.staleFactsUsed, horizon.id).toBe(0);
    }
    const l5 = rows[4]!.horizon;
    expect(l5.crashes).toBe(1);
    expect(l5.parkedSlices).toBeGreaterThanOrEqual(1);
    expect(l5.planRevisions).toBeGreaterThanOrEqual(1);
    expect(l5.notes).toMatch(/provider refusal/);
    // Without M40 the same policy spins, repeats and trusts stale facts.
    const baseline = rows.map((row) => row.baseline);
    expect(baseline.filter((row) => row.verifiedSuccess).length).toBeLessThan(
      5,
    );
    expect(
      baseline.reduce((sum, row) => sum + row.modelCallsWhileWaiting, 0),
    ).toBeGreaterThan(0);
    expect(rows[2]!.baseline.duplicateExternalActions).toBe(1);
    expect(rows[3]!.baseline.staleFactsUsed).toBe(1);
  });
});

function decisionProvider(decisions: unknown[], calls: { count: number }) {
  let index = 0;
  return {
    modelId: () => "scripted",
    structured: async <T>(input: { validate: (value: unknown) => T }) => {
      calls.count += 1;
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

describe("a production arm parks on a typed wait", () => {
  it("costs no model call while parked and resumes when the probe sees it", async () => {
    const calls = { count: 0 };
    const seen: number[] = [];
    let probes = 0;
    const result = await runArenaTask(
      {
        id: "wait-for-deploy",
        suite: "compound",
        objective: "When the deployment of main is ready, say so.",
        composition: ["general"],
        expect: {},
      },
      {
        provider: decisionProvider(
          [
            {
              action: "WAIT",
              summary: "Wait for the deployment of main",
              wait: {
                kind: "deployment",
                reason: "deploy of main",
                ref: "main",
              },
            },
            {
              action: "FINISH",
              summary: "Report",
              answer: "The deployment of main is ready.",
            },
          ],
          calls,
        ),
        sandbox: async () => new LocalWorkspaceDriver(),
        waitProbe: async () => {
          probes += 1;
          seen.push(calls.count);
          return probes >= 3
            ? { state: "met", detail: "deployment main ready" }
            : { state: "unmet" };
        },
      },
    );
    expect(probes).toBe(3);
    // Every probe saw the same model-call count: parking spent nothing.
    expect(new Set(seen).size).toBe(1);
    expect(result.stages).toContain("s0-general-answer");
    expect(result.events.join("\n")).not.toMatch(/failed/);
  }, 60_000);
});
