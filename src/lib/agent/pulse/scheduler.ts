import "server-only";
import { getActivePulseCycle, getLastPulseCompletedAt } from "./state";
import {
  MAX_TASKS_PER_TICK,
  PULSE_BUDGET_MS,
  PULSE_INTERVAL_MS,
  runPulseSlice,
} from "./runner";
import type { PulseTickReport } from "./types";

// Hourly capability pulse inside the existing scheduler tick. One slice per
// invocation; chained ticks finish a cycle without a second runtime.

export async function runCapabilityPulseTick(input: {
  owner: string;
  signal: AbortSignal;
}): Promise<PulseTickReport> {
  const idle = (reason: string): PulseTickReport => ({
    ran: false,
    reason,
    cycleId: null,
    tasksRun: 0,
    completedCycle: false,
    continueChain: false,
  });

  const active = getActivePulseCycle();
  const last = getLastPulseCompletedAt();
  if (
    !active &&
    last &&
    Date.now() - Date.parse(last) < PULSE_INTERVAL_MS
  )
    return idle("pulse_not_due");

  const slice = await runPulseSlice({
    deadline: Date.now() + PULSE_BUDGET_MS,
    signal: input.signal,
    maxTasks: MAX_TASKS_PER_TICK,
  });

  const busy =
    !slice.completedCycle &&
    slice.results.length > 0 &&
    !input.signal.aborted;

  return {
    ran: slice.results.length > 0,
    reason: slice.completedCycle
      ? "cycle_completed"
      : busy
        ? "in_progress"
        : slice.results.length
          ? "slice_finished"
          : null,
    cycleId: slice.cycleId,
    tasksRun: slice.results.length,
    completedCycle: slice.completedCycle,
    continueChain: busy,
  };
}
