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

// A run must always end by itself: completed, failed with a reason, or
// cancelled. These are the states production runs were found stuck in
// (2026-09-27), replayed against a real Postgres with every migration and
// row-level security applied.

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

const { RuntimeRepository } = await import("../src/lib/runtime/repository");
const { claimNextStage, nextRetryInMs } =
  await import("../src/lib/runtime/dispatch");
const { finalizeRun } = await import("../src/lib/runtime/worker");
const { pollNudge, hasLiveAttempt } =
  await import("../src/lib/runtime/poll-nudge");
const { settlementFor } = await import("../src/lib/runtime/settlement");

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
  tenant = await db.seedTenant("liveness");
});

const identity = () => ({
  userId: tenant.userId,
  organizationId: tenant.organizationId,
  workspaceId: tenant.workspaceId,
});

async function attempt(input: {
  runId: string;
  stageId: string;
  status: string;
  leaseSeconds: number | null;
}) {
  await db.raw(
    `insert into osirus.run_attempts
       (run_id, stage_id, attempt_number, worker_kind, status,
        lease_owner, lease_expires_at, started_at)
     values ($1, $2, 1, 'agent', $3, 'request:gone',
       case when $4::int is null then null
            else now() + make_interval(secs => $4::int) end,
       now() - interval '2 minutes')`,
    [input.runId, input.stageId, input.status, input.leaseSeconds],
  );
  await db.raw(
    `update osirus.run_stages set attempt_count = attempt_count + 1 where id = $1`,
    [input.stageId],
  );
}

async function runStatus(runId: string) {
  const [row] = await db.raw<{ status: string }>(
    "select status from osirus.runs where id = $1",
    [runId],
  );
  return row?.status;
}

describe("a retryable failure on the last allowed attempt", () => {
  it("settles the stage as failed instead of parking it as blocked", () => {
    const outcome = {
      kind: "FAILED" as const,
      failureClass: "invalid_model_output",
      error: "userFlows[0]: expected object",
      retryable: true,
    };
    expect(settlementFor(outcome, Date.now(), false).stageStatus).toBe(
      "failed",
    );
    expect(settlementFor(outcome, Date.now(), true).stageStatus).toBe(
      "blocked",
    );
  });
});

describe("a dead stage finalizes its run", () => {
  it("fails the run when the claim exhausts the last stage's attempts", async () => {
    // Run 4377a38d: the design stage failed once (maxAttempts 1) and was
    // parked as blocked; the next claim failed it and claimed nothing, and
    // the run stayed `running`.
    const { runId, stageId } = await db.seedRun(tenant);
    await db.raw(
      `update osirus.run_stages set status = 'blocked', runnable_after = now() - interval '1 second' where id = $1`,
      [stageId],
    );
    await attempt({ runId, stageId, status: "failed", leaseSeconds: null });

    const repository = new RuntimeRepository(tenant.userId);
    const nudge = pollNudge(await repository.getSnapshot(runId));
    expect(nudge).toMatchObject({ drive: true, finalize: true });

    expect(await claimNextStage({ workerId: "poll:test", runId })).toBeNull();
    const [stage] = await db.raw<{ status: string }>(
      "select status from osirus.run_stages where id = $1",
      [stageId],
    );
    expect(stage?.status).toBe("failed");

    const completion = await finalizeRun({ identity: identity(), runId });
    expect(completion.status).toBe("failed");
    expect(await runStatus(runId)).toBe("failed");
  });

  it("still finalizes when every stage is settled and nothing is left to drive", async () => {
    const { runId, stageId } = await db.seedRun(tenant);
    await db.raw(
      `update osirus.run_stages set status = 'failed', completed_at = now() where id = $1`,
      [stageId],
    );
    const repository = new RuntimeRepository(tenant.userId);
    expect(pollNudge(await repository.getSnapshot(runId))).toEqual({
      settleCancel: false,
      drive: false,
      finalize: true,
    });
  });

  it("waits for a parked retry instead of starting a worker every poll", async () => {
    const { runId, stageId } = await db.seedRun(tenant);
    await db.raw(
      `update osirus.run_stages set status = 'blocked', runnable_after = now() + interval '20 seconds' where id = $1`,
      [stageId],
    );
    const repository = new RuntimeRepository(tenant.userId);
    expect(pollNudge(await repository.getSnapshot(runId))).toEqual({
      settleCancel: false,
      drive: false,
      finalize: true,
    });
    // The worker that parked it can see how long to wait.
    const wait = await nextRetryInMs(runId);
    expect(wait).toBeGreaterThan(15_000);
    expect(wait).toBeLessThanOrEqual(20_000);
    await db.raw(
      `update osirus.run_stages set runnable_after = now() + interval '1 second' where id = $1`,
      [stageId],
    );
    expect(pollNudge(await repository.getSnapshot(runId)).drive).toBe(true);
    // A cancelled run has nothing to wait for.
    await repository.requestCancellation(runId);
    expect(await nextRetryInMs(runId)).toBeNull();
  });

  it("drives a stage whose worker died with its lease", async () => {
    const { runId, stageId } = await db.seedRun(tenant);
    await attempt({ runId, stageId, status: "running", leaseSeconds: -30 });
    const repository = new RuntimeRepository(tenant.userId);
    expect(pollNudge(await repository.getSnapshot(runId))).toMatchObject({
      drive: true,
      finalize: true,
    });
  });

  it("leaves a stage alone while its worker holds a live lease", async () => {
    const { runId, stageId } = await db.seedRun(tenant);
    await attempt({ runId, stageId, status: "running", leaseSeconds: 60 });
    const repository = new RuntimeRepository(tenant.userId);
    expect(pollNudge(await repository.getSnapshot(runId))).toEqual({
      settleCancel: false,
      drive: false,
      finalize: false,
    });
  });
});

describe("cancel without a worker", () => {
  it("cancels the run, its open stages and its dead attempts", async () => {
    // Run 3231d1fc: `cancelling` for hours, because only a live worker
    // acknowledged a cancel and none was left.
    const { runId, stageId } = await db.seedRun(tenant);
    await attempt({ runId, stageId, status: "running", leaseSeconds: -30 });
    const repository = new RuntimeRepository(tenant.userId);
    await repository.requestCancellation(runId);
    expect(await runStatus(runId)).toBe("cancelling");

    expect(pollNudge(await repository.getSnapshot(runId)).settleCancel).toBe(
      true,
    );
    expect(await repository.settleCancellationWithoutWorker(runId)).toBe(true);
    expect(await runStatus(runId)).toBe("cancelled");
    const stages = await db.raw<{ status: string }>(
      "select status from osirus.run_stages where run_id = $1",
      [runId],
    );
    expect(stages.map((s) => s.status)).toEqual(["cancelled"]);
    const attempts = await db.raw<{ status: string }>(
      "select status from osirus.run_attempts where run_id = $1",
      [runId],
    );
    expect(attempts.map((a) => a.status)).toEqual(["cancelled"]);
    // Idempotent: a second call changes nothing and says so.
    expect(await repository.settleCancellationWithoutWorker(runId)).toBe(false);
  });

  it("waits for a worker that still holds a live lease", async () => {
    const { runId, stageId } = await db.seedRun(tenant);
    await attempt({ runId, stageId, status: "running", leaseSeconds: 60 });
    const repository = new RuntimeRepository(tenant.userId);
    await repository.requestCancellation(runId);
    expect(pollNudge(await repository.getSnapshot(runId)).settleCancel).toBe(
      false,
    );
    expect(await repository.settleCancellationWithoutWorker(runId)).toBe(false);
    expect(await runStatus(runId)).toBe("cancelling");
  });

  it("never cancels a run that was not asked to cancel", async () => {
    const { runId } = await db.seedRun(tenant);
    const repository = new RuntimeRepository(tenant.userId);
    expect(await repository.settleCancellationWithoutWorker(runId)).toBe(false);
    expect(await runStatus(runId)).toBe("running");
  });

  it("cannot cancel another tenant's run", async () => {
    const { runId } = await db.seedRun(tenant);
    await new RuntimeRepository(tenant.userId).requestCancellation(runId);
    const stranger = await db.seedTenant("stranger");
    expect(
      await new RuntimeRepository(
        stranger.userId,
      ).settleCancellationWithoutWorker(runId),
    ).toBe(false);
    expect(await runStatus(runId)).toBe("cancelling");
  });
});

describe("attempt liveness", () => {
  const now = Date.parse("2026-09-27T12:00:00Z");
  it("reads lease times the database returns as Date or string", () => {
    expect(
      hasLiveAttempt(
        [
          {
            status: "running",
            lease_expires_at: new Date(now + 1_000),
          },
        ],
        now,
      ),
    ).toBe(true);
    expect(
      hasLiveAttempt(
        [
          {
            status: "claimed",
            lease_expires_at: new Date(now - 1_000).toISOString(),
          },
        ],
        now,
      ),
    ).toBe(false);
    expect(
      hasLiveAttempt(
        [{ status: "completed", lease_expires_at: new Date(now + 1_000) }],
        now,
      ),
    ).toBe(false);
  });
});

describe("assistant answers", () => {
  it("stores an answer a run already gave only once", async () => {
    const { runId } = await db.seedRun(tenant);
    const [run] = await db.raw<{ session_id: string }>(
      "select session_id from osirus.runs where id = $1",
      [runId],
    );
    const repository = new RuntimeRepository(tenant.userId);
    const message = {
      organizationId: tenant.organizationId,
      workspaceId: tenant.workspaceId,
      sessionId: run!.session_id,
      runId,
      role: "assistant" as const,
      content: "Hallo! Wie kann ich helfen?",
    };
    const first = await repository.createMessage(message);
    const second = await repository.createMessage(message);
    expect(second).toBe(first);
    await repository.createMessage({ ...message, content: "Something else" });
    // The user may say the same thing twice; only answers are deduplicated.
    await repository.createMessage({ ...message, role: "user" });
    await repository.createMessage({ ...message, role: "user" });
    const rows = await db.raw<{ role: string }>(
      "select role from osirus.messages where run_id = $1 order by created_at",
      [runId],
    );
    expect(rows.filter((row) => row.role === "assistant")).toHaveLength(2);
    expect(rows.filter((row) => row.role === "user")).toHaveLength(2);
  });
});

describe("a paused coding run", () => {
  it("is not claimed, and resume claims the same run", async () => {
    const { runId, stageId } = await db.seedRun(tenant);
    await db.raw(
      `update osirus.runs set status = 'running', paused_at = now(),
         input = '{"surface":"coding"}'::jsonb
       where id = $1`,
      [runId],
    );
    await db.raw(
      `update osirus.run_stages set status = 'pending' where id = $1`,
      [stageId],
    );
    const repository = new RuntimeRepository(tenant.userId);
    const paused = await repository.getSnapshot(runId);
    expect(pollNudge(paused)).toMatchObject({ drive: false, finalize: false });
    expect(await claimNextStage({ workerId: "poll:pause", runId })).toBeNull();

    const resumed = await repository.setCodingPaused(runId, false);
    expect(resumed?.id).toBe(runId);
    expect(resumed?.paused_at).toBeNull();
    const claimed = await claimNextStage({ workerId: "poll:resume", runId });
    expect(claimed?.runId).toBe(runId);
  });
});
