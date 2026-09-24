import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CAPABILITY_LANES } from "../src/lib/agent/pulse/lanes";
import {
  clearPulseRegistry,
  listPulseRegistrations,
  registerPulseTask,
  seedDefaultPulseRegistry,
} from "../src/lib/agent/pulse/registry";
import {
  PULSE_INTERVAL_MS,
  runPulseSlice,
} from "../src/lib/agent/pulse/runner";
import { runCapabilityPulseTick } from "../src/lib/agent/pulse/scheduler";
import {
  getActivePulseCycle,
  getLastPulseCompletedAt,
  resetPulseState,
  startPulseCycle,
} from "../src/lib/agent/pulse/state";
import type { CapabilityLane } from "../src/lib/agent/pulse/lanes";
import type { PulseTaskResult } from "../src/lib/agent/pulse/types";

const FAST_TASK_IDS = ["fast:lane-a", "fast:lane-b", "fast:lane-c"] as const;

function instantResult(
  taskId: string,
  lane: CapabilityLane,
  level: PulseTaskResult["level"],
): PulseTaskResult {
  return {
    taskId,
    lane,
    level,
    success: true,
    verifiedSuccess: true,
    falseCompletion: false,
    modelCalls: 1,
    toolCalls: 0,
    steps: 1,
    repairs: 0,
    latencyMs: 0,
    notes: "instant test runner",
  };
}

function registerFastRunners() {
  const lanes: CapabilityLane[] = ["THINKING", "REASONING", "CODING"];
  FAST_TASK_IDS.forEach((id, index) => {
    registerPulseTask(
      {
        id,
        lane: lanes[index]!,
        level: 3,
        source: "builtin",
        ref: "test:instant",
        title: id,
        objective: "instant",
      },
      async () => instantResult(id, lanes[index]!, 3),
    );
  });
}

function installFastSuite() {
  clearPulseRegistry();
  resetPulseState();
  registerFastRunners();
  startPulseCycle([...FAST_TASK_IDS]);
}

vi.mock("../src/lib/agent/pulse/suite", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../src/lib/agent/pulse/suite")>();
  return {
    ...actual,
    preparePulseSuite: vi.fn(async () => {
      clearPulseRegistry();
      resetPulseState();
      registerFastRunners();
      return [...FAST_TASK_IDS];
    }),
  };
});

afterEach(() => {
  vi.useRealTimers();
  clearPulseRegistry();
  resetPulseState();
});

describe("capability pulse registry", () => {
  it("seeds nine L3 lanes and accepts registrations for M35+", () => {
    seedDefaultPulseRegistry();
    expect(listPulseRegistrations().length).toBe(CAPABILITY_LANES.length);
    const lanes = new Set(listPulseRegistrations().map((task) => task.lane));
    for (const lane of CAPABILITY_LANES) expect(lanes.has(lane)).toBe(true);

    registerPulseTask({
      id: "custom:CODING:L2",
      lane: "CODING",
      level: 2,
      source: "registered",
      ref: "fixture:custom",
      title: "Custom coding smoke",
      objective: "Registered task placeholder",
    });
    expect(
      listPulseRegistrations({ lane: "CODING" }).some(
        (task) => task.id === "custom:CODING:L2",
      ),
    ).toBe(true);
  });
});

describe("capability pulse scheduler", () => {
  beforeEach(() => {
    installFastSuite();
  });

  it("runs a bounded slice and chains until the cycle completes", async () => {
    const first = await runPulseSlice({
      deadline: Date.now() + 60_000,
      signal: new AbortController().signal,
      maxTasks: 2,
    });
    expect(first.results).toHaveLength(2);
    expect(getActivePulseCycle()?.cursor).toBe(2);

    const tick = await runCapabilityPulseTick({
      owner: "test",
      signal: new AbortController().signal,
    });
    expect(tick.ran).toBe(true);
    expect(tick.continueChain).toBe(Boolean(getActivePulseCycle()));
  });

  it("waits an hour after a completed cycle before starting another", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));

    while (
      getActivePulseCycle() &&
      getActivePulseCycle()!.cursor < FAST_TASK_IDS.length
    ) {
      await runPulseSlice({
        deadline: Date.now() + 120_000,
        signal: new AbortController().signal,
        maxTasks: FAST_TASK_IDS.length,
      });
    }
    expect(getLastPulseCompletedAt()).toBeTruthy();
    expect(getActivePulseCycle()).toBeNull();

    const blocked = await runCapabilityPulseTick({
      owner: "test",
      signal: new AbortController().signal,
    });
    expect(blocked.ran).toBe(false);
    expect(blocked.reason).toBe("pulse_not_due");

    vi.setSystemTime(new Date(Date.now() + PULSE_INTERVAL_MS + 1));
    const allowed = await runCapabilityPulseTick({
      owner: "test",
      signal: new AbortController().signal,
    });
    expect(allowed.ran).toBe(true);
    expect(allowed.reason).not.toBe("pulse_not_due");
  });
});
