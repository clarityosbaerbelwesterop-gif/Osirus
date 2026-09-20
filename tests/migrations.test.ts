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
});
