import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createTestDatabase, type TestDatabase } from "./helpers/pglite";

// A bot computer's kept folder against the real migrations: RLS per
// workspace, the per-bot and per-workspace size limits, and a bot id from
// another workspace.

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

const {
  databaseComputerFiles,
  COMPUTER_FILES_MAX_BYTES,
  COMPUTER_FILES_WORKSPACE_MAX_BYTES,
} = await import("../src/lib/agents/bot-computer-files");

let db: TestDatabase;
beforeAll(async () => {
  db = await createTestDatabase();
  holder.db = db;
}, 120_000);
afterAll(async () => {
  await db?.close();
});

type Tenant = Awaited<ReturnType<TestDatabase["seedTenant"]>>;

const identity = (tenant: Tenant) =>
  ({
    userId: tenant.userId,
    organizationId: tenant.organizationId,
    workspaceId: tenant.workspaceId,
  }) as unknown as Parameters<typeof databaseComputerFiles>[0];

async function bot(tenant: Tenant, name: string) {
  const rows = await db.raw<{ id: string }>(
    `insert into osirus.agents (organization_id, workspace_id, name, model_id, created_by)
     values ($1, $2, $3, 'openai/gpt-4o-mini', $4) returning id`,
    [tenant.organizationId, tenant.workspaceId, name, tenant.userId],
  );
  return rows[0]!.id;
}

/** Base64 for a packed folder of about `bytes` bytes. */
const packed = (bytes: number) => Buffer.alloc(bytes, 7).toString("base64");

describe("a bot computer's kept folder", () => {
  it("keeps a folder for its own workspace only", async () => {
    const owner = await db.seedTenant("files-owner");
    const stranger = await db.seedTenant("files-stranger");
    const botId = await bot(owner, "Rechner");
    const files = databaseComputerFiles(identity(owner), botId);

    expect(await files.load()).toBeNull();
    expect(await files.save(packed(1_000))).toBe(true);
    expect(await files.load()).toBe(packed(1_000));
    expect(await files.save(packed(2_000))).toBe(true);
    expect(await files.load()).toBe(packed(2_000));

    // Another workspace sees nothing, and its save under this bot's id is
    // refused instead of taking the bot's row.
    const foreign = databaseComputerFiles(identity(stranger), botId);
    expect(await foreign.load()).toBeNull();
    expect(await foreign.save(packed(10))).toBe(false);
    expect(await files.load()).toBe(packed(2_000));
  });

  it("refuses a folder over the per-bot limit", async () => {
    const owner = await db.seedTenant("files-big");
    const files = databaseComputerFiles(
      identity(owner),
      await bot(owner, "Groß"),
    );
    expect(await files.save(packed(COMPUTER_FILES_MAX_BYTES + 3))).toBe(false);
    expect(await files.load()).toBeNull();
  });

  it("stops one workspace from filling the shared database", async () => {
    const owner = await db.seedTenant("files-many");
    const third = Math.floor(COMPUTER_FILES_WORKSPACE_MAX_BYTES / 3) - 3;
    const saved: boolean[] = [];
    for (const name of ["Eins", "Zwei", "Drei", "Vier"])
      saved.push(
        await databaseComputerFiles(
          identity(owner),
          await bot(owner, name),
        ).save(packed(third)),
      );
    expect(saved).toEqual([true, true, true, false]);
    // A bot that already has a folder may replace it within the limit.
    const first = await db.raw<{ agent_id: string }>(
      `select agent_id from osirus.bot_computer_files
        where workspace_id = $1 order by updated_at limit 1`,
      [owner.workspaceId],
    );
    expect(
      await databaseComputerFiles(identity(owner), first[0]!.agent_id).save(
        packed(third - 100),
      ),
    ).toBe(true);
  }, 60_000);
});
