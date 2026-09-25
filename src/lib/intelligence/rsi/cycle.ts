import type { PulseStore } from "../../agent/pulse/store";
import type { IntelStore } from "../store/store";
import type { ChallengeArena } from "../generation/challenges";
import { PHASE_RUNNERS, type RsiContext } from "./phases";
import type { RsiStore } from "./store";
import {
  RSI_PHASES,
  type RsiCycle,
  type RsiPhase,
  type RsiState,
  type RsiTickReport,
} from "./types";

// One slice of the Recursive Intelligence Cycle, against an RsiStore.
//
// Same discipline as the pulse: the cycle, its phase cursor and its state
// live in the store, so a restart, a second instance or a replayed tick
// continues the same cycle. A lease decides who steps it; the cursor and the
// state it produced are committed together and only from the value this
// worker read. A phase that throws is recorded with its error and passed
// over -- one broken phase cannot stall the loop -- and never counted as a
// capability result.

export const RSI_INTERVAL_MS = 60 * 60 * 1000;
/** Same tolerance for the jittery hourly trigger as the pulse. */
export const RSI_DUE_SLACK_MS = 15 * 60 * 1000;
export const RSI_BUDGET_MS = 60_000;
export const RSI_LEASE_SECONDS = 120;
export const RSI_STALE_MS = 6 * 60 * 60 * 1000;

export type RsiSliceInput = {
  store: RsiStore;
  intel: IntelStore;
  pulse: PulseStore;
  owner: string;
  deadline: number;
  signal: AbortSignal;
  model: string;
  now?: () => number;
  phases?: readonly RsiPhase[];
  selfPlayArenas?: ChallengeArena[];
  redArenas?: ChallengeArena[];
};

/** The cycle's summary: the numbers the report and the Lab read. */
export function summarize(state: RsiState) {
  const hypotheses = state.hypotheses?.items ?? [];
  return {
    capabilitiesTested:
      (state.selfPlay?.configs.length ?? 0) + (state.red?.attacks.length ?? 0),
    pulseTasks: state.health?.tasks ?? 0,
    weakCells: state.health?.weakCells.length ?? 0,
    regressions: state.health?.regressions.length ?? 0,
    openGaps: state.gaps?.open ?? 0,
    generatedTasks: state.challenge?.stored ?? 0,
    contaminatedRejected: state.challenge?.contaminated ?? 0,
    selfPlayInstances: (state.selfPlay?.configs ?? []).reduce(
      (sum, entry) => sum + entry.instances,
      0,
    ),
    redInstances: (state.red?.attacks ?? []).reduce(
      (sum, entry) => sum + entry.instances,
      0,
    ),
    findings:
      (state.selfPlay?.findings.length ?? 0) +
      (state.red?.findings.length ?? 0),
    hypotheses: hypotheses.length,
    codeHypotheses: hypotheses.filter((entry) => entry.class === "code").length,
    liveOrder: state.experiment?.order ?? null,
    decided: state.decision?.decided ?? 0,
    promoted: state.decision?.promoted ?? 0,
    rejected: state.decision?.rejected ?? 0,
    quarantined: state.decision?.quarantined ?? 0,
    rolledBack: state.decision?.rolledBack ?? 0,
    falseCompletions: state.experience?.antiPatterns ?? 0,
    newWeaknesses: state.meta?.newWeaknesses ?? [],
    resolved: state.meta?.resolved ?? [],
    phaseErrors: Object.entries(state.log ?? {})
      .filter(([, record]) => record?.error)
      .map(([phase]) => phase),
    verifiedImprovement: (state.decision?.promoted ?? 0) > 0,
  };
}

export async function runRsiSlice(
  input: RsiSliceInput,
): Promise<RsiTickReport> {
  const now = input.now ?? Date.now;
  const report = (
    fields: Partial<RsiTickReport> & { reason: string | null },
  ): RsiTickReport => ({
    ran: false,
    cycleId: null,
    phasesRun: [],
    completedCycle: false,
    continueChain: false,
    ...fields,
  });

  let cycle: RsiCycle | null = await input.store.activeCycle();
  if (cycle && now() - Date.parse(cycle.startedAt) > RSI_STALE_MS) {
    await input.store.abandonCycle(cycle.id);
    cycle = null;
  }
  const previous = await input.store.lastCompleted();
  if (!cycle) {
    if (previous?.nextDueAt && Date.parse(previous.nextDueAt) > now())
      return report({ reason: "rsi_not_due" });
    cycle =
      (await input.store.createCycle([...(input.phases ?? RSI_PHASES)])) ??
      (await input.store.activeCycle());
    if (!cycle) return report({ reason: "rsi_start_lost" });
  }
  const leased = await input.store.leaseCycle(
    cycle.id,
    input.owner,
    RSI_LEASE_SECONDS,
  );
  if (!leased)
    return report({ reason: "rsi_leased_elsewhere", cycleId: cycle.id });
  cycle = leased;

  const phasesRun: RsiPhase[] = [];
  let lostLease = false;
  while (
    cycle.cursor < cycle.phases.length &&
    now() < input.deadline &&
    !input.signal.aborted
  ) {
    const phase = cycle.phases[cycle.cursor]!;
    const started = now();
    const context: RsiContext = {
      intel: input.intel,
      pulse: input.pulse,
      cycle,
      previous,
      now,
      model: input.model,
      selfPlayArenas: input.selfPlayArenas,
      redArenas: input.redArenas,
    };
    let state: RsiState;
    try {
      const result = await PHASE_RUNNERS[phase](context);
      state = {
        ...result.state,
        log: {
          ...(cycle.state.log ?? {}),
          [phase]: {
            at: new Date(started).toISOString(),
            ms: now() - started,
            note: result.note.slice(0, 600),
          },
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      state = {
        ...cycle.state,
        log: {
          ...(cycle.state.log ?? {}),
          [phase]: {
            at: new Date(started).toISOString(),
            ms: now() - started,
            note: "phase failed; passed over",
            error: message.slice(0, 300),
          },
        },
      };
    }
    const moved = await input.store.advance(
      cycle.id,
      input.owner,
      cycle.cursor,
      cycle.cursor + 1,
      state,
    );
    if (!moved) {
      lostLease = true;
      break;
    }
    phasesRun.push(phase);
    cycle = { ...cycle, cursor: cycle.cursor + 1, state };
    const renewed = await input.store.leaseCycle(
      cycle.id,
      input.owner,
      RSI_LEASE_SECONDS,
    );
    if (!renewed) {
      lostLease = true;
      break;
    }
  }

  if (!lostLease && cycle.cursor >= cycle.phases.length) {
    const nextDue = Math.max(
      Date.parse(cycle.startedAt) + RSI_INTERVAL_MS - RSI_DUE_SLACK_MS,
      now() + 5 * 60 * 1000,
    );
    await input.store.completeCycle(
      cycle.id,
      input.owner,
      new Date(nextDue).toISOString(),
      summarize(cycle.state),
    );
    return report({
      ran: phasesRun.length > 0,
      reason: "cycle_completed",
      cycleId: cycle.id,
      phasesRun,
      completedCycle: true,
    });
  }
  if (!lostLease) await input.store.releaseCycle(cycle.id, input.owner);
  return report({
    ran: phasesRun.length > 0,
    reason: lostLease ? "rsi_lease_lost" : "in_progress",
    cycleId: cycle.id,
    phasesRun,
    continueChain: !lostLease && !input.signal.aborted,
  });
}
