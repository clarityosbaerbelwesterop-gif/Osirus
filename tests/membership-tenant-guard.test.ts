import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createTestDatabase,
  type TestDatabase,
  type TestIdentity,
} from "./helpers/pglite";

// Audit 2026-11-17: a membership row's workspace was not tied to its
// organization, so managing one's own organization was enough to insert a
// membership into another tenant's workspace. Checked against every
// migration with row-level security on (PGlite, role osirus_app).

let db: TestDatabase;
let alice: TestIdentity;
let bob: TestIdentity;

beforeAll(async () => {
  db = await createTestDatabase();
  alice = await db.seedTenant("alice");
  bob = await db.seedTenant("bob");
}, 120_000);
afterAll(async () => {
  await db?.close();
});

const insertMembership = (
  actor: TestIdentity,
  row: { workspaceId: string; organizationId: string; userId: string },
  role = "owner",
) =>
  db.queryAs(
    actor.userId,
    `insert into osirus.workspace_memberships
       (workspace_id, organization_id, user_id, role)
     values ($1::uuid, $2::uuid, $3::uuid, $4)`,
    [row.workspaceId, row.organizationId, row.userId, role],
  );

describe("workspace memberships stay inside their organization", () => {
  it("refuses joining another tenant's workspace through one's own organization", async () => {
    await expect(
      insertMembership(alice, {
        workspaceId: bob.workspaceId,
        organizationId: alice.organizationId,
        userId: alice.userId,
      }),
    ).rejects.toThrow(/row-level security/);
    const rows = await db.raw(
      `select 1 from osirus.workspace_memberships
        where workspace_id = $1 and user_id = $2`,
      [bob.workspaceId, alice.userId],
    );
    expect(rows).toHaveLength(0);
  });

  it("still lets an owner add a member to their own workspace", async () => {
    await insertMembership(
      alice,
      {
        workspaceId: alice.workspaceId,
        organizationId: alice.organizationId,
        userId: bob.userId,
      },
      "editor",
    );
    const rows = await db.raw<{ role: string }>(
      `select role from osirus.workspace_memberships
        where workspace_id = $1 and user_id = $2`,
      [alice.workspaceId, bob.userId],
    );
    expect(rows[0]?.role).toBe("editor");
  });

  it("does not let an editor make themselves owner", async () => {
    const changed = await db.queryAs(
      bob.userId,
      `update osirus.workspace_memberships set role = 'owner'
        where workspace_id = $1::uuid and user_id = $2::uuid
        returning 1`,
      [alice.workspaceId, bob.userId],
    );
    expect(changed).toHaveLength(0);
    const rows = await db.raw<{ role: string }>(
      `select role from osirus.workspace_memberships
        where workspace_id = $1 and user_id = $2`,
      [alice.workspaceId, bob.userId],
    );
    expect(rows[0]?.role).toBe("editor");
  });

  it("does not let a membership move into another organization", async () => {
    // Alice's own row: she owns the workspace, but Bob's organization is
    // not where her workspace lives.
    await expect(
      db.queryAs(
        alice.userId,
        `update osirus.workspace_memberships
            set organization_id = $3::uuid
          where workspace_id = $1::uuid and user_id = $2::uuid`,
        [alice.workspaceId, alice.userId, bob.organizationId],
      ),
    ).rejects.toThrow(/row-level security/);
    const rows = await db.raw<{ organization_id: string }>(
      `select organization_id from osirus.workspace_memberships
        where workspace_id = $1 and user_id = $2`,
      [alice.workspaceId, alice.userId],
    );
    expect(rows[0]?.organization_id).toBe(alice.organizationId);
  });
});
