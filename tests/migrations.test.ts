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
  "008_workflow_engine.sql",
  "009_agent_execution.sql",
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

  it("claims workflow stages without two workers taking the same one", () => {
    const engine = migration("008_workflow_engine.sql");
    // SKIP LOCKED is what makes concurrent claims take different rows instead
    // of blocking; the lease is what keeps them apart after the lock is gone.
    expect(engine).toContain("FUNCTION osirus.claim_next_stage");
    expect(engine).toContain("FOR UPDATE OF s SKIP LOCKED");
    // The dependency test must sit inside the same statement as the lock, or a
    // predecessor completing concurrently could let a dependent start early.
    expect(engine).toContain("osirus.run_stage_dependencies");
    expect(engine).toMatch(/dep\.status NOT IN \('completed', 'skipped'\)/);
  });

  it("fences lease writes on a token rather than a worker id", () => {
    // A worker id survives a restart. Without a per-claim token, a stalled
    // worker waking after its stage was reclaimed would still match on
    // lease_owner and overwrite newer work.
    const engine = migration("008_workflow_engine.sql");
    expect(engine).toContain("lease_token uuid");
    for (const fn of ["heartbeat_attempt", "finish_attempt"]) {
      const start = engine.indexOf(`FUNCTION osirus.${fn}`);
      expect(start).toBeGreaterThan(-1);
      const body = engine.slice(start, engine.indexOf("$function$;", start));
      expect(body).toContain("p_lease_token uuid");
      expect(body).toContain("lease_token = p_lease_token");
      expect(body).not.toContain("lease_owner = p_worker_id");
    }
  });

  it("derives the attempt number from attempts, not the stage counter", () => {
    // attempt_count is the retry ceiling. Trusting it to allocate the attempt
    // number produces a duplicate key against run_attempts_run_stage_attempt_key
    // whenever the two disagree.
    const engine = migration("008_workflow_engine.sql");
    expect(engine).toContain("COALESCE(MAX(a.attempt_number), 0) + 1");
    expect(engine).toContain("run_attempts_run_stage_attempt_key");
    expect(engine).toContain(
      "UNIQUE NULLS NOT DISTINCT (run_id, stage_id, attempt_number)",
    );
  });

  it("puts every new workflow table behind tenant policy", () => {
    const engine = migration("008_workflow_engine.sql");
    for (const table of ["run_stage_dependencies", "run_budgets"]) {
      expect(engine).toContain(
        `ALTER TABLE osirus.${table} ENABLE ROW LEVEL SECURITY`,
      );
      expect(engine).toContain(
        `ALTER TABLE osirus.${table} FORCE ROW LEVEL SECURITY`,
      );
      expect(engine).toContain(`CREATE POLICY ${table}_access`);
      expect(engine).toContain(`ON osirus.${table} TO osirus_app`);
    }
  });

  it("separates the retry ceiling from the slice ceiling", () => {
    // Under 008 every claim consumed a retry, so a stage allowed one attempt
    // could never yield and resume -- the second claim failed it. 009 counts a
    // claim as a retry only when the previous attempt ended badly, and bounds
    // continuations with their own ceiling so neither can run unbounded.
    const execution = migration("009_agent_execution.sql");
    expect(execution).toContain("slice_count integer NOT NULL DEFAULT 0");
    expect(execution).toContain("v_is_retry");
    expect(execution).toMatch(
      /v_is_retry := v_last_status IS NULL\s*\n\s*OR v_last_status IN \('failed', 'lost', 'cancelled'\)/,
    );
    expect(execution).toContain(
      "IF v_is_retry AND v_stage.attempt_count >= v_max_attempts",
    );
    expect(execution).toContain("IF v_stage.slice_count >= v_max_slices");
  });

  it("writes a verification verdict together with its evidence", () => {
    // Recording the label first would leave a window in which a stage reads as
    // verified with nothing behind it, which is the exact claim this engine
    // must never make.
    const execution = migration("009_agent_execution.sql");
    expect(execution).toContain("FUNCTION osirus.record_verification");
    expect(execution).toContain("verification jsonb");
    const start = execution.indexOf("FUNCTION osirus.record_verification");
    const body = execution.slice(
      start,
      execution.indexOf("$function$;", start),
    );
    expect(body).toContain("verifier_status = p_verifier_status");
    expect(body).toContain("verification = p_verification");
    expect(body).toContain("invalid_verifier_status");
  });

  it("keeps the acceptance contract on the run, written before execution", () => {
    const execution = migration("009_agent_execution.sql");
    expect(execution).toContain("ADD COLUMN IF NOT EXISTS arm_id text");
    expect(execution).toContain(
      "ADD COLUMN IF NOT EXISTS acceptance_contract jsonb",
    );
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

describe("migrations 012 and 013", () => {
  const tablesOf = (sql: string, schema: string) =>
    [
      ...sql.matchAll(
        new RegExp(`CREATE TABLE IF NOT EXISTS ${schema}\\.([a-z_]+)`, "g"),
      ),
    ].map((match) => match[1]!);

  it("puts every Intelligence Plane table under forced RLS, system writes, operator reads", () => {
    const sql = migration("012_intelligence_foundry.sql");
    const tables = tablesOf(sql, "osirus_intel");
    expect(tables.length).toBeGreaterThanOrEqual(24);
    for (const table of tables) {
      expect(sql, table).toContain(
        `ALTER TABLE osirus_intel.${table} ENABLE ROW LEVEL SECURITY;`,
      );
      expect(sql, table).toContain(
        `ALTER TABLE osirus_intel.${table} FORCE ROW LEVEL SECURITY;`,
      );
      expect(sql, table).toMatch(
        new RegExp(`GRANT [A-Z, ]+ ON osirus_intel\\.${table} TO osirus_app;`),
      );
    }
    // Operators read; nobody but the system writes.
    expect(sql).toMatch(
      /CREATE POLICY [a-z_]+_read ON osirus_intel\.experience[\s\S]*?osirus_intel\.is_operator\(\)/,
    );
    expect(sql).not.toMatch(/WITH CHECK \([^)]*is_operator/);
    // Append-only history.
    expect(sql).toContain(
      "GRANT SELECT, INSERT ON osirus_intel.promotion_events TO osirus_app;",
    );
    expect(sql).toContain(
      "GRANT SELECT, INSERT ON osirus_intel.experience TO osirus_app;",
    );
  });

  it("refuses a high-risk asset in a product canary at the database, not only in code", () => {
    const sql = migration("012_intelligence_foundry.sql");
    expect(sql).toContain(
      "CONSTRAINT strategy_versions_high_risk_product_check CHECK (risk_class = 'low' OR status <> ALL (ARRAY['canary'::text, 'active'::text]))",
    );
  });

  it("claims product stages before Foundry stages, otherwise as before", () => {
    const sql = migration("012_intelligence_foundry.sql");
    expect(sql).toContain(
      "ADD COLUMN IF NOT EXISTS priority smallint NOT NULL DEFAULT 0",
    );
    expect(sql).toMatch(
      /ORDER BY r\.priority DESC, s\.runnable_after NULLS FIRST/,
    );
  });

  it("keeps attachments, webhooks and entitlements tenant-scoped", () => {
    const sql = migration("013_product_frontier.sql");
    const tables = tablesOf(sql, "osirus");
    expect(tables).toEqual([
      "attachments",
      "attachment_chunks",
      "webhook_endpoints",
      "webhook_deliveries",
      "entitlements",
    ]);
    for (const table of tables) {
      expect(sql, table).toContain(
        `ALTER TABLE osirus.${table} FORCE ROW LEVEL SECURITY;`,
      );
    }
    expect(sql).toContain(
      "byte_size <= 10485760 AND octet_length(content) = byte_size",
    );
    // A delivery id is accepted once; only the system records deliveries.
    expect(sql).toContain(
      "CONSTRAINT webhook_deliveries_unique_key UNIQUE (endpoint_id, delivery_id)",
    );
    expect(sql).toMatch(
      /webhook_deliveries_insert[\s\S]*?WITH CHECK \(osirus\.is_system\(\)\)/,
    );
    // Plans are set by the system only; organizations can read theirs.
    expect(sql).toMatch(
      /entitlements_write[\s\S]*?WITH CHECK \(osirus\.is_system\(\)\)/,
    );
    expect(sql).not.toMatch(/DROP TABLE|TRUNCATE|DELETE FROM/i);
  });
});

describe("migration 014", () => {
  it("charges a slice only inside the transaction that writes its checkpoint", () => {
    // A charge that commits before the checkpoint can be applied again when
    // the resume still sees the previous loop counts. The settlement row, the
    // checkpoint and consume_budget have to be one function, and a replay of
    // the same attempt has to return before either write.
    const sql = migration("014_checkpoint_budget.sql");
    expect(sql).toContain(
      "CREATE TABLE IF NOT EXISTS osirus.stage_budget_settlements",
    );
    expect(sql).toContain(
      "ALTER TABLE osirus.stage_budget_settlements FORCE ROW LEVEL SECURITY",
    );
    expect(sql).toContain(
      "CREATE POLICY stage_budget_settlements_access ON osirus.stage_budget_settlements",
    );
    expect(sql).toContain("USING (osirus.can_access_run(run_id))");
    expect(sql).toContain("WITH CHECK (osirus.can_manage_run(run_id))");
    expect(sql).toContain(
      "GRANT SELECT, INSERT, UPDATE, DELETE ON osirus.stage_budget_settlements TO osirus_app",
    );
    expect(sql).toContain(
      "CONSTRAINT stage_budget_settlements_pkey PRIMARY KEY (attempt_id)",
    );
    expect(sql).toContain("CHECK (model_calls >= 0 AND tool_calls >= 0)");

    const start = sql.indexOf("FUNCTION osirus.checkpoint_stage_budget");
    expect(start).toBeGreaterThan(-1);
    const body = sql.slice(start, sql.indexOf("$function$;", start));
    const lock = body.indexOf("pg_advisory_xact_lock");
    const replay = body.indexOf("WHERE attempt_id = p_attempt_id");
    const replayReturn = body.indexOf(
      "RETURN QUERY SELECT COALESCE(v_version, 0)",
    );
    const settlement = body.indexOf(
      "INSERT INTO osirus.stage_budget_settlements",
    );
    const checkpoint = body.indexOf("osirus.save_run_checkpoint(");
    const charge = body.indexOf("osirus.consume_budget(");
    expect(lock).toBeGreaterThan(-1);
    expect(lock).toBeLessThan(replay);
    expect(replay).toBeLessThan(replayReturn);
    expect(replayReturn).toBeLessThan(settlement);
    expect(settlement).toBeLessThan(checkpoint);
    expect(checkpoint).toBeLessThan(charge);
    expect(body).toContain("v_state - 'pendingBudget'");
    expect(body).toContain("RAISE EXCEPTION 'attempt_run_mismatch'");
    expect(body).toContain(
      "hashtextextended(p_run_id::text || ':checkpoint', 0)",
    );
    expect(sql).not.toMatch(/DROP TABLE|TRUNCATE|DELETE FROM/i);
  });
});

describe("migration 015", () => {
  it("counts the run-budget attempt inside the checkpoint charge", () => {
    // The attempt counter used to run after checkpoint_stage_budget committed.
    // A crash in between settled the slice and left the attempt uncounted.
    // The replacement function stores the attempt on the same settlement row
    // and passes it to consume_budget before returning. A replay still
    // returns before either write.
    const sql = migration("015_checkpoint_attempt.sql");
    expect(sql).toContain(
      "ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0",
    );
    expect(sql).toContain(
      "ADD CONSTRAINT stage_budget_settlements_attempts_check CHECK (attempts >= 0)",
    );
    expect(sql.replace(/\s+/g, " ")).toContain(
      "DROP FUNCTION IF EXISTS osirus.checkpoint_stage_budget( uuid, uuid, uuid, text, jsonb, integer, integer )",
    );
    const drop = sql.indexOf(
      "DROP FUNCTION IF EXISTS osirus.checkpoint_stage_budget",
    );
    const start = sql.indexOf(
      "CREATE OR REPLACE FUNCTION osirus.checkpoint_stage_budget",
    );
    expect(drop).toBeGreaterThan(-1);
    expect(start).toBeGreaterThan(drop);

    const body = sql.slice(start, sql.indexOf("$function$;", start));
    const lock = body.indexOf("pg_advisory_xact_lock");
    const replay = body.indexOf("WHERE attempt_id = p_attempt_id");
    const replayReturn = body.indexOf(
      "RETURN QUERY SELECT COALESCE(v_version, 0), false, NULL::text, 0, 0, 0",
    );
    const settlement = body.indexOf(
      "INSERT INTO osirus.stage_budget_settlements",
    );
    const checkpoint = body.indexOf("osirus.save_run_checkpoint(");
    const charge = body.indexOf("osirus.consume_budget(");
    expect(lock).toBeGreaterThan(-1);
    expect(lock).toBeLessThan(replay);
    expect(replay).toBeLessThan(replayReturn);
    expect(replayReturn).toBeLessThan(settlement);
    expect(settlement).toBeLessThan(checkpoint);
    expect(checkpoint).toBeLessThan(charge);
    expect(body).toContain(
      "attempt_id, run_id, stage_id, model_calls, tool_calls, attempts",
    );
    expect(body).toContain(
      "IF v_model > 0 OR v_tool > 0 OR v_attempts > 0 THEN",
    );
    const chargeCall = body.slice(charge, body.indexOf(") AS b", charge));
    expect(chargeCall).toContain("v_attempts");
    expect(chargeCall).not.toMatch(/v_tool,\s*0,/);
    expect(body).toContain("'attempts', v_attempts");
    expect(body).toContain("v_state - 'pendingBudget'");
    expect(sql).not.toMatch(/DROP TABLE|TRUNCATE|DELETE FROM/i);
  });
});

describe("migration 016", () => {
  const sql = migration("016_capability_pulse.sql");

  it("keeps pulse state system-written, operator-read, under forced RLS", () => {
    for (const table of ["pulse_cycles", "pulse_results", "pulse_baselines"]) {
      expect(sql, table).toContain(
        `ALTER TABLE osirus_intel.${table} FORCE ROW LEVEL SECURITY;`,
      );
      expect(sql, table).toMatch(
        new RegExp(
          `CREATE POLICY ${table}_read ON osirus_intel\\.${table}[\\s\\S]*?osirus_intel\\.is_operator\\(\\)`,
        ),
      );
      expect(sql, table).toMatch(
        new RegExp(
          `CREATE POLICY ${table}_write ON osirus_intel\\.${table}[\\s\\S]*?WITH CHECK \\(osirus\\.is_system\\(\\)\\)`,
        ),
      );
    }
    // Results are append-only.
    expect(sql).toContain(
      "GRANT SELECT, INSERT ON osirus_intel.pulse_results TO osirus_app;",
    );
  });

  it("allows one running cycle and one result per task", () => {
    expect(sql).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS pulse_cycles_one_running_idx[\s\S]*?WHERE status = 'running'/,
    );
    expect(sql).toContain(
      "CONSTRAINT pulse_results_task_key UNIQUE (cycle_id, task_id)",
    );
  });

  it("stores only the canonical outcomes", async () => {
    const { CAPABILITY_OUTCOMES } =
      await import("../src/lib/verification/outcome");
    const body = sql.slice(sql.indexOf("pulse_results_outcome_check"));
    const allowed = [
      ...body.slice(0, body.indexOf("]))")).matchAll(/'([A-Z_]+)'::text/g),
    ].map((match) => match[1]);
    expect(allowed).toEqual([...CAPABILITY_OUTCOMES]);
  });
});
