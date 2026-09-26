import { createHash, randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";

// A real Postgres (PGlite, in-process WASM) with every migration in
// db/migrations applied, row-level security forced and the osirus_app role
// assumed per statement -- the same two-statement transaction
// src/lib/db/client.ts sends to Neon. Tests that mock "../src/lib/db/client"
// with this run the product SQL unchanged, including tenant isolation.
//
// Applying all migrations takes ~12 s, so the resulting data directory is
// cached under node_modules/.cache keyed by the migration contents.

const MIGRATIONS = join(process.cwd(), "db", "migrations");

export type TestIdentity = {
  userId: string;
  organizationId: string;
  workspaceId: string;
  workspaceName: string;
};

export type TestDatabase = {
  pg: PGlite;
  queryAs: <T>(
    userId: string,
    text: string,
    params?: unknown[],
  ) => Promise<T[]>;
  querySystem: <T>(text: string, params?: unknown[]) => Promise<T[]>;
  /** Superuser access, bypassing RLS: for seeding and for assertions. */
  raw: <T>(text: string, params?: unknown[]) => Promise<T[]>;
  seedTenant: (label: string) => Promise<TestIdentity>;
  seedRun: (
    identity: TestIdentity,
  ) => Promise<{ runId: string; stageId: string }>;
  close: () => Promise<void>;
};

function migrationFiles() {
  return readdirSync(MIGRATIONS)
    .filter((name) => name.endsWith(".sql"))
    .sort();
}

async function freshDataDir(): Promise<Blob> {
  const files = migrationFiles();
  const hash = createHash("sha256");
  for (const file of files)
    hash.update(file).update(readFileSync(join(MIGRATIONS, file)));
  const cacheDir = join(
    process.cwd(),
    "node_modules",
    ".cache",
    "osirus-pglite",
  );
  const cacheFile = join(cacheDir, `${hash.digest("hex").slice(0, 16)}.tar.gz`);
  if (existsSync(cacheFile)) return new Blob([readFileSync(cacheFile)]);
  const pg = new PGlite({ extensions: { pgcrypto } });
  // Neon Auth owns this schema in production; osirus.users references it.
  await pg.exec(
    `create schema neon_auth;
     create table neon_auth."user" (id uuid primary key, email text, name text);`,
  );
  for (const file of files)
    await pg.exec(readFileSync(join(MIGRATIONS, file), "utf8"));
  const dump = await pg.dumpDataDir("gzip");
  await pg.close();
  mkdirSync(cacheDir, { recursive: true });
  // Written aside and renamed, so a parallel test file never reads half.
  const partial = `${cacheFile}.${process.pid}.tmp`;
  writeFileSync(partial, Buffer.from(await dump.arrayBuffer()));
  renameSync(partial, cacheFile);
  return dump;
}

export async function createTestDatabase(): Promise<TestDatabase> {
  const pg = new PGlite({
    loadDataDir: await freshDataDir(),
    extensions: { pgcrypto },
  });
  const raw = async <T>(text: string, params: unknown[] = []) =>
    (await pg.query<T>(text, params)).rows;
  const queryAs = <T>(userId: string, text: string, params: unknown[] = []) =>
    pg.transaction(async (tx) => {
      await tx.query(
        "select set_config('app.current_user_id', $1, true), set_config('role', 'osirus_app', true)",
        [userId],
      );
      return (await tx.query<T>(text, params)).rows;
    });
  const querySystem = <T>(text: string, params: unknown[] = []) =>
    pg.transaction(async (tx) => {
      await tx.query(
        "select set_config('app.osirus_system', 'true', true), set_config('role', 'osirus_app', true)",
      );
      return (await tx.query<T>(text, params)).rows;
    });
  const seedTenant = async (label: string): Promise<TestIdentity> => {
    const userId = randomUUID();
    const organizationId = randomUUID();
    const workspaceId = randomUUID();
    const slug = `${label}-${userId.slice(0, 8)}`.toLowerCase();
    await raw(
      `insert into neon_auth."user" (id, email, name) values ($1, $2, $3)`,
      [userId, `${slug}@example.test`, label],
    );
    await raw(`insert into osirus.users (id) values ($1)`, [userId]);
    await raw(
      `insert into osirus.organizations (id, name, slug, created_by) values ($1, $2, $3, $4)`,
      [organizationId, label, slug, userId],
    );
    await raw(
      `insert into osirus.organization_memberships (organization_id, user_id, role) values ($1, $2, 'owner')`,
      [organizationId, userId],
    );
    await raw(
      `insert into osirus.workspaces (id, organization_id, name, slug, created_by) values ($1, $2, $3, $4, $5)`,
      [workspaceId, organizationId, label, slug, userId],
    );
    await raw(
      `insert into osirus.workspace_memberships (workspace_id, organization_id, user_id, role) values ($1, $2, $3, 'owner')`,
      [workspaceId, organizationId, userId],
    );
    return { userId, organizationId, workspaceId, workspaceName: label };
  };
  const seedRun = async (identity: TestIdentity) => {
    const [session] = await raw<{ id: string }>(
      `insert into osirus.sessions (organization_id, workspace_id, title, created_by)
       values ($1, $2, 'MCP certification', $3) returning id`,
      [identity.organizationId, identity.workspaceId, identity.userId],
    );
    const [run] = await raw<{ id: string }>(
      `insert into osirus.runs (organization_id, workspace_id, session_id, requested_by,
         objective, primary_capability, complexity, status)
       values ($1, $2, $3, $4, 'certify MCP', 'general', 'low', 'running') returning id`,
      [
        identity.organizationId,
        identity.workspaceId,
        session!.id,
        identity.userId,
      ],
    );
    const [stage] = await raw<{ id: string }>(
      `insert into osirus.run_stages (run_id, ordinal, name, capability, status)
       values ($1, 0, 'agent', 'general', 'running') returning id`,
      [run!.id],
    );
    return { runId: run!.id, stageId: stage!.id };
  };
  return {
    pg,
    queryAs,
    querySystem,
    raw,
    seedTenant,
    seedRun,
    close: () => pg.close(),
  };
}
