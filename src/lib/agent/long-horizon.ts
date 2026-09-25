import type { MissionFact, MissionState } from "./mission";
import type { TaskState } from "./task-state";

// Long-horizon cognition on top of the mission (M40): typed waits that cost
// nothing while they wait, a goal stack whose frontier survives a restart,
// a ledger of completed actions so a replayed slice does not repeat an
// irreversible one, and temporal re-validation of facts on resume.
//
// Pure functions over the mission state; the runtime persists them in
// osirus.run_missions like the rest of the mission.

export const WAIT_KINDS = [
  "approval",
  "human",
  "dependency",
  "external_event",
  "deployment",
  "ci",
  "rate_limit",
  "schedule",
] as const;
export type WaitKind = (typeof WAIT_KINDS)[number];

export type WakeCondition =
  /** Resume at a time (schedule, rate limit). */
  | { kind: "time"; at: string }
  /** Resume when a matching event arrives (webhook, dependency). */
  | { kind: "event"; key: string; until?: string }
  /** Check something outside without a model, every few minutes. */
  | {
      kind: "poll";
      probe: "ci" | "deployment";
      ref: string;
      everySeconds: number;
      until: string;
    }
  /** A person decides (approval, question). */
  | { kind: "human" };

export type MissionWait = {
  id: string;
  kind: WaitKind;
  reason: string;
  stageKey: string;
  wake: WakeCondition;
  since: string;
  resolved: { at: string; how: string } | null;
};

export type GoalStatus =
  "active" | "blocked" | "deferred" | "completed" | "failed";

export type MissionGoal = {
  id: string;
  title: string;
  status: GoalStatus;
  parent: string | null;
  dependsOn: string[];
  alternatives: string[];
  failedHypotheses: string[];
};

export type ActionEntry = {
  key: string;
  toolId: string;
  phase: "intent" | "done" | "failed";
  irreversible: boolean;
  at: string;
  summary: string;
};

export type LongHorizonState = {
  waits: MissionWait[];
  goals: MissionGoal[];
  actions: ActionEntry[];
  lastActiveAt: string | null;
  nextWake: string | null;
};

/** The M40 part of a mission, defaulted for M39 rows that lack it. */
export function horizonOf(mission: MissionState): LongHorizonState {
  return {
    waits: mission.waits ?? [],
    goals: mission.goals ?? [],
    actions: mission.actions ?? [],
    lastActiveAt: mission.lastActiveAt ?? null,
    nextWake: mission.nextWake ?? null,
  };
}

function withHorizon(
  mission: MissionState,
  horizon: Partial<LongHorizonState>,
): MissionState {
  return { ...mission, ...horizonOf(mission), ...horizon };
}

// ----- waits ---------------------------------------------------------------

const MINUTE = 60 * 1000;
const MAX_WAIT_MS = 7 * 24 * 60 * MINUTE;

/** The kinds an agent asks for with WAIT (decision.ts AGENT_WAIT_KINDS). */
export type AgentWait = {
  kind: Exclude<WaitKind, "approval">;
  reason: string;
  until?: string;
  eventKey?: string;
  ref?: string;
};

function clampAt(value: string | undefined, fallbackMs: number, now: number) {
  const parsed = value ? Date.parse(value) : Number.NaN;
  const at = Number.isFinite(parsed) ? parsed : now + fallbackMs;
  return new Date(
    Math.min(Math.max(at, now + MINUTE), now + MAX_WAIT_MS),
  ).toISOString();
}

/**
 * How an agent's WAIT becomes a wake condition. Every wait is bounded: a
 * schedule or rate limit resumes at its time, a CI or deployment wait is
 * polled without a model and gives up at its deadline, an event wait gives
 * up at its deadline, a person is asked through the approval queue.
 */
export function wakeFor(wait: AgentWait, now = Date.now()): WakeCondition {
  switch (wait.kind) {
    case "schedule":
    case "rate_limit":
      return { kind: "time", at: clampAt(wait.until, 15 * MINUTE, now) };
    case "ci":
    case "deployment":
      return {
        kind: "poll",
        probe: wait.kind,
        ref: wait.ref ?? "main",
        everySeconds: 300,
        until: clampAt(wait.until, 2 * 60 * MINUTE, now),
      };
    case "external_event":
    case "dependency":
      return {
        kind: "event",
        key: wait.eventKey ?? wait.reason.slice(0, 200),
        until: clampAt(wait.until, 24 * 60 * MINUTE, now),
      };
    case "human":
      return { kind: "human" };
  }
}

/** Waits a person resolves: the run shows as waiting for someone. */
export function isHumanWait(kind: WaitKind | "external") {
  return kind === "approval" || kind === "human";
}

/**
 * How a wait parks its stage: a timed or polled wait is a blocked stage
 * with a delay (claimed again only when due, no model call before that); an
 * event or human wait is a waiting stage that only a release wakes.
 */
export function parkingFor(
  wake: WakeCondition,
  now = Date.now(),
): { stageStatus: "waiting" | "blocked"; retryDelaySeconds: number } {
  switch (wake.kind) {
    case "time":
      return {
        stageStatus: "blocked",
        retryDelaySeconds: Math.max(
          1,
          Math.ceil((Date.parse(wake.at) - now) / 1000),
        ),
      };
    case "poll":
      return {
        stageStatus: "blocked",
        retryDelaySeconds: Math.max(30, wake.everySeconds),
      };
    case "event":
      // Released early by the matching event; otherwise woken at the
      // deadline to decide without it.
      return wake.until
        ? {
            stageStatus: "blocked",
            retryDelaySeconds: Math.max(
              1,
              Math.ceil((Date.parse(wake.until) - now) / 1000),
            ),
          }
        : { stageStatus: "waiting", retryDelaySeconds: 0 };
    case "human":
      return { stageStatus: "waiting", retryDelaySeconds: 0 };
  }
}

export function openWait(
  mission: MissionState,
  wait: Omit<MissionWait, "id" | "since" | "resolved"> & { since?: string },
): { mission: MissionState; wait: MissionWait } {
  const horizon = horizonOf(mission);
  const created: MissionWait = {
    ...wait,
    id: `w${horizon.waits.length + 1}`,
    since: wait.since ?? new Date().toISOString(),
    resolved: null,
  };
  const nextWake =
    created.wake.kind === "time"
      ? created.wake.at
      : created.wake.kind === "poll" || created.wake.kind === "event"
        ? (created.wake.until ?? null)
        : null;
  return {
    wait: created,
    mission: withHorizon(mission, {
      waits: [...horizon.waits, created].slice(-24),
      nextWake,
    }),
  };
}

export function pendingWait(mission: MissionState, stageKey: string) {
  return (
    horizonOf(mission).waits.find(
      (wait) => wait.stageKey === stageKey && !wait.resolved,
    ) ?? null
  );
}

export function resolveWait(
  mission: MissionState,
  id: string,
  how: string,
  at = new Date().toISOString(),
): MissionState {
  const horizon = horizonOf(mission);
  return withHorizon(mission, {
    waits: horizon.waits.map((wait) =>
      wait.id === id ? { ...wait, resolved: { at, how } } : wait,
    ),
    nextWake: null,
  });
}

export type ProbeResult =
  | { state: "met"; detail: string }
  | { state: "unmet" | "unobservable"; detail?: string };

/**
 * Model-free observation of the outside world for a wait: whether the CI
 * run or deployment on a ref reported, or whether an event arrived since
 * the wait began. Production reads recorded webhook deliveries; tests and
 * the pulse script it.
 */
export type WaitProbe = (input: {
  wake: Extract<WakeCondition, { kind: "poll" | "event" }>;
  since: string;
}) => Promise<ProbeResult>;

/**
 * Whether a wait may end now. Time needs no probe; a poll or an event asks
 * the model-free probe; a person is woken from outside, never by polling.
 */
export async function wakeState(
  wait: MissionWait,
  now: number,
  probe?: WaitProbe,
): Promise<{ ready: boolean; how: string; observed: boolean }> {
  const wake = wait.wake;
  if (wake.kind === "time")
    return Date.parse(wake.at) <= now
      ? { ready: true, how: "time reached", observed: false }
      : { ready: false, how: "not yet", observed: false };
  if (wake.kind === "human")
    return { ready: false, how: "waiting for a person", observed: false };
  const result: ProbeResult = probe
    ? await probe({ wake, since: wait.since }).catch(() => ({
        state: "unobservable" as const,
        detail: "probe failed",
      }))
    : { state: "unobservable" };
  if (result.state === "met")
    return { ready: true, how: result.detail, observed: true };
  const until = wake.until ? Date.parse(wake.until) : Number.POSITIVE_INFINITY;
  if (until <= now)
    return {
      ready: true,
      how: `${wake.kind === "poll" ? wake.probe : wake.key} not observed before ${wake.until} (${result.state})`,
      observed: false,
    };
  return { ready: false, how: result.detail ?? result.state, observed: false };
}

// ----- goal stack ----------------------------------------------------------

/** Goals from the kernel's plan and subgoals, merged into the mission's. */
export function reconcileGoals(
  mission: MissionState,
  kernel: TaskState,
): MissionState {
  const horizon = horizonOf(mission);
  const goals = new Map(horizon.goals.map((goal) => [goal.id, goal]));
  kernel.plan.forEach((step, index) => {
    const prior = goals.get(step.id);
    const status: GoalStatus =
      step.status === "done"
        ? "completed"
        : step.status === "blocked"
          ? "blocked"
          : step.status === "revised"
            ? "deferred"
            : "active";
    goals.set(step.id, {
      id: step.id,
      title: step.title,
      status: prior?.status === "completed" ? "completed" : status,
      parent: prior?.parent ?? null,
      dependsOn:
        prior?.dependsOn ?? (index > 0 ? [kernel.plan[index - 1]!.id] : []),
      alternatives: prior?.alternatives ?? [],
      failedHypotheses: [
        ...new Set([
          ...(prior?.failedHypotheses ?? []),
          ...kernel.hypotheses
            .filter((h) => h.status === "REJECTED")
            .map((h) => h.statement),
        ]),
      ].slice(-8),
    });
  });
  for (const title of kernel.completedSubgoals)
    for (const goal of goals.values())
      if (goal.title === title) goal.status = "completed";
  for (const title of kernel.blockedSubgoals)
    for (const goal of goals.values())
      if (goal.title === title && goal.status !== "completed")
        goal.status = "blocked";
  return withHorizon(mission, { goals: [...goals.values()].slice(-32) });
}

/** The goal to work on after a restart: active, with its prerequisites done. */
export function frontier(mission: MissionState): MissionGoal | null {
  const goals = horizonOf(mission).goals;
  const done = new Set(
    goals.filter((goal) => goal.status === "completed").map((goal) => goal.id),
  );
  return (
    goals.find(
      (goal) =>
        goal.status === "active" &&
        goal.dependsOn.every((dependency) => done.has(dependency)),
    ) ?? null
  );
}

// ----- action ledger -------------------------------------------------------

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.keys(value as object)
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${stable((value as Record<string, unknown>)[key])}`,
      )
      .join(",")}}`;
  return JSON.stringify(value);
}

/** The same tool with the same input is the same action. */
export function actionKey(toolId: string, input: unknown) {
  const text = `${toolId}|${stable(input)}`;
  let h1 = 0x811c9dc5;
  let h2 = 5381;
  for (let index = 0; index < text.length; index += 1) {
    h1 = Math.imul(h1 ^ text.charCodeAt(index), 16777619);
    h2 = (h2 * 33) ^ text.charCodeAt(index);
  }
  return `${toolId}:${(h1 >>> 0).toString(36)}${(h2 >>> 0).toString(36)}`;
}

export function actionState(mission: MissionState, key: string) {
  return horizonOf(mission).actions.find((entry) => entry.key === key) ?? null;
}

export function recordAction(
  mission: MissionState,
  entry: Omit<ActionEntry, "at"> & { at?: string },
): MissionState {
  const horizon = horizonOf(mission);
  const others = horizon.actions.filter((action) => action.key !== entry.key);
  return withHorizon(mission, {
    actions: [
      ...others,
      { ...entry, at: entry.at ?? new Date().toISOString() },
    ].slice(-200),
  });
}

// ----- temporal re-validation ----------------------------------------------

/**
 * A resumed stage's working kernel still holds the facts it was seeded
 * with. Drop the ones the mission invalidated, so the stage cannot keep
 * reasoning from them; they stay on the mission, marked, with the reason.
 */
export function pruneExpired(kernel: TaskState, expired: string[]): TaskState {
  if (!expired.length) return kernel;
  const dead = expired.map((statement) => statement.toLowerCase());
  const alive = (line: string) =>
    !dead.some((statement) => line.toLowerCase().includes(statement));
  return {
    ...kernel,
    knownFacts: kernel.knownFacts.filter(alive),
    openQuestions: [
      ...kernel.openQuestions,
      ...expired
        .slice(0, 3)
        .map((statement) => `Re-observe: ${statement}`.slice(0, 300)),
    ].slice(-12),
  };
}

const HOUR = 60 * 60 * 1000;

/** How long a fact holds without being observed again. */
export function validityWindowMs(volatility: MissionFact["volatility"]) {
  switch (volatility) {
    case "static":
      return Number.POSITIVE_INFINITY;
    case "slow":
      return 30 * 24 * HOUR;
    case "fast":
      return HOUR;
    case "event":
      // Holds until something happens, not for a time: invalidated when
      // the stage resumes from a wait (or at an explicit validUntil).
      return Number.POSITIVE_INFINITY;
  }
}

export type Revalidation = {
  mission: MissionState;
  expired: string[];
  stale: string[];
  weakened: string[];
};

/**
 * On resume: compare the mission's facts with the clock. A fact past its
 * `validUntil` (or its volatility window) is invalidated; an event fact is
 * stale after any wait; hypotheses that rested on an invalidated fact are
 * weakened; the plan gets a revision saying so. Nothing is deleted.
 */
export function revalidateMission(
  mission: MissionState,
  now = Date.now(),
  options: { afterWait?: boolean } = {},
): Revalidation {
  const expired: string[] = [];
  const stale: string[] = [];
  const at = new Date(now).toISOString();
  const facts = mission.facts.map((fact) => {
    if (fact.invalidated) return fact;
    const until = fact.validUntil
      ? Date.parse(fact.validUntil)
      : Date.parse(fact.observedAt) + validityWindowMs(fact.volatility);
    if (until <= now || (options.afterWait && fact.volatility === "event")) {
      expired.push(fact.statement);
      return {
        ...fact,
        invalidated: {
          at,
          reason:
            fact.volatility === "event" && options.afterWait
              ? "an event fact does not survive a wait"
              : `valid until ${new Date(until).toISOString()}`,
        },
      };
    }
    if (
      fact.volatility === "fast" &&
      now - Date.parse(fact.observedAt) > HOUR / 2
    )
      stale.push(fact.statement);
    return fact;
  });
  // What an invalidated fact stood on: its id, its refs, its statement.
  const dead = new Set<string>();
  for (const fact of facts)
    if (fact.invalidated) {
      dead.add(fact.id);
      dead.add(fact.statement.toLowerCase());
      for (const ref of fact.evidenceRefs) dead.add(ref);
    }
  const live = new Set<string>();
  for (const fact of facts)
    if (!fact.invalidated) for (const ref of fact.evidenceRefs) live.add(ref);
  const weakened: string[] = [];
  const hypotheses = mission.hypotheses.map((hypothesis) => {
    const leansOnDead =
      hypothesis.supporting.length > 0 &&
      hypothesis.supporting.every(
        (ref) =>
          !live.has(ref) && (dead.has(ref) || dead.has(ref.toLowerCase())),
      );
    if (
      leansOnDead &&
      (hypothesis.status === "SUPPORTED" || hypothesis.status === "CONFIRMED")
    ) {
      weakened.push(hypothesis.statement);
      return { ...hypothesis, status: "WEAKENED" as const };
    }
    return hypothesis;
  });
  const changed = expired.length + weakened.length > 0;
  return {
    expired,
    stale,
    weakened,
    mission: {
      ...mission,
      facts,
      hypotheses,
      planRevisions: changed
        ? [
            ...mission.planRevisions,
            {
              at,
              stageKey: "resume",
              reason: "resume: re-validated the world",
              summary: `${expired.length} fact(s) expired${expired.length ? ` (${expired.slice(0, 3).join("; ")})` : ""}; ${weakened.length} hypothesis(es) weakened.`,
            },
          ].slice(-24)
        : mission.planRevisions,
    },
  };
}
