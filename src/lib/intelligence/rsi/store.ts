import { randomUUID } from "node:crypto";
import type { RsiCycle, RsiPhase, RsiState } from "./types";

// Where the Recursive Intelligence Cycle keeps its state:
// osirus_intel.rsi_cycles in production, a map in tests and in the Actions
// runner. The same rules as the pulse store: one running cycle, a lease to
// step it, a cursor that moves only from the value the caller read, and a
// state written together with the cursor so a crash between phases loses
// nothing that was committed.

export interface RsiStore {
  activeCycle(): Promise<RsiCycle | null>;
  lastCompleted(): Promise<RsiCycle | null>;
  /** Start a cycle; null if another instance started one first. */
  createCycle(phases: RsiPhase[]): Promise<RsiCycle | null>;
  leaseCycle(
    id: string,
    owner: string,
    seconds: number,
  ): Promise<RsiCycle | null>;
  releaseCycle(id: string, owner: string): Promise<void>;
  /** Move the cursor from `from` to `to` with the new state; CAS. */
  advance(
    id: string,
    owner: string,
    from: number,
    to: number,
    state: RsiState,
  ): Promise<boolean>;
  completeCycle(
    id: string,
    owner: string,
    nextDueAt: string,
    summary: Record<string, unknown>,
  ): Promise<boolean>;
  abandonCycle(id: string): Promise<void>;
  recentCycles(limit: number): Promise<RsiCycle[]>;
}

type Row = Record<string, unknown>;

const iso = (value: unknown) =>
  value === null || value === undefined
    ? null
    : new Date(value as string).toISOString();

function cycleOf(row: Row): RsiCycle {
  return {
    id: String(row.id),
    phases: (row.phases as RsiPhase[]) ?? [],
    cursor: Number(row.cursor),
    status: row.status as RsiCycle["status"],
    leaseOwner: (row.lease_owner as string | null) ?? null,
    leaseExpiresAt: iso(row.lease_expires_at),
    state: (row.state as RsiState) ?? {},
    startedAt: iso(row.started_at)!,
    completedAt: iso(row.completed_at),
    nextDueAt: iso(row.next_due_at),
    summary: (row.summary as Record<string, unknown>) ?? {},
  };
}

export class PgRsiStore implements RsiStore {
  private async q<T extends Row = Row>(text: string, params: unknown[] = []) {
    const { querySystem } = await import("../../db/client");
    return querySystem<T>(text, params);
  }

  async activeCycle() {
    const [row] = await this.q(
      `select * from osirus_intel.rsi_cycles
        where status = 'running' order by started_at desc limit 1`,
    );
    return row ? cycleOf(row) : null;
  }
  async lastCompleted() {
    const [row] = await this.q(
      `select * from osirus_intel.rsi_cycles
        where status = 'completed' order by completed_at desc limit 1`,
    );
    return row ? cycleOf(row) : null;
  }
  async createCycle(phases: RsiPhase[]) {
    // The partial unique index allows one running cycle; a concurrent start
    // loses quietly and reads the winner instead.
    const [row] = await this.q(
      `insert into osirus_intel.rsi_cycles (phases)
       values ($1::text[])
       on conflict do nothing
       returning *`,
      [phases],
    );
    return row ? cycleOf(row) : null;
  }
  async leaseCycle(id: string, owner: string, seconds: number) {
    const [row] = await this.q(
      `update osirus_intel.rsi_cycles
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
      `update osirus_intel.rsi_cycles
          set lease_owner = null, lease_expires_at = null
        where id = $1::uuid and lease_owner = $2`,
      [id, owner],
    );
  }
  async advance(
    id: string,
    owner: string,
    from: number,
    to: number,
    state: RsiState,
  ) {
    const rows = await this.q(
      `update osirus_intel.rsi_cycles set cursor = $4, state = $5::jsonb
        where id = $1::uuid and lease_owner = $2 and cursor = $3
          and status = 'running'
        returning id`,
      [id, owner, from, to, JSON.stringify(state)],
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
      `update osirus_intel.rsi_cycles
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
      `update osirus_intel.rsi_cycles
          set status = 'abandoned', completed_at = now(),
              lease_owner = null, lease_expires_at = null
        where id = $1::uuid and status = 'running'`,
      [id],
    );
  }
  async recentCycles(limit: number) {
    return (
      await this.q(
        `select * from osirus_intel.rsi_cycles
          order by started_at desc limit $1`,
        [limit],
      )
    ).map(cycleOf);
  }
}

/** The same contract in memory, for tests and the Actions runner. */
export class MemoryRsiStore implements RsiStore {
  private cycles = new Map<string, RsiCycle>();
  constructor(private readonly now: () => number = Date.now) {}

  private copy(cycle: RsiCycle): RsiCycle {
    return structuredClone(cycle);
  }
  private stamp() {
    return new Date(this.now()).toISOString();
  }
  async activeCycle() {
    const running = [...this.cycles.values()]
      .filter((cycle) => cycle.status === "running")
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    return running[0] ? this.copy(running[0]) : null;
  }
  async lastCompleted() {
    const done = [...this.cycles.values()]
      .filter((cycle) => cycle.status === "completed")
      .sort((a, b) => (b.completedAt ?? "").localeCompare(a.completedAt ?? ""));
    return done[0] ? this.copy(done[0]) : null;
  }
  async createCycle(phases: RsiPhase[]) {
    if (await this.activeCycle()) return null;
    const cycle: RsiCycle = {
      id: randomUUID(),
      phases,
      cursor: 0,
      status: "running",
      leaseOwner: null,
      leaseExpiresAt: null,
      state: {},
      startedAt: this.stamp(),
      completedAt: null,
      nextDueAt: null,
      summary: {},
    };
    this.cycles.set(cycle.id, cycle);
    return this.copy(cycle);
  }
  async leaseCycle(id: string, owner: string, seconds: number) {
    const cycle = this.cycles.get(id);
    if (!cycle || cycle.status !== "running") return null;
    const expired =
      !cycle.leaseExpiresAt || Date.parse(cycle.leaseExpiresAt) < this.now();
    if (cycle.leaseOwner && cycle.leaseOwner !== owner && !expired) return null;
    cycle.leaseOwner = owner;
    cycle.leaseExpiresAt = new Date(this.now() + seconds * 1000).toISOString();
    return this.copy(cycle);
  }
  async releaseCycle(id: string, owner: string) {
    const cycle = this.cycles.get(id);
    if (cycle?.leaseOwner === owner) {
      cycle.leaseOwner = null;
      cycle.leaseExpiresAt = null;
    }
  }
  async advance(
    id: string,
    owner: string,
    from: number,
    to: number,
    state: RsiState,
  ) {
    const cycle = this.cycles.get(id);
    if (
      !cycle ||
      cycle.status !== "running" ||
      cycle.leaseOwner !== owner ||
      cycle.cursor !== from
    )
      return false;
    cycle.cursor = to;
    cycle.state = structuredClone(state);
    return true;
  }
  async completeCycle(
    id: string,
    owner: string,
    nextDueAt: string,
    summary: Record<string, unknown>,
  ) {
    const cycle = this.cycles.get(id);
    if (!cycle || cycle.status !== "running" || cycle.leaseOwner !== owner)
      return false;
    cycle.status = "completed";
    cycle.completedAt = this.stamp();
    cycle.nextDueAt = nextDueAt;
    cycle.summary = structuredClone(summary);
    cycle.leaseOwner = null;
    cycle.leaseExpiresAt = null;
    return true;
  }
  async abandonCycle(id: string) {
    const cycle = this.cycles.get(id);
    if (cycle?.status === "running") {
      cycle.status = "abandoned";
      cycle.completedAt = this.stamp();
      cycle.leaseOwner = null;
      cycle.leaseExpiresAt = null;
    }
  }
  async recentCycles(limit: number) {
    return [...this.cycles.values()]
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
      .slice(0, limit)
      .map((cycle) => this.copy(cycle));
  }
  /** Test hook: every cycle, as stored. */
  all() {
    return [...this.cycles.values()].map((cycle) => this.copy(cycle));
  }
}
