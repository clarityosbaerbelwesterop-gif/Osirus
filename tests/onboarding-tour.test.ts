import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createTestDatabase, type TestDatabase } from "./helpers/pglite";

const holder: { db?: TestDatabase } = {};

vi.mock("../src/lib/db/client", () => ({
  queryAs: (userId: string, text: string, params?: unknown[]) =>
    holder.db!.queryAs(userId, text, params),
  querySystem: (text: string, params?: unknown[]) =>
    holder.db!.querySystem(text, params),
  db: () => {
    throw new Error("tests never reach Neon");
  },
}));

const { markTourSeen, tourSeen } = await import(
  "../src/lib/product/onboarding"
);

beforeAll(async () => {
  holder.db = await createTestDatabase();
}, 120_000);

afterAll(async () => {
  await holder.db?.close();
});

describe("introduction tour", () => {
  it("opens once per account: unseen until finished, then stays seen", async () => {
    const tenant = await holder.db!.seedTenant("tour");
    expect(await tourSeen(tenant.userId)).toBe(false);
    await markTourSeen(tenant.userId);
    expect(await tourSeen(tenant.userId)).toBe(true);
    const [first] = await holder.db!.raw<{ onboarded_at: string }>(
      "select onboarded_at from osirus.users where id = $1",
      [tenant.userId],
    );
    // A replay finishing again keeps the first time.
    await markTourSeen(tenant.userId);
    const [second] = await holder.db!.raw<{ onboarded_at: string }>(
      "select onboarded_at from osirus.users where id = $1",
      [tenant.userId],
    );
    expect(String(second.onboarded_at)).toBe(String(first.onboarded_at));
  });

  it("never marks or reads another person's account", async () => {
    const alice = await holder.db!.seedTenant("alice");
    const bob = await holder.db!.seedTenant("bob");
    // Alice's session aiming at Bob's row: RLS hides it, nothing changes.
    await holder.db!.queryAs(
      alice.userId,
      "update osirus.users set onboarded_at = now() where id = $1::uuid",
      [bob.userId],
    );
    expect(await tourSeen(bob.userId)).toBe(false);
    const rows = await holder.db!.queryAs<{ id: string }>(
      alice.userId,
      "select id from osirus.users where id = $1::uuid",
      [bob.userId],
    );
    expect(rows).toEqual([]);
  });
});
