import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  createTestDatabase,
  type TestDatabase,
  type TestIdentity,
} from "./helpers/pglite";

// RT2-01 regression: setBudget is a whole-row upsert. When an automation
// defines max_cost_usd or max_tokens, startAutomationRun writes a second
// budget row for the run -- and it must be the run defaults plus the
// automation's ceilings, never the automation's ceilings alone. Before the
// fix, every dimension the automation did not set fell to null = unbounded.

const holder = vi.hoisted(() => ({ db: null as TestDatabase | null }));

vi.mock("../src/lib/db/client", () => ({
  queryAs: (userId: string, text: string, params?: unknown[]) =>
    holder.db!.queryAs(userId, text, params),
  querySystem: (text: string, params?: unknown[]) =>
    holder.db!.querySystem(text, params),
  db: () => {
    throw new Error("tests never reach Neon");
  },
}));

const { startAutomationRun } = await import("../src/lib/automations/store");

let db: TestDatabase;
let tenant: TestIdentity;

beforeAll(async () => {
  db = await createTestDatabase();
  holder.db = db;
}, 120_000);

afterAll(async () => {
  await db?.close();
});

beforeEach(async () => {
  tenant = await db.seedTenant("budget");
});

type AutomationRow = {
  id: string;
  organization_id: string;
  workspace_id: string;
  created_by: string;
  name: string;
  objective: string;
  trigger_kind: "schedule" | "run_completed" | "connector_changed" | "webhook";
  schedule: Record<string, unknown>;
  trigger_filter: Record<string, unknown>;
  policy_preset: "cautious" | "balanced";
  max_cost_usd: string | number | null;
  max_tokens: number | null;
  allowed_tools: string[];
  notify_on: string[];
  enabled: boolean;
  session_id: string | null;
  next_run_at: Date | string | null;
  last_run_at: Date | string | null;
  last_run_id: string | null;
  last_status: string | null;
};

async function seedAutomation(input: {
  maxTokens: number | null;
  maxCostUsd: number | null;
}) {
  const [row] = await db.raw<{ id: string }>(
    `insert into osirus.automations
       (organization_id, workspace_id, created_by, name, objective,
        trigger_kind, max_cost_usd, max_tokens)
     values ($1, $2, $3, 'Budget regression', 'Summarise the weekly changelog',
             'schedule', $4, $5)
     returning id`,
    [
      tenant.organizationId,
      tenant.workspaceId,
      tenant.userId,
      input.maxCostUsd,
      input.maxTokens,
    ],
  );
  const [automation] = await db.raw<AutomationRow>(
    "select * from osirus.automations where id = $1",
    [row!.id],
  );
  return automation!;
}

async function runBudget(runId: string) {
  const [row] = await db.raw<{
    max_input_tokens: number | null;
    max_output_tokens: number | null;
    max_model_calls: number | null;
    max_tool_calls: number | null;
    max_attempts: number | null;
    max_repair_rounds: number | null;
    max_wall_clock_ms: number | null;
    max_cost_usd: string | null;
  }>(
    `select max_input_tokens, max_output_tokens, max_model_calls,
            max_tool_calls, max_attempts, max_repair_rounds,
            max_wall_clock_ms, max_cost_usd
       from osirus.run_budgets
      where run_id = $1::uuid and scope = 'run'`,
    [runId],
  );
  return row;
}

describe("automation run budgets (RT2-01)", () => {
  it("keeps the default ceilings when an automation sets only max_tokens", async () => {
    const automation = await seedAutomation({
      maxTokens: 50_000,
      maxCostUsd: null,
    });
    const { runId } = await startAutomationRun(automation, {
      slot: "test:tokens",
      reason: "test",
    });
    const budget = await runBudget(runId);
    expect(budget).toMatchObject({
      max_input_tokens: 50_000,
      max_output_tokens: 50_000,
      // The whole point: these survived the automation's upsert.
      max_model_calls: 40,
      max_tool_calls: 100,
      max_attempts: 60,
      max_repair_rounds: 4,
      max_wall_clock_ms: 30 * 60 * 1000,
    });
    expect(budget!.max_cost_usd).toBeNull();
  });

  it("keeps the default ceilings when an automation sets only max_cost_usd", async () => {
    const automation = await seedAutomation({
      maxTokens: null,
      maxCostUsd: 0.25,
    });
    const { runId } = await startAutomationRun(automation, {
      slot: "test:cost",
      reason: "test",
    });
    const budget = await runBudget(runId);
    expect(budget).toMatchObject({
      max_input_tokens: null,
      max_output_tokens: null,
      max_model_calls: 40,
      max_tool_calls: 100,
      max_attempts: 60,
      max_repair_rounds: 4,
      max_wall_clock_ms: 30 * 60 * 1000,
    });
    expect(Number(budget!.max_cost_usd)).toBeCloseTo(0.25);
  });

  it("plans runs of an automation without a budget under the defaults", async () => {
    const automation = await seedAutomation({
      maxTokens: null,
      maxCostUsd: null,
    });
    const { runId } = await startAutomationRun(automation, {
      slot: "test:default",
      reason: "test",
    });
    const budget = await runBudget(runId);
    expect(budget).toMatchObject({
      max_model_calls: 40,
      max_tool_calls: 100,
      max_attempts: 60,
      max_cost_usd: null,
    });
  });
});
