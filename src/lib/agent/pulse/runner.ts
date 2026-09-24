import { preparePulseSuite, runPulseTaskById } from "./suite";
import {
  appendPulseResult,
  completePulseCycle,
  getActivePulseCycle,
  startPulseCycle,
} from "./state";
import type { PulseTaskResult, PulseTickReport } from "./types";

export const PULSE_BUDGET_MS = 45_000;
export const MAX_TASKS_PER_TICK = 3;
export const PULSE_INTERVAL_MS = 60 * 60 * 1000;

export async function runPulseSlice(input: {
  deadline: number;
  signal: AbortSignal;
  maxTasks: number;
}): Promise<{
  results: PulseTaskResult[];
  completedCycle: boolean;
  cycleId: string | null;
}> {
  const results: PulseTaskResult[] = [];
  let cycle = getActivePulseCycle();
  if (!cycle) {
    const taskIds = await preparePulseSuite();
    cycle = startPulseCycle(taskIds);
  }
  while (
    results.length < input.maxTasks &&
    cycle.cursor < cycle.taskIds.length &&
    Date.now() < input.deadline &&
    !input.signal.aborted
  ) {
    const taskId = cycle.taskIds[cycle.cursor]!;
    const result = await runPulseTaskById(taskId);
    if (!result) {
      cycle.cursor += 1;
      continue;
    }
    results.push(result);
    cycle = appendPulseResult(result) ?? cycle;
  }
  const completedCycle =
    cycle.cursor >= cycle.taskIds.length && cycle.completedAt !== null;
  if (completedCycle) completePulseCycle();
  return {
    results,
    completedCycle,
    cycleId: cycle.cycleId,
  };
}
