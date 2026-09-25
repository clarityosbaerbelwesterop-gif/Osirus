import type { MissionState } from "../agent/mission";

// Where a run's mission state lives: osirus.run_missions in production, a
// map in the arena harness and in tests. Writes compare and swap on the
// version; `updateMission` retries a lost race against the fresh row, so two
// stages reconciling at once both land.

export type StoredMission = { state: MissionState; version: number };

export interface MissionStore {
  load(runId: string): Promise<StoredMission | null>;
  /** Insert the first version; false if one exists. */
  create(runId: string, state: MissionState): Promise<boolean>;
  /** Replace version `expected` with `expected + 1`; false if it moved. */
  save(runId: string, state: MissionState, expected: number): Promise<boolean>;
}

export class MissionConflictError extends Error {
  constructor(runId: string) {
    super(`mission_conflict:${runId}`);
    this.name = "MissionConflictError";
  }
}

/** Apply `change` to the latest mission, retrying on a concurrent write. */
export async function updateMission(
  store: MissionStore,
  runId: string,
  change: (state: MissionState) => MissionState,
  attempts = 5,
): Promise<MissionState | null> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const current = await store.load(runId);
    if (!current) return null;
    const next = change(current.state);
    if (await store.save(runId, next, current.version)) return next;
  }
  throw new MissionConflictError(runId);
}

export class MemoryMissionStore implements MissionStore {
  rows = new Map<string, StoredMission>();
  async load(runId: string) {
    const row = this.rows.get(runId);
    return row ? structuredClone(row) : null;
  }
  async create(runId: string, state: MissionState) {
    if (this.rows.has(runId)) return false;
    this.rows.set(runId, { state: structuredClone(state), version: 1 });
    return true;
  }
  async save(runId: string, state: MissionState, expected: number) {
    const row = this.rows.get(runId);
    if (!row || row.version !== expected) return false;
    this.rows.set(runId, {
      state: structuredClone(state),
      version: expected + 1,
    });
    return true;
  }
}

/** Tenant-scoped: every statement runs as the run's user under RLS. */
export class PgMissionStore implements MissionStore {
  constructor(private readonly userId: string) {}

  private async q<T>(text: string, params: unknown[]) {
    const { queryAs } = await import("../db/client");
    return queryAs<T>(this.userId, text, params);
  }

  async load(runId: string) {
    const [row] = await this.q<{ state: MissionState; version: number }>(
      `select state, version from osirus.run_missions where run_id = $1::uuid`,
      [runId],
    );
    return row ? { state: row.state, version: Number(row.version) } : null;
  }
  async create(runId: string, state: MissionState) {
    const rows = await this.q<{ run_id: string }>(
      `insert into osirus.run_missions (run_id, state)
       values ($1::uuid, $2::jsonb)
       on conflict (run_id) do nothing
       returning run_id`,
      [runId, JSON.stringify(state)],
    );
    return rows.length > 0;
  }
  async save(runId: string, state: MissionState, expected: number) {
    const rows = await this.q<{ run_id: string }>(
      `update osirus.run_missions
          set state = $2::jsonb, version = version + 1, updated_at = now()
        where run_id = $1::uuid and version = $3
        returning run_id`,
      [runId, JSON.stringify(state), expected],
    );
    return rows.length > 0;
  }
}
