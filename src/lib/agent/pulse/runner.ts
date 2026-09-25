import type {
  CapabilityOutcome,
  DerivedOutcome,
} from "../../verification/outcome";
import {
  assessCell,
  confirmedRegression,
  nextStreak,
  WINDOW,
  windowStats,
} from "../watchdog/window";
import { planCycle, suiteVersion } from "./catalog";
import type { CapabilityLane, CapabilityLevel } from "./lanes";
import type { PulseStore } from "./store";
import type {
  PulseObservation,
  PulseRegression,
  PulseResult,
  PulseTaskSpec,
  PulseTickReport,
} from "./types";

// One slice of the capability pulse, against a PulseStore.
//
// The cycle, its cursor and its results live in the store, so a restart, a
// second instance or a replayed tick continues the same cycle instead of
// starting over. A lease decides who drives a cycle; a result is written
// once per task; the cursor moves only from the value this worker read. A
// task that throws is recorded as an infrastructure failure and the cursor
// moves on, so one broken task cannot stall the pulse.

export const PULSE_INTERVAL_MS = 60 * 60 * 1000;
/**
 * How much earlier than a full interval the next cycle may start. The
 * hourly trigger (GitHub schedule at minute 7) starts a few minutes late by
 * a different amount each hour; without slack, a tick that lands slightly
 * less than an hour after the last cycle's start finds it "not due" and the
 * pulse silently runs every other hour.
 */
export const PULSE_DUE_SLACK_MS = 15 * 60 * 1000;
export const PULSE_BUDGET_MS = 45_000;
export const PULSE_LEASE_SECONDS = 120;
/** A running cycle older than this is abandoned and a new one starts. */
export const STALE_CYCLE_MS = 6 * 60 * 60 * 1000;
export const TASKS_PER_FAMILY = 2;

export type PulseSliceInput = {
  store: PulseStore;
  owner: string;
  specs: PulseTaskSpec[];
  deadline: number;
  signal: AbortSignal;
  modes?: Array<"offline" | "live">;
  now?: () => number;
  /** Called once per confirmed regression, when a cycle completes. */
  onRegression?: (
    regression: PulseRegression,
    cycleId: string,
  ) => Promise<void>;
};

async function observe(
  spec: PulseTaskSpec,
  signal: AbortSignal,
): Promise<PulseObservation> {
  const started = Date.now();
  try {
    return await spec.run({ signal });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const derived: DerivedOutcome = {
      outcome: "INFRASTRUCTURE_FAILURE",
      reason: `task runner threw: ${message}`.slice(0, 300),
    };
    return {
      ...derived,
      evidence: { threw: true },
      modelCalls: 0,
      toolCalls: 0,
      steps: 0,
      repairs: 0,
      latencyMs: Date.now() - started,
      gateLeak: null,
      notes: derived.reason,
    };
  }
}

/** Assess every cell this cycle touched; returns confirmed regressions. */
export async function assessCycle(
  store: PulseStore,
  cycleId: string,
  version: string,
): Promise<{
  regressions: PulseRegression[];
  cells: Array<{ family: CapabilityLane; level: CapabilityLevel }>;
}> {
  const results = await store.cycleResults(cycleId);
  const cells = [
    ...new Map(
      results.map((result) => [
        `${result.family}:${result.level}`,
        { family: result.family, level: result.level },
      ]),
    ).values(),
  ];
  const regressions: PulseRegression[] = [];
  for (const cell of cells) {
    const outcomes = await store.cellOutcomes({
      suiteVersion: version,
      ...cell,
      limit: WINDOW.reference + WINDOW.recent,
    });
    const observations = outcomes.map((outcome) => ({ outcome }));
    const assessment = assessCell(observations);
    const previous = await store.baseline(version, cell.family, cell.level);
    const streak = nextStreak(previous?.regressionStreak ?? 0, assessment);
    const whole = windowStats(observations);
    await store.saveBaseline({
      suiteVersion: version,
      family: cell.family,
      level: cell.level,
      samples: whole.samples,
      verified: whole.verified,
      falseCompletions: whole.falseCompletions,
      excluded: whole.excluded,
      rate: whole.rate,
      lower: whole.lower,
      upper: whole.upper,
      regressionStreak: streak,
    });
    if (assessment.signal && confirmedRegression(streak))
      regressions.push({
        ...cell,
        kind: assessment.signal,
        referenceRate: assessment.reference.rate,
        recentRate: assessment.recent.rate,
        probabilityWorse: assessment.probabilityWorse,
        streak,
        source: "pulse",
      });
  }
  return { regressions, cells };
}

export async function runPulseSlice(
  input: PulseSliceInput,
): Promise<PulseTickReport> {
  const now = input.now ?? Date.now;
  const report = (
    fields: Partial<PulseTickReport> & { reason: string | null },
  ): PulseTickReport => ({
    ran: false,
    cycleId: null,
    tasksRun: 0,
    completedCycle: false,
    continueChain: false,
    regressions: [],
    ...fields,
  });
  const version = suiteVersion(input.specs);
  const modes = input.modes ?? ["offline"];

  let cycle = await input.store.activeCycle();
  if (cycle && now() - Date.parse(cycle.startedAt) > STALE_CYCLE_MS) {
    await input.store.abandonCycle(cycle.id);
    cycle = null;
  }
  if (!cycle) {
    const last = await input.store.lastCompleted();
    if (last?.nextDueAt && Date.parse(last.nextDueAt) > now())
      return report({ reason: "pulse_not_due" });
    const taskIds = planCycle(input.specs, {
      seed: `${version}:${Math.floor(now() / PULSE_INTERVAL_MS)}`,
      perFamily: TASKS_PER_FAMILY,
      modes,
    });
    if (!taskIds.length) return report({ reason: "no_pulse_tasks" });
    cycle =
      (await input.store.createCycle({ suiteVersion: version, taskIds })) ??
      (await input.store.activeCycle());
    if (!cycle) return report({ reason: "pulse_start_lost" });
  }

  const leased = await input.store.leaseCycle(
    cycle.id,
    input.owner,
    PULSE_LEASE_SECONDS,
  );
  if (!leased)
    return report({ reason: "pulse_leased_elsewhere", cycleId: cycle.id });
  cycle = leased;

  const specs = new Map(input.specs.map((spec) => [spec.id, spec]));
  const done = new Set(
    (await input.store.cycleResults(cycle.id)).map((result) => result.taskId),
  );
  let cursor = cycle.cursor;
  let tasksRun = 0;
  let lostLease = false;
  while (
    cursor < cycle.taskIds.length &&
    now() < input.deadline &&
    !input.signal.aborted
  ) {
    const taskId = cycle.taskIds[cursor]!;
    const spec = specs.get(taskId);
    // A task already recorded (a replayed tick) or removed from the suite
    // by a deploy mid-cycle is passed over.
    if (spec && !done.has(taskId)) {
      const observation = await observe(spec, input.signal);
      const result: PulseResult = {
        cycleId: cycle.id,
        taskId,
        suiteVersion: cycle.suiteVersion,
        family: spec.family,
        level: spec.level,
        difficulty: spec.difficulty,
        mode: spec.mode,
        outcome: observation.outcome,
        reason: observation.reason,
        evidence: {
          ...observation.evidence,
          gateLeak: observation.gateLeak,
          steps: observation.steps,
          repairs: observation.repairs,
          source: spec.source,
          notes: observation.notes.slice(0, 400),
        },
        modelCalls: observation.modelCalls,
        toolCalls: observation.toolCalls,
        latencyMs: observation.latencyMs,
      };
      await input.store.recordResult(result);
      done.add(taskId);
      tasksRun += 1;
    }
    if (
      !(await input.store.advanceCursor(
        cycle.id,
        input.owner,
        cursor,
        cursor + 1,
      ))
    ) {
      lostLease = true;
      break;
    }
    cursor += 1;
    // Keep the lease while working; a long task must not hand the cycle over.
    if (
      !(await input.store.leaseCycle(
        cycle.id,
        input.owner,
        PULSE_LEASE_SECONDS,
      ))
    ) {
      lostLease = true;
      break;
    }
  }

  if (!lostLease && cursor >= cycle.taskIds.length) {
    const assessed = await assessCycle(
      input.store,
      cycle.id,
      cycle.suiteVersion,
    );
    for (const regression of assessed.regressions)
      await input.onRegression?.(regression, cycle.id).catch(() => undefined);
    const results = await input.store.cycleResults(cycle.id);
    const byOutcome: Partial<Record<CapabilityOutcome, number>> = {};
    for (const result of results)
      byOutcome[result.outcome] = (byOutcome[result.outcome] ?? 0) + 1;
    const nextDue = Math.max(
      Date.parse(cycle.startedAt) + PULSE_INTERVAL_MS - PULSE_DUE_SLACK_MS,
      now() + 5 * 60 * 1000,
    );
    await input.store.completeCycle(
      cycle.id,
      input.owner,
      new Date(nextDue).toISOString(),
      {
        tasks: results.length,
        byOutcome,
        gateLeaks: results.filter((result) => result.evidence.gateLeak === true)
          .length,
        regressions: assessed.regressions,
        cells: assessed.cells.length,
      },
    );
    return report({
      ran: tasksRun > 0,
      reason: "cycle_completed",
      cycleId: cycle.id,
      tasksRun,
      completedCycle: true,
      regressions: assessed.regressions,
    });
  }

  if (!lostLease) await input.store.releaseCycle(cycle.id, input.owner);
  return report({
    ran: tasksRun > 0,
    reason: lostLease ? "pulse_lease_lost" : "in_progress",
    cycleId: cycle.id,
    tasksRun,
    continueChain: !lostLease && !input.signal.aborted,
  });
}
