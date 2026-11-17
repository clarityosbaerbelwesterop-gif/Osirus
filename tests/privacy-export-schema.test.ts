import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createTestDatabase, type TestDatabase } from "./helpers/pglite";

// The data export (Art. 15/20) against every migration: each table it names
// exists and is readable as the person, the work of a run is in it, and no
// sealed secret or share token leaves the database.

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
vi.mock("../src/lib/billing/store", () => ({
  currentSubscription: async () => null,
}));

const { exportAccountData } = await import("../src/lib/privacy/account");

let db: TestDatabase;
beforeAll(async () => {
  db = await createTestDatabase();
  holder.db = db;
}, 120_000);
afterAll(async () => {
  await db?.close();
});

describe("data export against the real schema", () => {
  it("reads every table, includes the run's steps and withholds secrets", async () => {
    const person = await db.seedTenant("export");
    const other = await db.seedTenant("other");
    const { runId, stageId } = await db.seedRun(person);
    await db.raw(
      `update osirus.run_stages set output = '{"answer":"Ergebnis A"}' where id = $1`,
      [stageId],
    );
    await db.raw(
      `insert into osirus.run_events (run_id, stage_id, sequence, type, visibility, summary)
       values ($1, $2, 1, 'agent.step', 'user', 'Sichtbarer Schritt'),
              ($1, $2, 2, 'slice.yielded', 'internal', 'Intern')`,
      [runId, stageId],
    );
    // Another tenant's run must never appear.
    const foreign = await db.seedRun(other);
    await db.raw(
      `update osirus.run_stages set output = '{"answer":"Fremd"}' where id = $1`,
      [foreign.stageId],
    );
    await db
      .raw(
        `insert into osirus.webhook_endpoints
         (organization_id, workspace_id, created_by, name, source, secret_sealed, events)
       values ($1, $2, $3, 'Hook', 'github', 'v1:sealed-secret', '{}'::text[])`,
        [person.organizationId, person.workspaceId, person.userId],
      )
      .catch(async () => {
        // Column shapes differ between migrations; insert the minimum.
        await db.raw(
          `insert into osirus.webhook_endpoints
           (organization_id, workspace_id, created_by, name, source, secret_sealed)
         values ($1, $2, $3, 'Hook', 'github', 'v1:sealed-secret')`,
          [person.organizationId, person.workspaceId, person.userId],
        );
      });

    const result = await exportAccountData(person as never);
    expect(result).not.toHaveProperty("notAvailable");
    const text = JSON.stringify(result.data);
    expect(text).toContain("Ergebnis A");
    expect(text).toContain("Sichtbarer Schritt");
    expect(text).not.toContain("Intern");
    expect(text).not.toContain("Fremd");
    expect(text).not.toContain("sealed-secret");
    expect(result.data.webhooks).toHaveLength(1);
    expect(result.data.workspaceMemberships).toHaveLength(1);
  });
});
