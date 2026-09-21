// Apply db/migrations/*.sql in order against DATABASE_URL.
//
// The repository has always carried ordered migrations but nothing that applies
// them, which is why a reachable database can still be missing the entire
// osirus schema. This runner closes that gap.
//
// Applied migrations are recorded in osirus.schema_migrations with a checksum so
// reruns are no-ops and an edited-after-apply file is reported rather than
// silently skipped. Nothing here prints SQL, connection strings or credentials.

import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { neon } from "@neondatabase/serverless";
import { splitSqlStatements } from "./lib/sql-statements.mjs";

const MIGRATIONS_DIR = "db/migrations";
const dryRun = process.argv.includes("--dry-run");

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) {
  throw new Error("DATABASE_URL must be set to apply migrations");
}

const sql = neon(databaseUrl);

function checksum(contents) {
  return createHash("sha256").update(contents).digest("hex");
}

function loadMigrations() {
  return readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .map((name) => {
      const contents = readFileSync(join(MIGRATIONS_DIR, name), "utf8");
      return {
        name,
        contents,
        checksum: checksum(contents),
        statements: splitSqlStatements(contents),
      };
    });
}

async function ensureLedger() {
  await sql.query("CREATE SCHEMA IF NOT EXISTS osirus");
  await sql.query(`CREATE TABLE IF NOT EXISTS osirus.schema_migrations (
    filename text PRIMARY KEY,
    checksum text NOT NULL,
    statement_count integer NOT NULL,
    applied_at timestamp with time zone NOT NULL DEFAULT now()
  )`);
  // Every table in the osirus schema carries FORCE RLS; the ledger is no
  // exception. It is deployment metadata, so only a system caller may read it.
  await sql.query(
    "ALTER TABLE osirus.schema_migrations ENABLE ROW LEVEL SECURITY",
  );
  await sql.query(
    "ALTER TABLE osirus.schema_migrations FORCE ROW LEVEL SECURITY",
  );
  await sql.query(`DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'osirus'
       AND tablename = 'schema_migrations'
       AND policyname = 'schema_migrations_system_only'
  ) THEN
    CREATE POLICY schema_migrations_system_only ON osirus.schema_migrations
      AS PERMISSIVE FOR ALL TO public
      USING (osirus.is_system())
      WITH CHECK (osirus.is_system());
  END IF;
END
$$`);
}

async function appliedMigrations() {
  try {
    const rows = await sql.query(
      "SELECT filename, checksum FROM osirus.schema_migrations",
    );
    return new Map(rows.map((row) => [row.filename, row.checksum]));
  } catch {
    // The ledger does not exist yet on a database that has never been migrated.
    return new Map();
  }
}

async function applyMigration(migration) {
  for (const [index, statement] of migration.statements.entries()) {
    try {
      await sql.query(statement);
    } catch (error) {
      // Report position, never the statement text: migrations can embed
      // policy predicates and defaults that are noisy in logs.
      throw new Error(
        `${migration.name} failed at statement ${index + 1}/${
          migration.statements.length
        }: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  await sql.query(
    `INSERT INTO osirus.schema_migrations (filename, checksum, statement_count)
     VALUES ($1, $2, $3)
     ON CONFLICT (filename) DO UPDATE
       SET checksum = EXCLUDED.checksum,
           statement_count = EXCLUDED.statement_count,
           applied_at = now()`,
    [migration.name, migration.checksum, migration.statements.length],
  );
}

if (!dryRun) await ensureLedger();
const applied = await appliedMigrations();
const migrations = loadMigrations();

let appliedCount = 0;
let skippedCount = 0;

for (const migration of migrations) {
  const previous = applied.get(migration.name);
  if (previous === migration.checksum) {
    console.log(`skip    ${migration.name} (already applied)`);
    skippedCount += 1;
    continue;
  }
  if (previous && previous !== migration.checksum) {
    throw new Error(
      `${migration.name} was already applied but its contents changed. Add a new ordered migration instead of editing an applied one.`,
    );
  }
  if (dryRun) {
    console.log(
      `pending ${migration.name} (${migration.statements.length} statements)`,
    );
    continue;
  }
  await applyMigration(migration);
  console.log(
    `applied ${migration.name} (${migration.statements.length} statements)`,
  );
  appliedCount += 1;
}

console.log(
  dryRun
    ? "Dry run complete; no statements were executed."
    : `Migration run complete: ${appliedCount} applied, ${skippedCount} already present.`,
);
