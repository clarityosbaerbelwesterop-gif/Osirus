import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migrations = [
  "000_recovered_schema.sql",
  "001_core_runtime.sql",
  "002_memory_capabilities.sql",
  "003_skills_connectors_evals.sql",
  "004_security_rls.sql",
  "005_runtime_production.sql",
  "006_api_controls.sql",
  "007_app_role.sql",
];

function migration(name: string) {
  return readFileSync(join(process.cwd(), "db", "migrations", name), "utf8");
}

describe("migration replay invariants", () => {
  it("keeps bootstrap separate from ordered schema creation", () => {
    const bootstrap = migration("000_recovered_schema.sql");
    expect(bootstrap).toContain("CREATE SCHEMA IF NOT EXISTS osirus");
    expect(bootstrap).not.toMatch(/CREATE TABLE/i);

    const owners = new Map<string, string>();
    for (const name of migrations.slice(1, 4)) {
      for (const match of migration(name).matchAll(
        /CREATE TABLE osirus\.([a-z_]+)/gi,
      )) {
        const table = match[1];
        expect(owners.has(table), `${table} is created more than once`).toBe(
          false,
        );
        owners.set(table, name);
      }
    }
    expect(owners.size).toBeGreaterThanOrEqual(30);
  });

  it("orders connector foreign keys after connector tables", () => {
    const memory = migration("002_memory_capabilities.sql");
    const connectors = migration("003_skills_connectors_evals.sql");
    expect(memory).not.toContain("tool_calls_connector_installation_id_fkey");
    expect(
      connectors.indexOf("CREATE TABLE osirus.connector_installations"),
    ).toBeLessThan(
      connectors.indexOf("tool_calls_connector_installation_id_fkey"),
    );
  });

  it("defines RLS helper dependencies before security-definer policies", () => {
    const security = migration("004_security_rls.sql");
    expect(security.indexOf("FUNCTION osirus.current_user_id")).toBeLessThan(
      security.indexOf("FUNCTION osirus.can_access_organization"),
    );
    for (const line of security.split("\n")) {
      if (line.trim().startsWith("$function$")) {
        expect(line.trim().endsWith(";")).toBe(true);
      }
    }
  });

  it("keeps mutation rate limits durable and system-only", () => {
    const controls = migration("006_api_controls.sql");
    expect(controls).toContain("CREATE TABLE osirus.request_rate_limits");
    expect(controls).toContain("FORCE ROW LEVEL SECURITY");
    expect(controls).toContain("request_rate_limits_system_only");
  });

  it("serializes append-only event sequence allocation", () => {
    const runtime = migration("005_runtime_production.sql");
    expect(runtime).toContain("FUNCTION osirus.append_run_event");
    expect(runtime).toContain("pg_advisory_xact_lock");
    expect(runtime).toContain("MAX(sequence)");
  });

  it("provisions a runtime role that cannot bypass row-level security", () => {
    // Neon's owner role carries BYPASSRLS, which silently disables every policy
    // in 004. A verified probe running as the owner could read and delete
    // another tenant's rows; running as this role, the same probe is rejected.
    const appRole = migration("007_app_role.sql");
    expect(appRole).toContain("CREATE ROLE osirus_app");
    expect(appRole).toContain("NOBYPASSRLS");
    expect(appRole).toContain("GRANT USAGE ON SCHEMA osirus TO osirus_app");
    expect(appRole).toContain("ALTER DEFAULT PRIVILEGES IN SCHEMA osirus");

    // The attribute may be discussed in comments, but no statement may grant it.
    const statements = appRole
      .split("\n")
      .filter((line) => !line.trim().startsWith("--"))
      .join("\n");
    expect(statements).not.toMatch(/(?<!NO)BYPASSRLS/);
  });
});

describe("runtime database access", () => {
  const client = readFileSync(
    join(process.cwd(), "src", "lib", "db", "client.ts"),
    "utf8",
  );

  it("assumes the non-bypassing role on every tenant-scoped statement", () => {
    expect(client).toContain('const APP_ROLE = "osirus_app"');
    // Both helpers must switch role in the same transaction that sets the
    // tenant GUC, or the policies are evaluated against a role that skips them.
    const roleSwitches = client.match(/set_config\('role', \$\d+, true\)/g);
    expect(roleSwitches).toHaveLength(2);
  });

  it("provisions a first tenancy without the caller's own policies", () => {
    // A new user has no membership rows yet, so they cannot see any row in
    // osirus.workspaces. `on conflict` has to probe the target table for a
    // conflicting row, so the provisioning insert is rejected with a row-level
    // security violation and signup fails outright. Provisioning therefore runs
    // as a system caller, which the is_system() branches in those policies
    // exist for. Verified against a live replay of the full schema.
    const bootstrap = readFileSync(
      join(process.cwd(), "src", "lib", "auth", "bootstrap.ts"),
      "utf8",
    );
    for (const table of [
      "osirus.organizations",
      "osirus.organization_memberships",
      "osirus.workspaces",
      "osirus.workspace_memberships",
    ]) {
      const insert = bootstrap.indexOf(`insert into ${table}`);
      expect(insert).toBeGreaterThan(-1);
      const helper = bootstrap.lastIndexOf("await query", insert);
      expect(bootstrap.slice(helper, insert)).toContain("querySystem");
    }
  });

  it("scopes every access-control setting to the transaction", () => {
    // A session-scoped set_config would leak the previous caller's identity
    // onto the next request that reuses the pooled connection.
    for (const call of client.match(/set_config\([^)]*\)/g) ?? []) {
      expect(call.endsWith("true)")).toBe(true);
    }
  });
});
