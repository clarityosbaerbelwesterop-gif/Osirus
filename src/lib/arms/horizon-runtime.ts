import {
  actionState,
  frontier,
  horizonOf,
  isHumanWait,
  openWait,
  recordAction,
  reconcileGoals,
  resolveWait,
  revalidateMission,
  wakeFor,
  wakeState,
  type AgentWait,
  type MissionWait,
  type WaitProbe,
} from "../agent/long-horizon";
import type { TaskState } from "../agent/task-state";
import { updateMission } from "../runtime/missions";
import type { ActionLedger } from "../tools/registry";
import { missionStoreOf, segmentKey } from "./mission-runtime";
import type { ArmStageContext, StageOutcome } from "./types";

// How a stage lives across time (M40): it parks on a typed wait without
// spending anything, wakes on the clock, a model-free probe or a release,
// re-validates what it knew before continuing, keeps its goal frontier, and
// never repeats an irreversible action it already took.

/** Idle this long between slices and the world is re-checked on resume. */
const RESUME_GAP_MS = 10 * 60 * 1000;

function probeOf(context: ArmStageContext): WaitProbe | undefined {
  const provided = context.runtime.stores?.waitProbe?.();
  if (provided) return provided;
  return async (input) => {
    const { deliveryProbe } = await import("../runtime/waits");
    return deliveryProbe({
      actorId: context.identity.userId,
      workspaceId: context.identity.workspaceId,
    })(input);
  };
}

/**
 * The run's action ledger, backed by its mission. Null when the run has no
 * mission row: then the registry behaves as before M40.
 */
export async function missionLedger(
  context: ArmStageContext,
): Promise<ActionLedger | null> {
  const store = missionStoreOf(context);
  const runId = context.work.runId;
  const exists = await store.load(runId).catch(() => null);
  if (!exists) return null;
  return {
    lookup: async (key) => {
      const stored = await store.load(runId);
      const entry = stored ? actionState(stored.state, key) : null;
      return entry ? { phase: entry.phase, summary: entry.summary } : null;
    },
    record: async (entry) => {
      const next = await updateMission(store, runId, (state) =>
        recordAction(state, entry),
      );
      if (!next) throw new Error("mission_missing");
    },
  };
}

export type ResumeNote = {
  /** Observations for the loop: what the wait ended with, what went stale. */
  observations: string[];
  /** Fact statements the re-validation invalidated just now. */
  expired: string[];
  /** Set when the stage must stay parked; return it without a model call. */
  park: StageOutcome | null;
};

/**
 * Before a stage's loop runs again. If it parked on a wait, decide whether
 * the wait is over (no model involved); if it is, or if the stage simply
 * resumes after a gap, compare the mission's facts with the clock and
 * invalidate what expired, so the stage is not seeded with stale facts.
 */
export async function resumeStage(
  context: ArmStageContext,
  wait: MissionWait | null,
  now = Date.now(),
): Promise<ResumeNote> {
  const store = missionStoreOf(context);
  const runId = context.work.runId;
  const observations: string[] = [];
  let afterWait = false;
  if (wait) {
    const state = await wakeState(wait, now, probeOf(context));
    if (!state.ready)
      return {
        observations,
        expired: [],
        park: {
          kind: "WAITING",
          reason: wait.kind,
          wake: wait.wake,
          output: { wait: wait.id, still: state.how },
        },
      };
    afterWait = true;
    observations.push(
      `----- BEGIN UNTRUSTED TOOL RESULT (wait) -----\nThe ${wait.kind} wait (${wait.reason}) ended: ${state.how}.\n----- END UNTRUSTED TOOL RESULT -----`,
    );
    await updateMission(store, runId, (mission) =>
      resolveWait(mission, wait.id, state.how, new Date(now).toISOString()),
    ).catch(() => null);
  }

  const stored = await store.load(runId).catch(() => null);
  if (!stored) return { observations, expired: [], park: null };
  const last = horizonOf(stored.state).lastActiveAt;
  const gap = last ? now - Date.parse(last) : 0;
  let summary: { expired: string[]; stale: string[]; weakened: string[] } = {
    expired: [],
    stale: [],
    weakened: [],
  };
  if (afterWait || gap > RESUME_GAP_MS) {
    await updateMission(store, runId, (mission) => {
      const result = revalidateMission(mission, now, { afterWait });
      summary = result;
      return result.mission;
    }).catch(() => null);
    if (
      summary.expired.length ||
      summary.weakened.length ||
      summary.stale.length
    )
      observations.push(
        [
          "[world re-checked on resume]",
          summary.expired.length
            ? `No longer valid: ${summary.expired.slice(0, 6).join("; ")}.`
            : "",
          summary.stale.length
            ? `Possibly stale, re-observe before relying on: ${summary.stale.slice(0, 6).join("; ")}.`
            : "",
          summary.weakened.length
            ? `Weakened hypotheses: ${summary.weakened.slice(0, 4).join("; ")}.`
            : "",
          "Re-check anything that depended on these before continuing; replan if the plan assumed them.",
        ]
          .filter(Boolean)
          .join(" "),
      );
  }
  const goal = frontier(stored.state);
  if (goal)
    observations.push(
      `[goal frontier] Continue with: ${goal.title}${goal.failedHypotheses.length ? ` (already ruled out: ${goal.failedHypotheses.slice(0, 3).join("; ")})` : ""}.`,
    );
  return { observations, expired: summary.expired, park: null };
}

/**
 * The loop asked to WAIT. Record the wait on the mission and park the stage;
 * a question for a person goes through the approval queue like any other
 * decision a person makes.
 */
export async function parkOnWait(
  context: ArmStageContext,
  requested: AgentWait,
  now = Date.now(),
): Promise<{ wait: MissionWait; outcome: StageOutcome }> {
  const wake = wakeFor(requested, now);
  const draft: MissionWait = {
    id: `w-${now.toString(36)}`,
    kind: requested.kind,
    reason: requested.reason,
    stageKey: segmentKey(context.work.stageInput),
    wake,
    since: new Date(now).toISOString(),
    resolved: null,
  };
  let recorded: MissionWait = draft;
  await updateMission(
    missionStoreOf(context),
    context.work.runId,
    (mission) => {
      const opened = openWait(mission, {
        kind: draft.kind,
        reason: draft.reason,
        stageKey: draft.stageKey,
        wake: draft.wake,
        since: draft.since,
      });
      recorded = opened.wait;
      return opened.mission;
    },
  ).catch(() => null);
  return {
    wait: recorded,
    outcome: {
      kind: "WAITING",
      reason: requested.kind,
      wake: isHumanWait(requested.kind) ? undefined : wake,
      output: { wait: recorded.id, reason: requested.reason },
    },
  };
}

/** After a slice: goals from the kernel, and when the mission was last active. */
export async function recordActivity(
  context: ArmStageContext,
  kernel: TaskState | undefined,
  now = Date.now(),
) {
  await updateMission(
    missionStoreOf(context),
    context.work.runId,
    (mission) => {
      const withGoals = kernel ? reconcileGoals(mission, kernel) : mission;
      return { ...withGoals, lastActiveAt: new Date(now).toISOString() };
    },
  ).catch(() => null);
}
