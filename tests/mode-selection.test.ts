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

// User-facing mode selection (Phase B2a): the composer sends an optional
// `mode` with POST /api/runtime; the server persists it on the run's input
// and lets it bias routing with a bounded, auditable score bonus. These run
// the route and the router against a real Postgres (PGlite) with every
// migration and row-level security applied; only the identity provider is
// mocked. The model provider is not configured in tests, so a created run
// plans for real and then fails its first stage fast
// (provider_not_configured is a permanent refusal) -- which is all these
// assertions need.

const state = vi.hoisted(() => ({
  user: null as { id: string; email: string; name: string } | null,
  identity: null as TestIdentity | null,
}));

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

vi.mock("@/lib/auth/server", () => ({
  requireAuthConfiguration: () => undefined,
  auth: {
    getSession: async () => ({
      data: state.user ? { user: state.user } : null,
    }),
  },
}));

vi.mock("@/lib/auth/bootstrap", () => ({
  bootstrapProductIdentity: async () => state.identity,
}));

const { POST } = await import("../src/app/api/runtime/route");
const { MODE_BOOST, routeObjective, scoreCandidates } =
  await import("../src/lib/runtime/router-v2");

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
  tenant = await db.seedTenant("mode-selection");
  state.identity = tenant;
  state.user = {
    id: tenant.userId,
    email: "mode-selection@example.test",
    name: "Mode Selection",
  };
});

// No arm recognises this ("hmm" is the ambiguity fixture the routing suite
// uses), so a mode's bonus is the only signal that can pick an arm.
const AMBIGUOUS = "hmm";

function postRuntime(payload: unknown) {
  return new Request("https://osirus.test/api/runtime", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://osirus.test",
    },
    body: JSON.stringify(payload),
  });
}

function body(overrides: Record<string, unknown> = {}) {
  return {
    objective: AMBIGUOUS,
    requestId: crypto.randomUUID(),
    ...overrides,
  };
}

type Packet = {
  kind: string;
  event?: { type: string; summary: string; data?: Record<string, unknown> };
};

async function packets(response: Response): Promise<Packet[]> {
  const text = await response.text();
  return text
    .split("\n\n")
    .filter((frame) => frame.startsWith("data: "))
    .map((frame) => JSON.parse(frame.slice(6)) as Packet);
}

function routingReason(list: Packet[]): string {
  const selected = list.find(
    (packet) =>
      packet.kind === "event" && packet.event?.type === "capability.selected",
  );
  return String(selected?.event?.data?.reason ?? "");
}

async function runRow(runId: string) {
  const [row] = await db.raw<{
    input: Record<string, unknown> | string;
    status: string;
  }>("select input, status from osirus.runs where id = $1::uuid", [runId]);
  if (!row) throw new Error("run not persisted");
  return {
    ...row,
    input: typeof row.input === "string" ? JSON.parse(row.input) : row.input,
  };
}

describe("POST /api/runtime mode selection", () => {
  it("persists mode=coding on the run and shows the boost in the routing reason", async () => {
    const response = await POST(postRuntime(body({ mode: "coding" })));
    expect(response.status).toBe(200);
    const runId = response.headers.get("x-osirus-run-id");
    expect(runId).toBeTruthy();

    const reason = routingReason(await packets(response));
    expect(reason).toContain("mode=coding");
    expect(reason).toContain("coding arm");

    const run = await runRow(runId!);
    expect(run.input).toMatchObject({ mode: "coding" });
    expect(typeof run.input.requestId).toBe("string");
  }, 60_000);

  it("treats mode=auto exactly like an absent mode", async () => {
    const withAuto = await POST(postRuntime(body({ mode: "auto" })));
    expect(withAuto.status).toBe(200);
    const autoRunId = withAuto.headers.get("x-osirus-run-id")!;
    const autoReason = routingReason(await packets(withAuto));

    const without = await POST(postRuntime(body()));
    expect(without.status).toBe(200);
    const plainRunId = without.headers.get("x-osirus-run-id")!;
    const plainReason = routingReason(await packets(without));

    expect(autoReason).toBe(plainReason);
    expect(autoReason).not.toContain("mode=");
    expect((await runRow(autoRunId)).input).not.toHaveProperty("mode");
    expect((await runRow(plainRunId)).input).not.toHaveProperty("mode");
  }, 60_000);

  it("rejects an unknown mode with 400", async () => {
    const response = await POST(postRuntime(body({ mode: "ludicrous" })));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_request" });
  });

  it("still refuses a stranger with 401", async () => {
    state.user = null;
    const response = await POST(postRuntime(body({ mode: "coding" })));
    expect(response.status).toBe(401);
  });
});

describe("router-v2 mode bias", () => {
  it("boosts the arm each mode stands for, and says so", async () => {
    const armByMode = {
      research: "research",
      coding: "coding",
      reasoning: "thinking",
      agent: "building",
    } as const;
    for (const [mode, armId] of Object.entries(armByMode)) {
      const decision = await routeObjective(AMBIGUOUS, {
        mode: mode as keyof typeof armByMode,
      });
      expect(decision.primary).toBe(armId);
      expect(decision.composition).toEqual([armId]);
      expect(decision.reason).toContain(`mode=${mode}`);
    }
  });

  it("keeps the boosted score bounded at the cap", async () => {
    // Already a strong research match: the bonus must not push past 1.
    const decision = await routeObjective(
      "Research the latest sources and compare them versus the 2024 survey",
      { mode: "research" },
    );
    expect(decision.primary).toBe("research");
    expect(decision.confidence).toBeLessThanOrEqual(1);
    expect(decision.reason).toContain("mode=research");
    expect(
      scoreCandidates("hmm").every(
        (candidate) => candidate.score <= 1 && candidate.score >= 0,
      ),
    ).toBe(true);
    expect(MODE_BOOST).toBeGreaterThan(0);
    expect(MODE_BOOST).toBeLessThanOrEqual(1);
  });

  it("lets strong contradictory evidence outrank the boosted arm", async () => {
    const decision = await routeObjective(
      "Fix the failing TypeScript build and the npm test regression in the Repository class",
      { mode: "research" },
    );
    expect(decision.primary).toBe("coding");
    // The preference is still on the record, not silently dropped.
    expect(decision.reason).toContain("mode=research");
  });

  it("is byte-for-byte the old behaviour for auto or no mode", async () => {
    const objective =
      "Research the current Postgres lease patterns, then implement the claim function in TypeScript";
    const plain = await routeObjective(objective);
    const auto = await routeObjective(objective, { mode: "auto" });
    expect(auto).toEqual(plain);
    expect(plain.composition).toEqual(["research", "coding"]);
    expect(plain.reason).not.toContain("mode=");
  });
});
