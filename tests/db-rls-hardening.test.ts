import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createTestDatabase,
  type TestDatabase,
  type TestIdentity,
} from "./helpers/pglite";

// Regression coverage for the database-hardening audit findings:
//   DB-2 (HIGH): prove queryAs/querySystem really assume the non-BYPASSRLS
//     osirus_app role, so the FORCE RLS policies in migration 004 are the
//     thing enforcing tenant isolation rather than being silently skipped.
//   DB-4 (LOW): migration 020 revokes the default PUBLIC EXECUTE on every
//     osirus/osirus_intel function and grants EXECUTE to osirus_app only.

let db: TestDatabase;
let alice: TestIdentity;
let bob: TestIdentity;
let aliceRunId: string;
let bobRunId: string;

beforeAll(async () => {
  db = await createTestDatabase();
  alice = await db.seedTenant("Alice");
  bob = await db.seedTenant("Bob");
  aliceRunId = (await db.seedRun(alice)).runId;
  bobRunId = (await db.seedRun(bob)).runId;
}, 120000);

afterAll(async () => {
  await db.close();
});

describe("DB-2: the osirus_app role assumption is real", () => {
  it("runs every queryAs statement as osirus_app with the tenant GUC set", async () => {
    const [row] = await db.queryAs<{
      cu: string;
      role: string;
      uid: string;
    }>(
      alice.userId,
      `select current_user as cu,
              current_setting('role', true) as role,
              current_setting('app.current_user_id', true) as uid`,
    );
    expect(row!.cu).toBe("osirus_app");
    expect(row!.role).toBe("osirus_app");
    expect(row!.uid).toBe(alice.userId);
  });

  it("provisions osirus_app as NOLOGIN and NOBYPASSRLS in the live schema", async () => {
    const [role] = await db.raw<{
      rolcanlogin: boolean;
      rolbypassrls: boolean;
    }>(
      `select rolcanlogin, rolbypassrls from pg_roles where rolname = 'osirus_app'`,
    );
    expect(role).toEqual({ rolcanlogin: false, rolbypassrls: false });
  });

  it("never returns another tenant's runs through queryAs", async () => {
    const aliceRuns = await db.queryAs<{ id: string; requested_by: string }>(
      alice.userId,
      "select id, requested_by from osirus.runs",
    );
    expect(aliceRuns.map((run) => run.id)).toEqual([aliceRunId]);

    const bobRuns = await db.queryAs<{ id: string; requested_by: string }>(
      bob.userId,
      "select id, requested_by from osirus.runs",
    );
    expect(bobRuns.map((run) => run.id)).toEqual([bobRunId]);

    // A direct probe for the other tenant's row comes back empty, not erroring
    // into a bypass: the policy simply never matches.
    const stolen = await db.queryAs<{ id: string }>(
      alice.userId,
      "select id from osirus.runs where id = $1",
      [bobRunId],
    );
    expect(stolen).toEqual([]);
  });

  it("lets querySystem do cross-tenant work through the policies, as osirus_app", async () => {
    const [who] = await db.querySystem<{ cu: string; role: string }>(
      `select current_user as cu, current_setting('role', true) as role`,
    );
    expect(who!.cu).toBe("osirus_app");
    expect(who!.role).toBe("osirus_app");

    // Cross-tenant reach comes from osirus.is_system() inside the policies,
    // not from bypassing them: osirus_app has no BYPASSRLS to fall back on.
    const visible = await db.querySystem<{ id: string }>(
      "select id from osirus.runs order by id",
    );
    expect(visible.map((run) => run.id).sort()).toEqual(
      [aliceRunId, bobRunId].sort(),
    );
  });

  it("keeps osirus_app membership closed, so SET ROLE cannot be forged", async () => {
    // The honest boundary: PGlite serves a single superuser session
    // (session_user = postgres), and a superuser may SET ROLE to any role
    // regardless of membership, so a live "SET ROLE osirus_app fails for a
    // non-member" attempt cannot error here and would be a fake-green test.
    // What CAN be proven live is that membership is closed: a role created
    // without an explicit grant is not a member, and only the connecting
    // owner ever receives the grant.
    await db.raw(`create role rls_outsider nologin`);
    const [membership] = await db.raw<{ member: boolean }>(
      `select pg_has_role('rls_outsider', 'osirus_app', 'MEMBER') as member`,
    );
    expect(membership!.member).toBe(false);
    await db.raw(`drop role rls_outsider`);

    // In production the membership boundary is set by migration 007: the role
    // is NOLOGIN (nobody authenticates as it) and membership is granted to the
    // connecting owner alone -- never to PUBLIC or a named second role.
    const migrations = join(process.cwd(), "db", "migrations");
    const grants = readdirSync(migrations)
      .filter((name) => name.endsWith(".sql"))
      .flatMap((name) => {
        const sql = readFileSync(join(migrations, name), "utf8");
        return (
          sql
            .split("\n")
            .filter((line) => !line.trim().startsWith("--"))
            .join("\n")
            .match(/GRANT osirus_app TO [^;]+/g) ?? []
        );
      });
    expect(grants).toHaveLength(1);
    expect(grants[0]).toContain("current_user");
  });
});

describe("DB-4: functions no longer rely on PUBLIC EXECUTE", () => {
  it("revokes PUBLIC EXECUTE from every osirus and osirus_intel function", async () => {
    // proacl NULL is the default ACL, which includes EXECUTE for PUBLIC.
    const [defaults] = await db.raw<{ n: number }>(
      `select count(*)::int as n
         from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
        where n.nspname in ('osirus', 'osirus_intel')
          and p.prokind in ('f', 'p', 'w')
          and p.proacl is null`,
    );
    expect(defaults!.n).toBe(0);

    // And no explicit ACL entry hands EXECUTE back to PUBLIC (grantee 0).
    const [publicGrants] = await db.raw<{ n: number }>(
      `select count(*)::int as n
         from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace,
         lateral aclexplode(p.proacl) acl
        where n.nspname in ('osirus', 'osirus_intel')
          and p.prokind in ('f', 'p', 'w')
          and acl.grantee = 0
          and acl.privilege_type = 'EXECUTE'`,
    );
    expect(publicGrants!.n).toBe(0);
  });

  it("grants EXECUTE on every one of those functions to osirus_app", async () => {
    const [missing] = await db.raw<{ n: number }>(
      `select count(*)::int as n
         from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
        where n.nspname in ('osirus', 'osirus_intel')
          and p.prokind in ('f', 'p', 'w')
          and not has_function_privilege('osirus_app', p.oid, 'EXECUTE')`,
    );
    expect(missing!.n).toBe(0);

    // Sanity: the sweep covered real functions, not an empty set.
    const [total] = await db.raw<{ n: number }>(
      `select count(*)::int as n
         from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
        where n.nspname in ('osirus', 'osirus_intel')
          and p.prokind in ('f', 'p', 'w')`,
    );
    expect(total!.n).toBeGreaterThan(10);
  });

  it("still lets osirus_app execute the helpers and workers it calls", async () => {
    // Policy helper, invoked by statements already running as osirus_app.
    const [sys] = await db.queryAs<{ s: boolean }>(
      alice.userId,
      "select osirus.is_system() as s",
    );
    expect(sys!.s).toBe(false);
    const [sysTrue] = await db.querySystem<{ s: boolean }>(
      "select osirus.is_system() as s",
    );
    expect(sysTrue!.s).toBe(true);

    // Worker entry point used through querySystem by the runtime.
    const claimed = await db.querySystem<{ id: string }>(
      "select id from osirus.claim_next_stage('rls-hardening-test')",
    );
    expect(claimed.length).toBeGreaterThanOrEqual(0);

    // SECURITY DEFINER helper behind the run policies.
    const [canAccess] = await db.queryAs<{ ok: boolean }>(
      alice.userId,
      "select osirus.can_access_run($1) as ok",
      [aliceRunId],
    );
    expect(canAccess!.ok).toBe(true);
  });

  it("does not revoke the owner's own rights, so migrations keep working", async () => {
    // raw runs as the migration-owning superuser; owners never needed a grant.
    const [row] = await db.raw<{ ok: boolean }>(
      "select osirus.is_system() is not null as ok",
    );
    expect(row!.ok).toBe(true);
  });
});
