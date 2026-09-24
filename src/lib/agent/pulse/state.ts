import { fingerprint } from "../../intelligence/evals/random";
import type { PulseBaselineCell, PulseCycleState, PulseTaskResult } from "./types";
import { laneKey } from "./lanes";

// Pulse cycle state lives in-process and is mirrored to learning artifacts
// when the Intelligence Plane is available.

let activeCycle: PulseCycleState | null = null;
let lastCompletedAt: string | null = null;
const baselines = new Map<string, PulseBaselineCell>();

export function getActivePulseCycle() {
  return activeCycle;
}

export function getLastPulseCompletedAt() {
  return lastCompletedAt;
}

export function startPulseCycle(taskIds: string[]): PulseCycleState {
  activeCycle = {
    cycleId: fingerprint("pulse-cycle", new Date().toISOString()),
    startedAt: new Date().toISOString(),
    completedAt: null,
    cursor: 0,
    taskIds,
    results: [],
  };
  return activeCycle;
}

export function appendPulseResult(result: PulseTaskResult) {
  if (!activeCycle) return null;
  activeCycle.results.push(result);
  activeCycle.cursor += 1;
  updateBaseline(result);
  if (activeCycle.cursor >= activeCycle.taskIds.length) {
    activeCycle.completedAt = new Date().toISOString();
    lastCompletedAt = activeCycle.completedAt;
  }
  return activeCycle;
}

export function completePulseCycle() {
  if (!activeCycle) return null;
  if (!activeCycle.completedAt)
    activeCycle.completedAt = new Date().toISOString();
  lastCompletedAt = activeCycle.completedAt;
  const finished = activeCycle;
  activeCycle = null;
  return finished;
}

export function resetPulseState() {
  activeCycle = null;
  lastCompletedAt = null;
  baselines.clear();
}

function updateBaseline(result: PulseTaskResult) {
  const key = laneKey(result.lane, result.level);
  const prior = baselines.get(key);
  const sampleCount = (prior?.sampleCount ?? 0) + 1;
  const verified = result.verifiedSuccess ? 1 : 0;
  const priorVerified = (prior?.verifiedSuccessRate ?? 0) * (prior?.sampleCount ?? 0);
  baselines.set(key, {
    lane: result.lane,
    level: result.level,
    sampleCount,
    verifiedSuccessRate: Number(
      ((priorVerified + verified) / sampleCount).toFixed(4),
    ),
    lastObservedAt: new Date().toISOString(),
  });
}

export function pulseBaselineFor(lane: PulseTaskResult["lane"], level: PulseTaskResult["level"]) {
  return baselines.get(laneKey(lane, level)) ?? null;
}

export function allPulseBaselines() {
  return [...baselines.values()];
}

export function loadPulseBaselines(cells: PulseBaselineCell[]) {
  baselines.clear();
  for (const cell of cells) baselines.set(laneKey(cell.lane, cell.level), cell);
}
