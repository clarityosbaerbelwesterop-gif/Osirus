import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createTestDatabase, type TestDatabase } from "./helpers/pglite";

// Storage limitation (Art. 5(1)(e) GDPR) against every migration: what is
// past its period goes, what is inside it stays.

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

const { applyRetention } = await import("../src/lib/privacy/retention");

let db: TestDatabase;
beforeAll(async () => {
  db = await createTestDatabase();
  holder.db = db;
}, 120_000);
afterAll(async () => {
  await db?.close();
});

const cancellation = (
  reference: string,
  receivedAt: string,
  effectiveAt: string | null,
) =>
  db.raw(
    `insert into osirus.contract_cancellations
       (reference, received_at, name, email, contract, kind, timing, effective_at, network_hash)
     values ($1, $2::timestamptz, 'Erika Muster', 'erika@example.test', 'subscription',
             'ordinary', 'earliest', $3::timestamptz, 'abc123')`,
    [reference, receivedAt, effectiveAt],
  );

describe("retention", () => {
  it("deletes what is past its period and keeps what is inside it", async () => {
    await db.raw(
      `insert into osirus.request_rate_limits (subject, route, window_started_at, request_count)
       values ('user:old', 'chat', now() - interval '3 days', 2),
              ('user:new', 'chat', date_trunc('minute', now()), 1)`,
    );
    // Contract ended in 2021: proof kept until the end of 2024, then gone.
    await cancellation("K-OLD", "2021-03-01T10:00:00Z", "2021-04-01T00:00:00Z");
    // Contract ends this year: kept, but its IP hash is gone after 30 days.
    await cancellation(
      "K-NEW",
      new Date(Date.now() - 40 * 86_400_000).toISOString(),
      null,
    );
    await cancellation("K-FRESH", new Date().toISOString(), null);
    // A bot computer's folder goes seven days after its last use.
    const owner = await db.seedTenant("computer");
    const bots = await db.raw<{ id: string }>(
      `insert into osirus.agents (organization_id, workspace_id, name, model_id, created_by)
       values ($1, $2, 'Alt', 'openai/gpt-4o-mini', $3), ($1, $2, 'Neu', 'openai/gpt-4o-mini', $3)
       returning id`,
      [owner.organizationId, owner.workspaceId, owner.userId],
    );
    await db.raw(
      `insert into osirus.bot_computer_files (workspace_id, agent_id, archive, size_bytes, updated_at)
       values ($1, $2, '\\x00'::bytea, 1, now() - interval '8 days'),
              ($1, $3, '\\x00'::bytea, 1, now() - interval '6 days')`,
      [owner.workspaceId, bots[0]!.id, bots[1]!.id],
    );

    const result = await applyRetention();
    expect(result).toEqual({
      rateLimitCounters: 1,
      // K-NEW and K-OLD (whose row then goes as a whole).
      cancellationNetworkHashes: 2,
      botComputerFiles: 1,
      cancellations: 1,
    });

    const counters = await db.raw<{ subject: string }>(
      `select subject from osirus.request_rate_limits`,
    );
    expect(counters.map((row) => row.subject)).toEqual(["user:new"]);
    const kept = await db.raw<{
      reference: string;
      network_hash: string | null;
    }>(
      `select reference, network_hash from osirus.contract_cancellations order by reference`,
    );
    expect(kept).toEqual([
      { reference: "K-FRESH", network_hash: "abc123" },
      { reference: "K-NEW", network_hash: null },
    ]);
    const folders = await db.raw<{ agent_id: string }>(
      `select agent_id from osirus.bot_computer_files`,
    );
    expect(folders).toEqual([{ agent_id: bots[1]!.id }]);
    // A second pass finds nothing left to do.
    expect(await applyRetention()).toEqual({
      rateLimitCounters: 0,
      cancellationNetworkHashes: 0,
      botComputerFiles: 0,
      cancellations: 0,
    });
    // Another person's workspace never sees the folder.
    const stranger = await db.seedTenant("stranger");
    expect(
      await db.queryAs(
        stranger.userId,
        `select 1 from osirus.bot_computer_files`,
      ),
    ).toHaveLength(0);
    expect(
      await db.queryAs(owner.userId, `select 1 from osirus.bot_computer_files`),
    ).toHaveLength(1);
  });

  it("never lets a person delete a cancellation themselves", async () => {
    const person = await db.seedTenant("retention");
    await db.raw(
      `insert into osirus.contract_cancellations
         (reference, name, email, contract, kind, timing, user_id)
       values ('K-MINE', 'P', 'p@example.test', 'free', 'ordinary', 'earliest', $1)`,
      [person.userId],
    );
    const deleted = await db.queryAs(
      person.userId,
      `delete from osirus.contract_cancellations where reference = 'K-MINE' returning 1`,
    );
    expect(deleted).toHaveLength(0);
  });
});
