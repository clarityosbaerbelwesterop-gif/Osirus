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

// POST /api/chat/stream end to end against a real Postgres (PGlite, every
// migration, row-level security): one provider call per message, the SSE
// frames, the stored thread, the usage row the billing windows count, the
// answer cache, and the free plan's model lock. Only the sign-in and the
// provider's HTTP endpoint are faked.

const state = vi.hoisted(() => ({
  user: null as {
    id: string;
    email: string;
    name: string;
    emailVerified?: boolean;
  } | null,
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

const { POST } = await import("../src/app/api/chat/stream/route");
const { GET: getThread } =
  await import("../src/app/api/chat/threads/[sessionId]/route");
const { GET: getModels } = await import("../src/app/api/models/route");
const { resetGatewayModelCache } = await import("../src/lib/gateway/models");
const { resetAnswerCache } = await import("../src/lib/gateway/cache");

let db: TestDatabase;
let tenant: TestIdentity;
let providerCalls: Array<{ url: string; body: Record<string, unknown> | null }>;
let answer: string;

const MODELS = {
  data: [
    {
      id: "openai/gpt-5",
      pricing: { prompt: "0.00000125", completion: "0.00001" },
    },
    {
      id: "qwen/qwen3-235b-a22b:free",
      pricing: { prompt: "0", completion: "0" },
    },
  ],
};

function sse(frames: unknown[]) {
  return new Response(
    frames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join("") +
      "data: [DONE]\n\n",
    { headers: { "content-type": "text/event-stream" } },
  );
}

beforeAll(async () => {
  db = await createTestDatabase();
  holder.db = db;
}, 120_000);

afterAll(async () => {
  await db?.close();
});

beforeEach(async () => {
  tenant = await db.seedTenant(
    `chat-stream-${Math.random().toString(36).slice(2, 8)}`,
  );
  state.identity = tenant;
  state.user = { id: tenant.userId, email: "chat@example.test", name: "Chat" };
  process.env.OPENROUTER_API_KEY = "or-test-key";
  delete process.env.OSIRUS_OWNER_EMAILS;
  resetGatewayModelCache();
  resetAnswerCache();
  providerCalls = [];
  answer = "Hallo! Wie kann ich helfen?";
  vi.stubGlobal(
    "fetch",
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      providerCalls.push({
        url,
        body: init?.body ? JSON.parse(String(init.body)) : null,
      });
      if (url.endsWith("/models")) return Response.json(MODELS);
      return sse([
        { choices: [{ delta: { reasoning: "kurz nachdenken" } }] },
        { choices: [{ delta: { content: answer.slice(0, 6) } }] },
        { choices: [{ delta: { content: answer.slice(6) } }] },
        {
          choices: [],
          usage: { prompt_tokens: 40, completion_tokens: 8, cost: 0 },
        },
      ]);
    },
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.OPENROUTER_API_KEY;
  delete process.env.OSIRUS_OWNER_EMAILS;
});

function post(body: unknown) {
  return POST(
    new Request("https://osirus.test/api/chat/stream", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://osirus.test",
      },
      body: JSON.stringify(body),
    }),
  );
}

async function frames(response: Response) {
  const text = await response.text();
  return text
    .split("\n\n")
    .filter((chunk) => chunk.startsWith("data: "))
    .map((chunk) => JSON.parse(chunk.slice(6)) as Record<string, unknown>);
}

const chatCalls = () =>
  providerCalls.filter((call) => call.url.endsWith("/chat/completions"));

describe("POST /api/chat/stream", () => {
  it("streams one answer from one model call and stores the thread", async () => {
    const response = await post({
      message: "Hallo",
      model: "openrouter:qwen/qwen3-235b-a22b:free",
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    const events = await frames(response);
    expect(events[0]).toMatchObject({
      type: "start",
      created: true,
      cached: false,
    });
    expect(
      events
        .filter((e) => e.type === "reasoning")
        .map((e) => e.text)
        .join(""),
    ).toBe("kurz nachdenken");
    expect(
      events
        .filter((e) => e.type === "text")
        .map((e) => e.text)
        .join(""),
    ).toBe(answer);
    expect(events.at(-1)).toMatchObject({ type: "done" });
    expect(chatCalls()).toHaveLength(1);
    expect(chatCalls()[0].body).toMatchObject({
      model: "qwen/qwen3-235b-a22b:free",
      stream: true,
    });

    const sessionId = String(events[0].sessionId);
    const thread = await getThread(new Request("https://osirus.test"), {
      params: Promise.resolve({ sessionId }),
    });
    const body = (await thread.json()) as {
      messages: Array<Record<string, unknown>>;
    };
    expect(body.messages.map((m) => [m.role, m.content])).toEqual([
      ["user", "Hallo"],
      ["assistant", answer],
    ]);
    expect(body.messages[1]).toMatchObject({
      reasoning: "kurz nachdenken",
      model: "openrouter:qwen/qwen3-235b-a22b:free",
    });

    const calls = await db.raw<{
      provider: string;
      model: string;
      run_id: string | null;
      request_metadata: Record<string, unknown>;
      estimated_cost_usd: string;
    }>(
      "select provider, model, run_id, request_metadata, estimated_cost_usd from osirus.model_calls where workspace_id = $1",
      [tenant.workspaceId],
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ provider: "openrouter", run_id: null });
    expect(calls[0].request_metadata.userId).toBe(tenant.userId);
    expect(Number(calls[0].estimated_cost_usd)).toBe(0);
  });

  it("sends the thread as context and answers the same question from cache", async () => {
    const first = await frames(
      await post({
        message: "Erkläre MVCC",
        model: "openrouter:qwen/qwen3-235b-a22b:free",
      }),
    );
    const sessionId = String(first[0].sessionId);
    await frames(
      await post({
        sessionId,
        message: "Kürzer",
        model: "openrouter:qwen/qwen3-235b-a22b:free",
      }),
    );
    const sent = chatCalls()[1].body?.messages as Array<{
      role: string;
      content: string;
    }>;
    expect(sent.map((m) => m.role)).toEqual([
      "system",
      "user",
      "assistant",
      "user",
    ]);
    expect(sent.at(-1)?.content).toBe("Kürzer");

    const before = chatCalls().length;
    const fresh = await frames(
      await post({
        message: "Erkläre MVCC",
        model: "openrouter:qwen/qwen3-235b-a22b:free",
      }),
    );
    // A new thread with the same single question: same messages, cached answer.
    expect(fresh[0]).toMatchObject({ cached: true });
    expect(chatCalls().length).toBe(before);
  });

  it("regenerates without storing the question twice", async () => {
    const first = await frames(
      await post({
        message: "Witz bitte",
        model: "openrouter:qwen/qwen3-235b-a22b:free",
      }),
    );
    const sessionId = String(first[0].sessionId);
    answer = "Ein anderer Witz.";
    const again = await frames(
      await post({
        sessionId,
        message: "Witz bitte",
        model: "openrouter:qwen/qwen3-235b-a22b:free",
        regenerate: true,
      }),
    );
    expect(again[0]).toMatchObject({ cached: false });
    const rows = await db.raw<{ role: string }>(
      "select role from osirus.messages where session_id = $1 order by created_at",
      [sessionId],
    );
    expect(rows.map((r) => r.role)).toEqual(["user", "assistant", "assistant"]);
    const thread = await getThread(new Request("https://osirus.test"), {
      params: Promise.resolve({ sessionId }),
    });
    const body = (await thread.json()) as {
      messages: Array<{ content: string }>;
    };
    expect(body.messages.map((m) => m.content)).toEqual([
      "Witz bitte",
      "Ein anderer Witz.",
    ]);
  });

  it("keeps the free plan on free models, and owners on every model", async () => {
    const refused = await post({
      message: "Hi",
      model: "openrouter:openai/gpt-5",
    });
    expect(refused.status).toBe(403);
    expect(await refused.json()).toMatchObject({ error: "model_not_in_plan" });
    expect(chatCalls()).toHaveLength(0);

    const listed = (await (await getModels()).json()) as {
      models: Array<{ ref: string }>;
      freeOnly: boolean;
    };
    expect(listed.freeOnly).toBe(true);
    expect(listed.models.map((m) => m.ref)).toEqual([
      "openrouter:qwen/qwen3-235b-a22b:free",
    ]);

    process.env.OSIRUS_OWNER_EMAILS = "Chat@Example.test";
    const allowed = await post({
      message: "Hi",
      model: "openrouter:openai/gpt-5",
    });
    expect(allowed.status).toBe(200);
    expect((await frames(allowed)).at(-1)).toMatchObject({ type: "done" });
    const owner = (await (await getModels()).json()) as {
      models: Array<{ ref: string }>;
      unlimited: boolean;
    };
    expect(owner.unlimited).toBe(true);
    expect(owner.models).toHaveLength(2);
  });

  it("gives owner access only to a confirmed email", async () => {
    process.env.OSIRUS_OWNER_EMAILS = "chat@example.test";
    state.user = { ...state.user!, emailVerified: false };
    const refused = await post({
      message: "Hi",
      model: "openrouter:openai/gpt-5",
    });
    expect(refused.status).toBe(403);
    state.user = { ...state.user!, emailVerified: true };
    const allowed = await post({
      message: "Hi",
      model: "openrouter:openai/gpt-5",
    });
    expect(allowed.status).toBe(200);
    await allowed.text();
  });

  it("reports a provider refusal as an error frame and stores no answer", async () => {
    vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/models")) return Response.json(MODELS);
      return new Response("busy", {
        status: 429,
        headers: { "retry-after": "3" },
      });
    });
    const events = await frames(
      await post({
        message: "Hallo",
        model: "openrouter:qwen/qwen3-235b-a22b:free",
      }),
    );
    expect(events.at(-1)).toMatchObject({
      type: "error",
      code: "rate_limited",
      retryAfterMs: 3000,
    });
    const rows = await db.raw<{ role: string }>(
      "select role from osirus.messages where session_id = $1",
      [String(events[0].sessionId)],
    );
    expect(rows.map((r) => r.role)).toEqual(["user"]);
  });

  it("refuses without a model key, a foreign session, or a bad origin", async () => {
    delete process.env.OPENROUTER_API_KEY;
    resetGatewayModelCache();
    const none = await post({ message: "Hallo" });
    expect(none.status).toBe(503);
    expect(await none.json()).toMatchObject({ error: "no_models" });

    process.env.OPENROUTER_API_KEY = "or-test-key";
    const missing = await post({
      message: "Hallo",
      sessionId: "99999999-9999-4999-8999-999999999999",
    });
    expect(missing.status).toBe(404);

    const crossSite = await POST(
      new Request("https://osirus.test/api/chat/stream", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://evil.test",
        },
        body: JSON.stringify({ message: "x" }),
      }),
    );
    expect(crossSite.status).toBe(403);
  });
});
