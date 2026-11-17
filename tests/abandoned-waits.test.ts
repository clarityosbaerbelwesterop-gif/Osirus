import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  createTestDatabase,
  type TestDatabase,
  type TestIdentity,
} from "./helpers/pglite";

// Live 2026-11-16: three runs waited "for approval" for days on a request
// that had expired after its hour, two of them since 2026-10-04. Nothing
// ever closed them, and Code opened on one of them as if it were current.

const holder = vi.hoisted(() => ({ db: null as TestDatabase | null }));

vi.mock("server-only", () => ({}));
vi.mock("../src/lib/db/client", () => ({
  queryAs: (userId: string, text: string, params?: unknown[]) =>
    holder.db!.queryAs(userId, text, params),
  querySystem: (text: string, params?: unknown[]) =>
    holder.db!.querySystem(text, params),
  db: () => {
    throw new Error("tests never reach Neon");
  },
}));

const { closeAbandonedWaits } = await import("../src/lib/runtime/recovery");
const { RuntimeRepository } = await import("../src/lib/runtime/repository");

let db: TestDatabase;
let tenant: TestIdentity;
beforeAll(async () => {
  db = await createTestDatabase();
  holder.db = db;
  tenant = await db.seedTenant("abandoned");
}, 120_000);
afterAll(async () => {
  await db?.close();
});

/** A run parked on an approval, last touched `idleHours` ago. */
async function parked(input: {
  idleHours: number;
  approvalExpiredHoursAgo: number | null;
  waitingOn?: "approval" | "human";
  pausedDaysAgo?: number;
}) {
  const { runId, stageId } = await db.seedRun(tenant);
  await db.raw(
    `update osirus.run_stages
        set status = 'waiting', output = jsonb_build_object('waitingOn', $2::text)
      where id = $1`,
    [stageId, input.waitingOn ?? "approval"],
  );
  if (input.approvalExpiredHoursAgo !== null)
    await db.raw(
      `insert into osirus.approvals
         (organization_id, workspace_id, run_id, stage_id,
          action, risk, status, request, expires_at)
       values ($1, $2, $3, $4, 'tool:demo', 'high', 'requested', '{}'::jsonb,
               now() - make_interval(hours => $5))`,
      [
        tenant.organizationId,
        tenant.workspaceId,
        runId,
        stageId,
        input.approvalExpiredHoursAgo,
      ],
    );
  await db.raw(`alter table osirus.runs disable trigger user`);
  await db.raw(
    `update osirus.runs
        set status = $2,
            updated_at = now() - make_interval(hours => $3),
            paused_at = case when $4::int is null then null
                             else now() - make_interval(days => $4::int) end
      where id = $1`,
    [
      runId,
      input.pausedDaysAgo ? "running" : "waiting_for_approval",
      input.idleHours,
      input.pausedDaysAgo ?? null,
    ],
  );
  await db.raw(`alter table osirus.runs enable trigger user`);
  return runId;
}

const statusOf = async (runId: string) =>
  (
    await db.raw<{ status: string }>(
      `select status from osirus.runs where id = $1`,
      [runId],
    )
  )[0]!.status;

describe("runs that wait on a person who will not come", () => {
  it("closes a run whose approval expired a day ago, with the reason", async () => {
    const runId = await parked({ idleHours: 48, approvalExpiredHoursAgo: 47 });
    const closed = await closeAbandonedWaits(50);
    expect(closed).toContainEqual({ runId, reason: "approval" });
    expect(await statusOf(runId)).toBe("cancelled");
    const [approval] = await db.raw<{ status: string }>(
      `select status from osirus.approvals where run_id = $1`,
      [runId],
    );
    expect(approval!.status).toBe("expired");
    const events = await db.raw<{ summary: string }>(
      `select summary from osirus.run_events
        where run_id = $1 and type = 'run.abandoned'`,
      [runId],
    );
    expect(events[0]!.summary).toMatch(/Freigabe ist abgelaufen/);
    const stages = await db.raw<{ status: string }>(
      `select status from osirus.run_stages where run_id = $1`,
      [runId],
    );
    expect(stages.every((stage) => stage.status === "cancelled")).toBe(true);
  });

  it("leaves a fresh wait, a decidable approval and an open question alone", async () => {
    const fresh = await parked({ idleHours: 2, approvalExpiredHoursAgo: 1 });
    const decidable = await parked({
      idleHours: 48,
      approvalExpiredHoursAgo: -1,
    });
    const question = await parked({
      idleHours: 48,
      approvalExpiredHoursAgo: 47,
      waitingOn: "human",
    });
    const closed = (await closeAbandonedWaits(50)).map((row) => row.runId);
    expect(closed).not.toContain(fresh);
    expect(closed).not.toContain(decidable);
    expect(closed).not.toContain(question);
    expect(await statusOf(fresh)).toBe("waiting_for_approval");
  });

  it("closes a run paused for more than a week, not one paused yesterday", async () => {
    const old = await parked({
      idleHours: 200,
      approvalExpiredHoursAgo: null,
      pausedDaysAgo: 8,
    });
    const recent = await parked({
      idleHours: 30,
      approvalExpiredHoursAgo: null,
      pausedDaysAgo: 1,
    });
    const closed = await closeAbandonedWaits(50);
    expect(closed).toContainEqual({ runId: old, reason: "pause" });
    expect(closed.map((row) => row.runId)).not.toContain(recent);
    expect(await statusOf(recent)).toBe("running");
  });
});

describe("Code opens on a task only while it works", () => {
  it("marks a run live only when it is working right now", async () => {
    const repository = new RuntimeRepository(tenant.userId);
    const live = async () =>
      (await repository.getRecentWorkspaceState(tenant.workspaceId))
        .activeRunLive;
    const { runId } = await db.seedRun(tenant);
    expect(await live()).toBe(true);
    await db.raw(
      `update osirus.runs set status = 'waiting_for_approval' where id = $1`,
      [runId],
    );
    expect(await live()).toBe(false);
    await db.raw(
      `update osirus.runs set status = 'running', paused_at = now() where id = $1`,
      [runId],
    );
    expect(await live()).toBe(false);
  });
});
