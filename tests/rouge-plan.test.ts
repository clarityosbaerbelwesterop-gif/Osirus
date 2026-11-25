import {
  afterAll,
  afterEach,
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

// Owner's decision 2026-11-25: on free models the Rouge Agent stalled and
// erred ("Antwort des Modells war unbrauchbar"); it is part of the paid
// plans and runs on premium models. The route against a real Postgres with
// every migration; the plan comes from modelAccessFor.

const state = vi.hoisted(() => ({
  user: null as { id: string; email: string; name: string } | null,
  identity: null as TestIdentity | null,
  freeOnly: true,
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
vi.mock("@/lib/gateway/access", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/lib/gateway/access")>()),
  modelAccessFor: async () => ({
    unlimited: false,
    freeOnly: state.freeOnly,
    quota: null,
  }),
}));

const { POST } = await import("../src/app/api/runtime/route");
const { resetGatewayModelCache } = await import("../src/lib/gateway/models");

let db: TestDatabase;
let tenant: TestIdentity;
const OR_MODELS = "https://openrouter.ai/api/v1/models";

beforeAll(async () => {
  db = await createTestDatabase();
  holder.db = db;
}, 120_000);
afterAll(async () => {
  await db?.close();
});
beforeEach(async () => {
  tenant = await db.seedTenant(
    `rouge-plan-${Math.random().toString(36).slice(2, 8)}`,
  );
  state.identity = tenant;
  state.user = {
    id: tenant.userId,
    email: "rouge@example.test",
    name: "Rouge",
  };
  process.env.OPENROUTER_API_KEY = "or-test-key";
  resetGatewayModelCache();
  vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
    if (String(input) === OR_MODELS)
      return Response.json({
        data: [
          { id: "acme/gratis-70b:free" },
          {
            id: "acme/premium-70b",
            pricing: { prompt: "0.000002", completion: "0.000006" },
          },
        ],
      });
    return new Response("no model calls in this test", { status: 503 });
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.OPENROUTER_API_KEY;
});

function post(surface: "agent" | "coding") {
  return POST(
    new Request("https://osirus.test/api/runtime", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://osirus.test",
      },
      body: JSON.stringify({
        objective: "Baue eine Landingpage mit Anmeldeformular.",
        requestId: crypto.randomUUID(),
        surface,
      }),
    }),
  );
}

async function runs() {
  return db.raw<{ input: Record<string, unknown> | string }>(
    `select input from osirus.runs where workspace_id = $1`,
    [tenant.workspaceId],
  );
}

describe("the Rouge Agent and the plan", () => {
  it("is part of the paid plans: the free plan gets the plan offer, no run", async () => {
    state.freeOnly = true;
    const response = await post("agent");
    expect(response.status).toBe(402);
    expect(await response.json()).toMatchObject({
      error: "plan_required",
      message: expect.stringContaining("ab Pro"),
    });
    expect(await runs()).toHaveLength(0);
  });

  it("leaves Code on the free plan", async () => {
    state.freeOnly = true;
    const response = await post("coding");
    // (This request lacks Code's repository; whatever else it says, it is
    // not the Rouge Agent's plan lock.)
    expect(response.status).not.toBe(402);
    expect(await response.json().catch(() => ({}))).not.toMatchObject({
      error: "plan_required",
    });
  });

  it("runs on a premium model on a paid plan, not on a free one", async () => {
    state.freeOnly = false;
    const response = await post("agent");
    expect(response.status).toBe(200);
    await response.text();
    const [run] = await runs();
    const input =
      typeof run!.input === "string" ? JSON.parse(run!.input) : run!.input;
    expect(input.pinnedModel).toBe("openrouter:acme/premium-70b");
  });
});
