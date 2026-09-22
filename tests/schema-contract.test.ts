import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Column constraints the runtime writes against.
//
// Three defects shipped into this branch before this file existed, all the
// same shape: a status literal in TypeScript that the CHECK constraint does
// not permit. Postgres rejects the row, so the failure is total rather than
// subtle -- `approvals` could never be created, which silently disabled the
// approval gate, and a refused tool call could not be audited, which lost
// exactly the row that mattered most.
//
// Reading the migrations here means the next drift fails in CI rather than in
// production, and it costs no database connection to check.

const migrations = readFileSync(
  join(process.cwd(), "db", "migrations", "002_memory_capabilities.sql"),
  "utf8",
);
const runtimeMigration = readFileSync(
  join(process.cwd(), "db", "migrations", "005_runtime_production.sql"),
  "utf8",
);

function allowedValues(source: string, constraint: string) {
  const start = source.indexOf(`ADD CONSTRAINT ${constraint}`);
  expect(start, `${constraint} not found`).toBeGreaterThan(-1);
  const body = source.slice(start, source.indexOf(";", start));
  return [...body.matchAll(/'([a-z_]+)'::text/g)].map((match) => match[1]);
}

function source(...parts: string[]) {
  return readFileSync(join(process.cwd(), ...parts), "utf8");
}

describe("status literals match their check constraints", () => {
  it("writes an approval in a state the constraint permits", () => {
    const allowed = allowedValues(migrations, "approvals_status_check");
    const repository = source("src", "lib", "runtime", "repository.ts");
    const insert = repository.slice(
      repository.indexOf("insert into osirus.approvals"),
    );
    const written = /values \([^)]*?'([a-z_]+)'/s.exec(insert)?.[1];
    expect(written).toBeTruthy();
    expect(allowed, `approvals.status = ${written}`).toContain(written);

    // The gate and the resolver have to agree with the insert, or an approval
    // is created and then never found again.
    expect(repository).toContain("status = 'requested'");
    expect(repository).not.toContain("status = 'pending'");
  });

  it("audits a tool call in a state the constraint permits", () => {
    const allowed = allowedValues(migrations, "tool_calls_status_check");
    const registry = source("src", "lib", "tools", "registry.ts");
    const declared = /status: ((?:"[a-z_]+"(?: \| )?)+);/.exec(registry)?.[1];
    expect(declared).toBeTruthy();
    for (const value of declared!.match(/"([a-z_]+)"/g) ?? []) {
      const status = value.replaceAll('"', "");
      expect(allowed, `tool_calls.status = ${status}`).toContain(status);
    }
  });

  it("settles a stage in a state the constraint permits", () => {
    const allowed = allowedValues(runtimeMigration, "run_stages_status_check");
    for (const status of [
      "completed",
      "failed",
      "blocked",
      "waiting",
      "skipped",
      "cancelled",
      "pending",
    ]) {
      expect(allowed, `run_stages.status = ${status}`).toContain(status);
    }
  });

  it("keeps generated titles and labels inside their length caps", () => {
    // artifacts_title_check is 240; checkpoints_label_check is 160.
    expect(migrations).toContain("char_length(title) <= 240");
    expect(source("src", "lib", "runtime", "repository.ts")).toContain(
      "input.title.slice(0, 240)",
    );
    expect(source("src", "lib", "runtime", "worker.ts")).toContain(
      ".slice(0, 160)",
    );
  });
});
