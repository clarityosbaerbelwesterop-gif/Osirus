import type { CapabilityOutcome } from "../../verification/outcome";
import type { CapabilityLane, CapabilityLevel } from "./lanes";
import type { PulseBaseline, PulseCycle, PulseResult } from "./types";

// Where the pulse keeps its state: osirus_intel.pulse_* in production, a map
// in tests. Every write is safe to repeat. A cycle is driven only by the
// holder of its lease; a result is written once per (cycle, task); the
// cursor moves only from the value the caller last saw.

export interface PulseStore {
  /** The running cycle, if any. */
  activeCycle(): Promise<PulseCycle | null>;
  lastCompleted(): Promise<PulseCycle | null>;
  /** Start a cycle; null if another instance started one first. */
  createCycle(input: {
    suiteVersion: string;
    taskIds: string[];
  }): Promise<PulseCycle | null>;
  /** Take or renew the lease; null while another owner holds it. */
  leaseCycle(
    id: string,
    owner: string,
    seconds: number,
  ): Promise<PulseCycle | null>;
  releaseCycle(id: string, owner: string): Promise<void>;
  /** False when this (cycle, task) already has a result. */
  recordResult(result: PulseResult): Promise<boolean>;
  cycleResults(cycleId: string): Promise<PulseResult[]>;
  /** Move the cursor from `from` to `to`; false if it had moved already. */
  advanceCursor(
    id: string,
    owner: string,
    from: number,
    to: number,
  ): Promise<boolean>;
  completeCycle(
    id: string,
    owner: string,
    nextDueAt: string,
    summary: Record<string, unknown>,
  ): Promise<boolean>;
  /** End a cycle nobody finished in time, so a new one can start. */
  abandonCycle(id: string): Promise<void>;
  /** Outcomes of a cell, oldest first. */
  cellOutcomes(input: {
    suiteVersion: string;
    family: CapabilityLane;
    level: CapabilityLevel;
    limit: number;
  }): Promise<CapabilityOutcome[]>;
  baseline(
    suiteVersion: string,
    family: CapabilityLane,
    level: CapabilityLevel,
  ): Promise<PulseBaseline | null>;
  saveBaseline(baseline: PulseBaseline): Promise<void>;
  baselines(suiteVersion?: string): Promise<PulseBaseline[]>;
  recentCycles(limit: number): Promise<PulseCycle[]>;
}

type Row = Record<string, unknown>;

const iso = (value: unknown) =>
  value === null || value === undefined
    ? null
    : new Date(value as string).toISOString();

function cycleOf(row: Row): PulseCycle {
  return {
    id: String(row.id),
    suiteVersion: String(row.suite_version),
    taskIds: (row.task_ids as string[]) ?? [],
    cursor: Number(row.cursor),
    status: row.status as PulseCycle["status"],
    leaseOwner: (row.lease_owner as string | null) ?? null,
    leaseExpiresAt: iso(row.lease_expires_at),
    startedAt: iso(row.started_at)!,
    completedAt: iso(row.completed_at),
    nextDueAt: iso(row.next_due_at),
    summary: (row.summary as Record<string, unknown>) ?? {},
  };
}

function resultOf(row: Row): PulseResult {
  return {
    cycleId: String(row.cycle_id),
    taskId: String(row.task_id),
    suiteVersion: String(row.suite_version),
    family: row.family as CapabilityLane,
    level: Number(row.level) as CapabilityLevel,
    difficulty: row.difficulty as PulseResult["difficulty"],
    mode: row.mode as PulseResult["mode"],
    outcome: row.outcome as CapabilityOutcome,
    reason: String(row.reason ?? ""),
    evidence: (row.evidence as Record<string, unknown>) ?? {},
    modelCalls: Number(row.model_calls),
    toolCalls: Number(row.tool_calls),
    latencyMs: Number(row.latency_ms),
    createdAt: iso(row.created_at) ?? undefined,
  };
}

function baselineOf(row: Row): PulseBaseline {
  return {
    suiteVersion: String(row.suite_version),
    family: row.family as CapabilityLane,
    level: Number(row.level) as CapabilityLevel,
    samples: Number(row.samples),
    verified: Number(row.verified),
    falseCompletions: Number(row.false_completions),
    excluded: Number(row.excluded),
    rate: Number(row.rate),
    lower: Number(row.lower),
    upper: Number(row.upper),
    regressionStreak: Number(row.regression_streak),
    updatedAt: iso(row.updated_at) ?? undefined,
  };
}

export class PgPulseStore implements PulseStore {
  private async q<T extends Row = Row>(text: string, params: unknown[] = []) {
    const { querySystem } = await import("../../db/client");
    return querySystem<T>(text, params);
  }

  async activeCycle() {
    const [row] = await this.q(
      `select * from osirus_intel.pulse_cycles
        where status = 'running' order by started_at desc limit 1`,
    );
    return row ? cycleOf(row) : null;
  }
  async lastCompleted() {
    const [row] = await this.q(
      `select * from osirus_intel.pulse_cycles
        where status = 'completed' order by completed_at desc limit 1`,
    );
    return row ? cycleOf(row) : null;
  }
  async createCycle(input: { suiteVersion: string; taskIds: string[] }) {
    // The partial unique index allows one running cycle; a concurrent start
    // loses quietly and reads the winner instead.
    const [row] = await this.q(
      `insert into osirus_intel.pulse_cycles (suite_version, task_ids)
       values ($1, $2::text[])
       on conflict do nothing
       returning *`,
      [input.suiteVersion, input.taskIds],
    );
    return row ? cycleOf(row) : null;
  }
  async leaseCycle(id: string, owner: string, seconds: number) {
    const [row] = await this.q(
      `update osirus_intel.pulse_cycles
          set lease_owner = $2,
              lease_expires_at = now() + make_interval(secs => $3)
        where id = $1::uuid and status = 'running'
          and (lease_owner is null or lease_owner = $2
               or lease_expires_at < now())
        returning *`,
      [id, owner, seconds],
    );
    return row ? cycleOf(row) : null;
  }
  async releaseCycle(id: string, owner: string) {
    await this.q(
      `update osirus_intel.pulse_cycles
          set lease_owner = null, lease_expires_at = null
        where id = $1::uuid and lease_owner = $2`,
      [id, owner],
    );
  }
  async recordResult(result: PulseResult) {
    const rows = await this.q(
      `insert into osirus_intel.pulse_results
         (cycle_id, task_id, suite_version, family, level, difficulty, mode,
          outcome, reason, evidence, model_calls, tool_calls, latency_ms)
       values ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11,
               $12, $13)
       on conflict (cycle_id, task_id) do nothing
       returning id`,
      [
        result.cycleId,
        result.taskId,
        result.suiteVersion,
        result.family,
        result.level,
        result.difficulty,
        result.mode,
        result.outcome,
        result.reason.slice(0, 500),
        JSON.stringify(result.evidence),
        result.modelCalls,
        result.toolCalls,
        Math.round(result.latencyMs),
      ],
    );
    return rows.length > 0;
  }
  async cycleResults(cycleId: string) {
    return (
      await this.q(
        `select * from osirus_intel.pulse_results
          where cycle_id = $1::uuid order by created_at`,
        [cycleId],
      )
    ).map(resultOf);
  }
  async advanceCursor(id: string, owner: string, from: number, to: number) {
    const rows = await this.q(
      `update osirus_intel.pulse_cycles set cursor = $4
        where id = $1::uuid and lease_owner = $2 and cursor = $3
          and status = 'running'
        returning id`,
      [id, owner, from, to],
    );
    return rows.length > 0;
  }
  async completeCycle(
    id: string,
    owner: string,
    nextDueAt: string,
    summary: Record<string, unknown>,
  ) {
    const rows = await this.q(
      `update osirus_intel.pulse_cycles
          set status = 'completed', completed_at = now(),
              next_due_at = $3::timestamptz, summary = $4::jsonb,
              lease_owner = null, lease_expires_at = null
        where id = $1::uuid and lease_owner = $2 and status = 'running'
        returning id`,
      [id, owner, nextDueAt, JSON.stringify(summary)],
    );
    return rows.length > 0;
  }
  async abandonCycle(id: string) {
    await this.q(
      `update osirus_intel.pulse_cycles
          set status = 'abandoned', completed_at = now(),
              lease_owner = null, lease_expires_at = null
        where id = $1::uuid and status = 'running'`,
      [id],
    );
  }
  async cellOutcomes(input: {
    suiteVersion: string;
    family: CapabilityLane;
    level: CapabilityLevel;
    limit: number;
  }) {
    const rows = await this.q<{ outcome: string }>(
      `select outcome from (
         select outcome, created_at from osirus_intel.pulse_results
          where suite_version = $1 and family = $2 and level = $3
          order by created_at desc limit $4) recent
        order by created_at`,
      [input.suiteVersion, input.family, input.level, input.limit],
    );
    return rows.map((row) => row.outcome as CapabilityOutcome);
  }
  async baseline(
    suiteVersion: string,
    family: CapabilityLane,
    level: CapabilityLevel,
  ) {
    const [row] = await this.q(
      `select * from osirus_intel.pulse_baselines
        where suite_version = $1 and family = $2 and level = $3`,
      [suiteVersion, family, level],
    );
    return row ? baselineOf(row) : null;
  }
  async saveBaseline(baseline: PulseBaseline) {
    await this.q(
      `insert into osirus_intel.pulse_baselines
         (suite_version, family, level, samples, verified, false_completions,
          excluded, rate, lower, upper, regression_streak, updated_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, now())
       on conflict (suite_version, family, level) do update set
         samples = excluded.samples, verified = excluded.verified,
         false_completions = excluded.false_completions,
         excluded = excluded.excluded, rate = excluded.rate,
         lower = excluded.lower, upper = excluded.upper,
         regression_streak = excluded.regression_streak,
         updated_at = now()`,
      [
        baseline.suiteVersion,
        baseline.family,
        baseline.level,
        baseline.samples,
        baseline.verified,
        baseline.falseCompletions,
        baseline.excluded,
        baseline.rate,
        baseline.lower,
        baseline.upper,
        baseline.regressionStreak,
      ],
    );
  }
  async baselines(suiteVersion?: string) {
    return (
      await this.q(
        `select * from osirus_intel.pulse_baselines
          where $1::text is null or suite_version = $1
          order by family, level`,
        [suiteVersion ?? null],
      )
    ).map(baselineOf);
  }
  async recentCycles(limit: number) {
    return (
      await this.q(
        `select * from osirus_intel.pulse_cycles
          order by started_at desc limit $1`,
        [limit],
      )
    ).map(cycleOf);
  }
}

/** The same contract over maps, for tests and the offline CI runner. */
export class MemoryPulseStore implements PulseStore {
  cycles: PulseCycle[] = [];
  results: PulseResult[] = [];
  cells = new Map<string, PulseBaseline>();
  /** Test hook: the clock the lease compares against. */
  now: () => number = () => Date.now();
  private sequence = 0;

  private cellKey(suite: string, family: string, level: number) {
    return `${suite}|${family}|${level}`;
  }
  async activeCycle() {
    return this.cycles.find((cycle) => cycle.status === "running") ?? null;
  }
  async lastCompleted() {
    return (
      [...this.cycles]
        .filter((cycle) => cycle.status === "completed")
        .sort((a, b) =>
          (b.completedAt ?? "").localeCompare(a.completedAt ?? ""),
        )[0] ?? null
    );
  }
  async createCycle(input: { suiteVersion: string; taskIds: string[] }) {
    if (await this.activeCycle()) return null;
    this.sequence += 1;
    const cycle: PulseCycle = {
      id: `00000000-0000-4000-8000-${String(this.sequence).padStart(12, "0")}`,
      suiteVersion: input.suiteVersion,
      taskIds: [...input.taskIds],
      cursor: 0,
      status: "running",
      leaseOwner: null,
      leaseExpiresAt: null,
      startedAt: new Date(this.now()).toISOString(),
      completedAt: null,
      nextDueAt: null,
      summary: {},
    };
    this.cycles.push(cycle);
    return { ...cycle };
  }
  async leaseCycle(id: string, owner: string, seconds: number) {
    const cycle = this.cycles.find((entry) => entry.id === id);
    if (!cycle || cycle.status !== "running") return null;
    const expired =
      !cycle.leaseExpiresAt || Date.parse(cycle.leaseExpiresAt) < this.now();
    if (cycle.leaseOwner && cycle.leaseOwner !== owner && !expired) return null;
    cycle.leaseOwner = owner;
    cycle.leaseExpiresAt = new Date(this.now() + seconds * 1000).toISOString();
    return { ...cycle, taskIds: [...cycle.taskIds] };
  }
  async releaseCycle(id: string, owner: string) {
    const cycle = this.cycles.find((entry) => entry.id === id);
    if (cycle?.leaseOwner === owner) {
      cycle.leaseOwner = null;
      cycle.leaseExpiresAt = null;
    }
  }
  async recordResult(result: PulseResult) {
    if (
      this.results.some(
        (entry) =>
          entry.cycleId === result.cycleId && entry.taskId === result.taskId,
      )
    )
      return false;
    this.results.push({
      ...result,
      createdAt:
        result.createdAt ??
        new Date(this.now() + this.results.length).toISOString(),
    });
    return true;
  }
  async cycleResults(cycleId: string) {
    return this.results.filter((entry) => entry.cycleId === cycleId);
  }
  async advanceCursor(id: string, owner: string, from: number, to: number) {
    const cycle = this.cycles.find((entry) => entry.id === id);
    if (
      !cycle ||
      cycle.status !== "running" ||
      cycle.leaseOwner !== owner ||
      cycle.cursor !== from
    )
      return false;
    cycle.cursor = to;
    return true;
  }
  async completeCycle(
    id: string,
    owner: string,
    nextDueAt: string,
    summary: Record<string, unknown>,
  ) {
    const cycle = this.cycles.find((entry) => entry.id === id);
    if (!cycle || cycle.status !== "running" || cycle.leaseOwner !== owner)
      return false;
    cycle.status = "completed";
    cycle.completedAt = new Date(this.now()).toISOString();
    cycle.nextDueAt = nextDueAt;
    cycle.summary = summary;
    cycle.leaseOwner = null;
    cycle.leaseExpiresAt = null;
    return true;
  }
  async abandonCycle(id: string) {
    const cycle = this.cycles.find((entry) => entry.id === id);
    if (cycle?.status === "running") {
      cycle.status = "abandoned";
      cycle.completedAt = new Date(this.now()).toISOString();
      cycle.leaseOwner = null;
    }
  }
  async cellOutcomes(input: {
    suiteVersion: string;
    family: CapabilityLane;
    level: CapabilityLevel;
    limit: number;
  }) {
    return this.results
      .filter(
        (entry) =>
          entry.suiteVersion === input.suiteVersion &&
          entry.family === input.family &&
          entry.level === input.level,
      )
      .slice(-input.limit)
      .map((entry) => entry.outcome);
  }
  async baseline(
    suiteVersion: string,
    family: CapabilityLane,
    level: CapabilityLevel,
  ) {
    return this.cells.get(this.cellKey(suiteVersion, family, level)) ?? null;
  }
  async saveBaseline(baseline: PulseBaseline) {
    this.cells.set(
      this.cellKey(baseline.suiteVersion, baseline.family, baseline.level),
      { ...baseline, updatedAt: new Date(this.now()).toISOString() },
    );
  }
  async baselines(suiteVersion?: string) {
    return [...this.cells.values()].filter(
      (cell) => !suiteVersion || cell.suiteVersion === suiteVersion,
    );
  }
  async recentCycles(limit: number) {
    return [...this.cycles].reverse().slice(0, limit);
  }
}
