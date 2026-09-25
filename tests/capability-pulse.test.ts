import { describe, expect, it } from "vitest";
import {
  coverage,
  planCycle,
  pulseCatalog,
  suiteVersion,
} from "../src/lib/agent/pulse/catalog";
import { CAPABILITY_LANES, normalizeLane } from "../src/lib/agent/pulse/lanes";
import {
  PULSE_INTERVAL_MS,
  PULSE_LEASE_SECONDS,
  runPulseSlice,
  STALE_CYCLE_MS,
} from "../src/lib/agent/pulse/runner";
import { MemoryPulseStore } from "../src/lib/agent/pulse/store";
import type {
  PulseObservation,
  PulseTaskSpec,
} from "../src/lib/agent/pulse/types";
import {
  assessCell,
  confirmedRegression,
  nextStreak,
  WINDOW,
} from "../src/lib/agent/watchdog/window";
import {
  countsAsSample,
  deriveOutcome,
  outcomeFromFlags,
  toExperienceOutcome,
  type CapabilityOutcome,
} from "../src/lib/verification/outcome";

function observation(outcome: CapabilityOutcome): PulseObservation {
  return {
    outcome,
    reason: "test",
    evidence: {},
    modelCalls: 0,
    toolCalls: 0,
    steps: 1,
    repairs: 0,
    latencyMs: 1,
    gateLeak: null,
    notes: "",
  };
}

function spec(
  id: string,
  family: PulseTaskSpec["family"],
  run: () => Promise<PulseObservation>,
  level: PulseTaskSpec["level"] = 3,
): PulseTaskSpec {
  return {
    id,
    family,
    level,
    difficulty: "DIRECT",
    version: 1,
    source: "test",
    mode: "offline",
    title: id,
    run,
  };
}

const ok = () => Promise.resolve(observation("VERIFIED_SUCCESS"));

describe("canonical capability outcome", () => {
  it("never reads a provider refusal or a missing browser as a capability failure", () => {
    expect(
      deriveOutcome({
        infrastructureError: "provider:rate_limited",
        finished: false,
      }).outcome,
    ).toBe("INFRASTRUCTURE_FAILURE");
    expect(
      outcomeFromFlags({
        success: false,
        verifiedSuccess: false,
        notes: "Chromium binary did not complete a browser session",
      }).outcome,
    ).toBe("INFRASTRUCTURE_FAILURE");
    expect(countsAsSample("INFRASTRUCTURE_FAILURE")).toBe(false);
    expect(countsAsSample("INCONCLUSIVE")).toBe(false);
  });

  it("does not call 'finished with an answer' verified", () => {
    expect(deriveOutcome({ finished: true }).outcome).toBe(
      "SUCCESS_UNVERIFIED",
    );
    expect(
      deriveOutcome({
        finished: true,
        checks: ["passed"],
        verifiedWithoutVerifier: true,
      }).outcome,
    ).toBe("SUCCESS_UNVERIFIED");
    expect(
      deriveOutcome({ finished: true, verdicts: ["unverified"] }).outcome,
    ).toBe("SUCCESS_UNVERIFIED");
  });

  it("separates verified success, partial work, rejection and false completion", () => {
    expect(
      deriveOutcome({ finished: true, checks: ["passed", "passed"] }).outcome,
    ).toBe("VERIFIED_SUCCESS");
    expect(
      deriveOutcome({
        finished: true,
        checks: ["passed"],
        coverage: { satisfied: 1, required: 3 },
      }).outcome,
    ).toBe("PARTIAL");
    expect(deriveOutcome({ finished: true, checks: ["failed"] }).outcome).toBe(
      "REJECTED",
    );
    expect(
      deriveOutcome({
        finished: true,
        checks: ["failed"],
        claimedSuccess: true,
      }).outcome,
    ).toBe("FALSE_COMPLETION");
    expect(
      deriveOutcome({ finished: true, verdicts: ["conflicted"] }).outcome,
    ).toBe("INCONCLUSIVE");
    expect(deriveOutcome({ finished: false }).outcome).toBe("REJECTED");
  });

  it("maps onto the experience outcomes without inventing verification", () => {
    expect(toExperienceOutcome("VERIFIED_SUCCESS")).toBe("verified_success");
    expect(toExperienceOutcome("SUCCESS_UNVERIFIED")).toBe("success");
    expect(toExperienceOutcome("PARTIAL")).toBe("failure");
    expect(toExperienceOutcome("FALSE_COMPLETION")).toBe("false_completion");
    expect(toExperienceOutcome("INFRASTRUCTURE_FAILURE")).toBe("error");
  });
});

describe("statistical windows", () => {
  const series = (...parts: Array<[CapabilityOutcome, number]>) =>
    parts.flatMap(([outcome, count]) =>
      Array.from({ length: count }, () => ({ outcome })),
    );

  it("draws no conclusion from too few samples", () => {
    const assessment = assessCell(
      series(["VERIFIED_SUCCESS", 3], ["REJECTED", 2]),
    );
    expect(assessment.signal).toBeNull();
  });

  it("flags a verified-rate drop against the reference window", () => {
    const assessment = assessCell(
      series(["VERIFIED_SUCCESS", 20], ["REJECTED", WINDOW.recent]),
    );
    expect(assessment.signal).toBe("verified_drop");
    expect(assessment.probabilityWorse).toBeGreaterThanOrEqual(0.9);
  });

  it("does not count infrastructure failures as a drop", () => {
    const assessment = assessCell(
      series(
        ["VERIFIED_SUCCESS", 20],
        ["INFRASTRUCTURE_FAILURE", 10],
        ["VERIFIED_SUCCESS", WINDOW.recent],
      ),
    );
    expect(assessment.signal).toBeNull();
    expect(assessment.recent.excluded).toBe(0);
  });

  it("weighs false completions more heavily than honest failures", () => {
    const assessment = assessCell(
      series(
        ["VERIFIED_SUCCESS", 20],
        ["VERIFIED_SUCCESS", 4],
        ["FALSE_COMPLETION", 2],
      ),
    );
    expect(assessment.signal).toBe("false_completion");
  });

  it("needs two consecutive confirmations before calling a regression", () => {
    const bad = assessCell(
      series(["VERIFIED_SUCCESS", 20], ["REJECTED", WINDOW.recent]),
    );
    const good = assessCell(series(["VERIFIED_SUCCESS", 26]));
    const once = nextStreak(0, bad);
    expect(confirmedRegression(once)).toBe(false);
    const twice = nextStreak(once, bad);
    expect(confirmedRegression(twice)).toBe(true);
    expect(nextStreak(twice, good)).toBe(0);
  });
});

describe("durable pulse runner", () => {
  const clock = () => {
    let now = Date.parse("2026-09-25T10:00:00Z");
    return {
      now: () => now,
      advance: (ms: number) => {
        now += ms;
      },
    };
  };

  it("continues the same cycle after a restart instead of starting over", async () => {
    const time = clock();
    const store = new MemoryPulseStore();
    store.now = time.now;
    // Cycles run families in name order: CODING first.
    const specs = [
      spec("a", "CODING", async () => {
        time.advance(30_000);
        return observation("VERIFIED_SUCCESS");
      }),
      spec("b", "REASONING", ok),
      spec("c", "THINKING", ok),
    ];
    const first = await runPulseSlice({
      store,
      owner: "worker-1",
      specs,
      deadline: time.now() + 10_000,
      signal: new AbortController().signal,
      now: time.now,
    });
    expect(first.tasksRun).toBe(1);
    expect(first.completedCycle).toBe(false);
    expect(first.continueChain).toBe(true);

    // A new process: nothing in memory, the store has the cursor.
    const second = await runPulseSlice({
      store,
      owner: "worker-2",
      specs,
      deadline: time.now() + 60_000,
      signal: new AbortController().signal,
      now: time.now,
    });
    expect(second.cycleId).toBe(first.cycleId);
    expect(second.completedCycle).toBe(true);
    expect(store.results.map((result) => result.taskId).sort()).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("lets only one worker drive a cycle and takes over an expired lease", async () => {
    const time = clock();
    const store = new MemoryPulseStore();
    store.now = time.now;
    const specs = [spec("a", "THINKING", ok), spec("b", "CODING", ok)];
    const cycle = await store.createCycle({
      suiteVersion: suiteVersion(specs),
      taskIds: ["a", "b"],
    });
    await store.leaseCycle(cycle!.id, "worker-1", PULSE_LEASE_SECONDS);
    const blocked = await runPulseSlice({
      store,
      owner: "worker-2",
      specs,
      deadline: time.now() + 60_000,
      signal: new AbortController().signal,
      now: time.now,
    });
    expect(blocked.reason).toBe("pulse_leased_elsewhere");
    expect(store.results).toHaveLength(0);

    time.advance((PULSE_LEASE_SECONDS + 1) * 1000);
    const takeover = await runPulseSlice({
      store,
      owner: "worker-2",
      specs,
      deadline: time.now() + 60_000,
      signal: new AbortController().signal,
      now: time.now,
    });
    expect(takeover.completedCycle).toBe(true);
  });

  it("writes each result once when a tick is replayed", async () => {
    const store = new MemoryPulseStore();
    const specs = [spec("a", "THINKING", ok)];
    const cycle = await store.createCycle({
      suiteVersion: suiteVersion(specs),
      taskIds: ["a"],
    });
    const result = {
      cycleId: cycle!.id,
      taskId: "a",
      suiteVersion: cycle!.suiteVersion,
      family: "THINKING" as const,
      level: 3 as const,
      difficulty: "DIRECT" as const,
      mode: "offline" as const,
      outcome: "VERIFIED_SUCCESS" as const,
      reason: "",
      evidence: {},
      modelCalls: 0,
      toolCalls: 0,
      latencyMs: 0,
    };
    expect(await store.recordResult(result)).toBe(true);
    expect(await store.recordResult(result)).toBe(false);
    // The replayed slice sees the result and only moves the cursor.
    const report = await runPulseSlice({
      store,
      owner: "worker",
      specs,
      deadline: Date.now() + 60_000,
      signal: new AbortController().signal,
    });
    expect(report.tasksRun).toBe(0);
    expect(report.completedCycle).toBe(true);
    expect(store.results).toHaveLength(1);
  });

  it("records a throwing task as an infrastructure failure and finishes the cycle", async () => {
    const store = new MemoryPulseStore();
    const specs = [
      spec("broken", "THINKING", async () => {
        throw new Error("fixture exploded");
      }),
      spec("fine", "CODING", ok),
    ];
    const report = await runPulseSlice({
      store,
      owner: "worker",
      specs,
      deadline: Date.now() + 60_000,
      signal: new AbortController().signal,
    });
    expect(report.completedCycle).toBe(true);
    const broken = store.results.find((result) => result.taskId === "broken");
    expect(broken?.outcome).toBe("INFRASTRUCTURE_FAILURE");
  });

  it("finishes a cycle whose task was removed by a deploy mid-cycle", async () => {
    const store = new MemoryPulseStore();
    const specs = [spec("kept", "THINKING", ok)];
    await store.createCycle({
      suiteVersion: "old-suite",
      taskIds: ["removed-task", "kept"],
    });
    const report = await runPulseSlice({
      store,
      owner: "worker",
      specs,
      deadline: Date.now() + 60_000,
      signal: new AbortController().signal,
    });
    expect(report.completedCycle).toBe(true);
    expect(store.results.map((result) => result.taskId)).toEqual(["kept"]);
  });

  it("waits for the next due time and abandons a stale cycle", async () => {
    const time = clock();
    const store = new MemoryPulseStore();
    store.now = time.now;
    const specs = [spec("a", "THINKING", ok)];
    const run = () =>
      runPulseSlice({
        store,
        owner: "worker",
        specs,
        deadline: time.now() + 60_000,
        signal: new AbortController().signal,
        now: time.now,
      });
    expect((await run()).completedCycle).toBe(true);
    expect((await run()).reason).toBe("pulse_not_due");
    time.advance(PULSE_INTERVAL_MS);
    expect((await run()).completedCycle).toBe(true);

    // A cycle nobody finished: a newer tick abandons it and starts afresh.
    await store.createCycle({ suiteVersion: "x", taskIds: ["a"] });
    await store.leaseCycle(store.cycles.at(-1)!.id, "ghost", 10_000_000);
    time.advance(STALE_CYCLE_MS + PULSE_INTERVAL_MS);
    const fresh = await run();
    expect(fresh.completedCycle).toBe(true);
    expect(store.cycles.some((cycle) => cycle.status === "abandoned")).toBe(
      true,
    );
  });

  it("confirms a regression only after two cycles agree", async () => {
    const time = clock();
    const store = new MemoryPulseStore();
    store.now = time.now;
    let outcome: CapabilityOutcome = "VERIFIED_SUCCESS";
    const specs = [spec("a", "CODING", async () => observation(outcome))];
    const regressions: string[] = [];
    const run = () =>
      runPulseSlice({
        store,
        owner: "worker",
        specs,
        deadline: time.now() + 60_000,
        signal: new AbortController().signal,
        now: time.now,
        onRegression: async (regression) => {
          regressions.push(regression.kind);
        },
      });
    for (let cycle = 0; cycle < 20; cycle += 1) {
      await run();
      time.advance(PULSE_INTERVAL_MS);
    }
    outcome = "REJECTED";
    const reports = [];
    for (let cycle = 0; cycle < WINDOW.recent + 1; cycle += 1) {
      reports.push(await run());
      time.advance(PULSE_INTERVAL_MS);
    }
    const firstSignal = reports.findIndex((report) =>
      report.regressions.some((entry) => entry.kind === "verified_drop"),
    );
    expect(firstSignal).toBeGreaterThan(0);
    expect(regressions).toContain("verified_drop");
    const cell = await store.baseline(suiteVersion(specs), "CODING", 3);
    expect(cell?.regressionStreak).toBeGreaterThanOrEqual(2);
  });
});

describe("the unified pulse suite", () => {
  it("brings every capability suite into one catalog", async () => {
    const specs = await pulseCatalog();
    const rows = coverage(specs, CAPABILITY_LANES);
    const levels = (family: string) =>
      rows.find((row) => row.family === family)?.levels ?? [];
    for (const family of [
      "RESEARCH",
      "CROSS_DOMAIN",
      "MATH_SCIENCE",
      "BUILDING",
      "COMPUTER",
      "TOOL_USE",
      "MULTIMODAL",
    ])
      expect(levels(family), family).toEqual([1, 2, 3, 4, 5]);
    for (const family of ["THINKING", "REASONING", "MEMORY_CONTEXT"])
      expect(levels(family), family).toEqual([1, 3, 5]);
    // M35 coding runs live only; the offline coding baseline is inconclusive.
    expect(
      specs.filter(
        (entry) => entry.family === "CODING" && entry.mode === "live",
      ).length,
    ).toBeGreaterThanOrEqual(4);
    expect(new Set(specs.map((entry) => entry.id)).size).toBe(specs.length);
  });

  it("rotates what each cycle samples and keeps every family", async () => {
    const specs = (await pulseCatalog()).filter(
      (entry) => entry.mode === "offline",
    );
    const one = planCycle(specs, {
      seed: "a",
      perFamily: 2,
      modes: ["offline"],
    });
    const two = planCycle(specs, {
      seed: "b",
      perFamily: 2,
      modes: ["offline"],
    });
    expect(one).not.toEqual(two);
    const families = new Set(specs.map((entry) => entry.family));
    for (const family of families)
      expect(
        one.some(
          (id) => specs.find((entry) => entry.id === id)?.family === family,
        ),
        family,
      ).toBe(true);
  });

  it("changes the suite version when a task or grader changes", async () => {
    const specs = await pulseCatalog();
    const bumped = specs.map((entry, index) =>
      index === 0 ? { ...entry, version: entry.version + 1 } : entry,
    );
    expect(suiteVersion(specs)).toBe(suiteVersion([...specs].reverse()));
    expect(suiteVersion(bumped)).not.toBe(suiteVersion(specs));
  });

  it("accepts the M34 lane names as aliases", () => {
    expect(normalizeLane("BUILDING_COMPUTER")).toBe("BUILDING");
    expect(normalizeLane("TOOL_MULTIMODAL")).toBe("TOOL_USE");
    expect(normalizeLane("CROSS_DOMAIN_LONG_HORIZON")).toBe("CROSS_DOMAIN");
    expect(normalizeLane("NOT_A_LANE")).toBeNull();
  });

  it("runs every offline task through the real loop and grades each one", async () => {
    const specs = (await pulseCatalog()).filter(
      (entry) => entry.mode === "offline",
    );
    const outcomes = new Map<string, CapabilityOutcome>();
    for (const entry of specs) {
      const result = await entry.run({
        signal: new AbortController().signal,
      });
      outcomes.set(entry.id, result.outcome);
    }
    expect(outcomes.size).toBe(specs.length);
    // The new L1/L5 cognition tasks verify against their own graders.
    for (const id of [
      "m34:thinking:l1",
      "m34:thinking:l5",
      "m34:reasoning:l1",
      "m34:reasoning:l5",
      "m34:memory_context:l1",
      "m34:memory_context:l5",
    ])
      expect(outcomes.get(id), id).toBe("VERIFIED_SUCCESS");
    // Offline coding cannot patch without a model and says so.
    expect(outcomes.get("m30:coding:l3")).toBe("INCONCLUSIVE");
  }, 180_000);
});
