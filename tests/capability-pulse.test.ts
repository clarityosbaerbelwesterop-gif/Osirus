import { afterEach, describe, expect, it } from "vitest";
import {
  clearPulseRegistry,
  listPulseRegistrations,
  registerPulseTask,
} from "../src/lib/agent/pulse/registry";
import { runPulseSlice, PULSE_INTERVAL_MS } from "../src/lib/agent/pulse/runner";
import { runCapabilityPulseTick } from "../src/lib/agent/pulse/scheduler";
import { preparePulseSuite } from "../src/lib/agent/pulse/suite";
import {
  getActivePulseCycle,
  getLastPulseCompletedAt,
  resetPulseState,
} from "../src/lib/agent/pulse/state";
import { CAPABILITY_LANES } from "../src/lib/agent/pulse/lanes";

afterEach(() => {
  clearPulseRegistry();
  resetPulseState();
});

describe("capability pulse registry", () => {
  it("seeds nine L3 lanes and accepts registrations for M35+", async () => {
    const taskIds = await preparePulseSuite();
    expect(taskIds.length).toBeGreaterThanOrEqual(CAPABILITY_LANES.length);
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
      listPulseRegistrations({ lane: "CODING" }).some((task) => task.id === "custom:CODING:L2"),
    ).toBe(true);
  });
});

describe("capability pulse scheduler", () => {
  it("runs a bounded slice and chains until the cycle completes", async () => {
    const first = await runPulseSlice({
      deadline: Date.now() + 60_000,
      signal: new AbortController().signal,
      maxTasks: 2,
    });
    expect(first.results.length).toBeGreaterThan(0);
    expect(getActivePulseCycle()?.cursor).toBe(first.results.length);

    const tick = await runCapabilityPulseTick({
      owner: "test",
      signal: new AbortController().signal,
    });
    expect(tick.ran).toBe(true);
    expect(tick.continueChain).toBe(Boolean(getActivePulseCycle()));
  });

  it("waits an hour after a completed cycle before starting another", async () => {
    while (getActivePulseCycle() || !getLastPulseCompletedAt()) {
      await runPulseSlice({
        deadline: Date.now() + 120_000,
        signal: new AbortController().signal,
        maxTasks: 5,
      });
    }
    const due = await runCapabilityPulseTick({
      owner: "test",
      signal: new AbortController().signal,
    });
    expect(due.ran).toBe(false);
    expect(due.reason).toBe("pulse_not_due");

    const last = getLastPulseCompletedAt();
    expect(last).toBeTruthy();
    const recent =
      Date.now() - Date.parse(last!) < PULSE_INTERVAL_MS;
    expect(recent).toBe(true);
  }, 120_000);
});
