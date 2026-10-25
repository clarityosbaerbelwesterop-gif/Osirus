import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  createTestDatabase,
  type TestDatabase,
  type TestIdentity,
} from "./helpers/pglite";

// The scheduler's recovery pass closes runs no request or poll will touch
// again (an automation, a closed tab). A run whose stage failed is one of
// them: nothing claims a failed stage, so only recovery can settle it.

const holder = vi.hoisted(() => ({ db: null as TestDatabase | null }));

vi.mock("../src/lib/db/client", () => ({
  queryAs: (userId: string, text: string, params?: unknown[]) =>
    holder.db!.queryAs(userId, text, params),
  querySystem: (text: string, params?: unknown[]) =>
    holder.db!.querySystem(text, params),
  db: () => {
    throw new Error("tests never reach Neon");
  },
}));

const { recoverStuckRuns } = await import("../src/lib/runtime/recovery");
const { claimNextStage } = await import("../src/lib/runtime/dispatch");

let db: TestDatabase;
let tenant: TestIdentity;

beforeAll(async () => {
  db = await createTestDatabase();
  holder.db = db;
}, 120_000);

afterAll(async () => {
  await db?.close();
});

beforeEach(async () => {
  tenant = await db.seedTenant("recovery");
});

async function runStatus(runId: string) {
  const [row] = await db.raw<{ status: string; error_code: string | null }>(
    "select status, error_code from osirus.runs where id = $1",
    [runId],
  );
  return row;
}

async function makeStale(runId: string) {
  await db.raw("alter table osirus.runs disable trigger runs_touch_updated_at");
  await db.raw(
    "update osirus.runs set updated_at = now() - interval '1 hour' where id = $1",
    [runId],
  );
  await db.raw("alter table osirus.runs enable trigger runs_touch_updated_at");
}

describe("recoverStuckRuns", () => {
  it("fails a stale run whose stage the scheduler claim exhausted", async () => {
    const { runId, stageId } = await db.seedRun(tenant);
    await db.raw(
      `update osirus.run_stages
          set status = 'blocked', attempt_count = 1,
              runnable_after = now() - interval '1 second'
        where id = $1`,
      [stageId],
    );
    await db.raw(
      `insert into osirus.run_attempts
         (run_id, stage_id, attempt_number, worker_kind, status, started_at)
       values ($1, $2, 1, 'agent', 'failed', now() - interval '2 minutes')`,
      [runId, stageId],
    );
    // The scheduler claims across runs: the claim fails the exhausted stage
    // and returns nothing, so the tick never finalizes this run itself.
    expect(await claimNextStage({ workerId: "scheduler:test" })).toBeNull();
    await makeStale(runId);

    const recovered = await recoverStuckRuns(50);

    expect(recovered).toContainEqual({ runId, action: "finalized_failed" });
    expect(await runStatus(runId)).toMatchObject({
      status: "failed",
      error_code: "stage_failed",
    });
  });

  it("leaves a stale run alone while it still has unsettled work", async () => {
    const { runId, stageId } = await db.seedRun(tenant);
    await db.raw(
      "update osirus.run_stages set status = 'blocked' where id = $1",
      [stageId],
    );
    await makeStale(runId);

    const recovered = await recoverStuckRuns(50);

    expect(recovered.map((entry) => entry.runId)).not.toContain(runId);
    expect((await runStatus(runId))?.status).toBe("running");
  });
});
