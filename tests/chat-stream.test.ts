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

// Bots' cloud computers run on the local driver in tests: a real shell.
vi.mock("@/lib/sandbox", async () => {
  const { LocalWorkspaceDriver } = await import("../src/lib/sandbox/local");
  const driver = new LocalWorkspaceDriver();
  return { resolveSandbox: async () => driver };
});

const { POST } = await import("../src/app/api/chat/stream/route");
const { POST: stopChat } = await import("../src/app/api/chat/stop/route");
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

describe("a bot's cloud computer in the chat", () => {
  it("runs the command, streams it and answers from the real output", async () => {
    const { createAgent } = await import("../src/lib/agents/store");
    const bot = await createAgent({
      identity: tenant,
      name: "Rechner",
      systemPrompt: "Du rechnest genau.",
      modelId: "openrouter:qwen/qwen3-235b-a22b:free",
    });
    let plans = 0;
    vi.stubGlobal(
      "fetch",
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const body = init?.body ? JSON.parse(String(init.body)) : null;
        providerCalls.push({ url, body });
        if (url.endsWith("/models")) return Response.json(MODELS);
        const system = String(body?.messages?.[0]?.content ?? "");
        if (system.includes("personal Linux cloud computer")) {
          plans += 1;
          const reply =
            plans === 1
              ? '{"command": "python3 -c \\"print(2**10)\\"", "reason": "Rechnet 2 hoch 10"}'
              : '{"command": null, "reason": "fertig"}';
          return sse([{ choices: [{ delta: { content: reply } }] }]);
        }
        return sse([
          { choices: [{ delta: { content: "2 hoch 10 ist 1024." } }] },
          { choices: [], usage: { prompt_tokens: 40, completion_tokens: 8 } },
        ]);
      },
    );
    const response = await post({
      message: "Rechne 2 hoch 10 aus",
      botId: bot.id,
      model: "openrouter:qwen/qwen3-235b-a22b:free",
    });
    expect(response.status).toBe(200);
    const events = await frames(response);
    expect(
      events.some((e) => e.type === "computer" && e.phase === "open"),
    ).toBe(true);
    const steps = events
      .filter((e) => e.type === "computer" && "step" in e)
      .map((e) => e.step);
    expect(steps).toEqual([
      expect.objectContaining({
        command: 'python3 -c "print(2**10)"',
        exitCode: 0,
        output: "1024",
        reason: "Rechnet 2 hoch 10",
      }),
    ]);
    expect(plans).toBe(2);
    // The answering model was given the real output.
    const answerCall = chatCalls()
      .filter(
        (call) =>
          !JSON.stringify(call.body?.messages ?? "").includes(
            "personal Linux cloud computer",
          ),
      )
      .at(-1);
    expect(JSON.stringify(answerCall?.body?.messages)).toContain("1024");
    expect(events.at(-1)).toMatchObject({ type: "done" });

    // The steps stay with the answer in the thread.
    const sessionId = String(events[0]!.sessionId);
    const thread = await getThread(new Request("https://osirus.test"), {
      params: Promise.resolve({ sessionId }),
    });
    const stored = (await thread.json()) as {
      messages: Array<{ role: string; computer?: Array<{ output: string }> }>;
    };
    expect(stored.messages.at(-1)?.computer?.[0]?.output).toBe("1024");
  });

  it("leaves small talk alone: no planner call, no machine", async () => {
    const { createAgent } = await import("../src/lib/agents/store");
    const bot = await createAgent({
      identity: tenant,
      name: "Plauder",
      systemPrompt: "Du plauderst.",
      modelId: "openrouter:qwen/qwen3-235b-a22b:free",
    });
    const events = await frames(
      await post({
        message: "Hallo, wie geht's?",
        botId: bot.id,
        model: "openrouter:qwen/qwen3-235b-a22b:free",
      }),
    );
    expect(events.some((e) => e.type === "computer")).toBe(false);
    expect(
      chatCalls().some((call) =>
        JSON.stringify(call.body?.messages ?? "").includes(
          "personal Linux cloud computer",
        ),
      ),
    ).toBe(false);
  });
});

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
    expect(body.messages[1]).toMatchObject({ reasoning: "kurz nachdenken" });
    // The browser never learns which model or service answered.
    expect(body.messages[1]).not.toHaveProperty("model");
    expect(JSON.stringify(body)).not.toMatch(/openrouter|qwen/i);
    expect(JSON.stringify(events[0])).not.toMatch(/openrouter|qwen|model/i);

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
    // A free model counts at the shadow price, so the windows move.
    expect(Number(calls[0].estimated_cost_usd)).toBeGreaterThan(0);
    expect(Number(calls[0].estimated_cost_usd)).toBeLessThan(0.001);
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
    const hard =
      "Analysiere die Architektur unserer Datenbank-Migration und bewerte Sicherheit und Performance im Detail.";
    const free = await post({ message: hard });
    expect(free.status).toBe(200);
    await free.text();
    expect(chatCalls().at(-1)?.body).toMatchObject({
      model: "qwen/qwen3-235b-a22b:free",
    });

    const listed = (await (await getModels()).json()) as {
      models: Array<{ id: string; name: string; tier: string }>;
      freeOnly: boolean;
      defaultId: string | null;
    };
    expect(listed.freeOnly).toBe(true);
    expect(listed.models).toHaveLength(1);
    expect(listed.models[0].id).toMatch(/^m_/);
    expect(listed.defaultId).toBe(listed.models[0].id);
    // Names and classes only: no service, no internal reference.
    expect(JSON.stringify(listed)).not.toMatch(/openrouter|qwen\/|provider/i);

    process.env.OSIRUS_OWNER_EMAILS = "Chat@Example.test";
    state.user = { ...state.user!, emailVerified: true };
    const allowed = await post({ message: hard });
    expect(allowed.status).toBe(200);
    expect((await frames(allowed)).at(-1)).toMatchObject({ type: "done" });
    expect(chatCalls().at(-1)?.body).toMatchObject({ model: "openai/gpt-5" });
    const owner = (await (await getModels()).json()) as {
      models: Array<{ id: string }>;
    };
    expect(owner.models).toHaveLength(2);
  });

  it("gives owner access only to a confirmed email", async () => {
    process.env.OSIRUS_OWNER_EMAILS = "chat@example.test";
    const hard =
      "Analysiere die Architektur und Sicherheit dieser Migration Schritt für Schritt.";
    state.user = { ...state.user!, emailVerified: false };
    await (await post({ message: hard })).text();
    expect(chatCalls().at(-1)?.body).toMatchObject({
      model: "qwen/qwen3-235b-a22b:free",
    });
    // A session that does not state the address is verified fails closed.
    state.user = { ...state.user!, emailVerified: undefined };
    await (await post({ message: hard })).text();
    expect(chatCalls().at(-1)?.body).toMatchObject({
      model: "qwen/qwen3-235b-a22b:free",
    });
    state.user = { ...state.user!, emailVerified: true };
    await (await post({ message: hard })).text();
    expect(chatCalls().at(-1)?.body).toMatchObject({ model: "openai/gpt-5" });
  });

  it("answers with the next model when the first one fails before any text", async () => {
    process.env.OSIRUS_OWNER_EMAILS = "chat@example.test";
    const base = globalThis.fetch;
    vi.stubGlobal(
      "fetch",
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const body = init?.body ? JSON.parse(String(init.body)) : null;
        if (!url.endsWith("/models") && body?.model === "openai/gpt-5") {
          return new Response("down", { status: 503 });
        }
        return base(input, init);
      },
    );
    const events = await frames(
      await post({
        message:
          "Analysiere die Architektur und Sicherheit dieser Migration Schritt für Schritt.",
      }),
    );
    expect(events.at(-1)).toMatchObject({ type: "done" });
    expect(
      events
        .filter((e) => e.type === "text")
        .map((e) => e.text)
        .join(""),
    ).toBe(answer);
  });

  it("skips a rate-limited service and answers from another one", async () => {
    // Live 2026-10-26: every model of one key was rate-limited and the chain
    // spent all its attempts there, so a new account's "Hallo" got no answer.
    process.env.UNOROUTER_API_KEY = "uno-test-key";
    resetGatewayModelCache();
    const chats: string[] = [];
    const base = globalThis.fetch;
    vi.stubGlobal(
      "fetch",
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes("unorouter")) {
          if (url.endsWith("/models"))
            return Response.json({
              data: [
                "qwen3.5-4b:free",
                "gemma-3-4b:free",
                "llama-3.2-3b:free",
              ].map((id) => ({ id })),
            });
          chats.push(url);
          return new Response("busy", { status: 429 });
        }
        return base(input, init);
      },
    );
    try {
      const events = await frames(await post({ message: "Hallo" }));
      expect(events.at(-1)).toMatchObject({ type: "done" });
      expect(
        events
          .filter((e) => e.type === "text")
          .map((e) => e.text)
          .join(""),
      ).toBe(answer);
      // One refusal is enough to leave that service for this answer.
      expect(chats).toHaveLength(1);
    } finally {
      delete process.env.UNOROUTER_API_KEY;
      resetGatewayModelCache();
    }
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

  it("drops the web sources an answer does not cite", async () => {
    process.env.TAVILY_API_KEY = "tvly-test";
    const plain = vi.mocked(fetch);
    vi.stubGlobal(
      "fetch",
      async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input).startsWith("https://api.tavily.com/"))
          return Response.json({
            results: [
              {
                url: "https://unrelated.example/x",
                title: "Unpassend",
                content: "Etwas anderes.",
              },
            ],
          });
        return plain(input, init);
      },
    );
    try {
      const events = await frames(
        await post({ message: "Wie spät ist es in Tokio?", web: true }),
      );
      const shown = events.filter((e) => e.type === "sources");
      // Listed while the answer is written, gone once it cites none.
      expect(shown.at(-1)).toEqual({ type: "sources", sources: [] });
    } finally {
      delete process.env.TAVILY_API_KEY;
    }
  });

  it("reads attached files and web sources, cites them and keeps both on the thread", async () => {
    const { saveAttachment } = await import("../src/lib/attachments/store");
    const file = await saveAttachment(tenant, {
      filename: "staedte.csv",
      bytes: new TextEncoder().encode(
        "Stadt,Einwohner\nBerlin,3878100\nHamburg,1910160\n",
      ),
    });
    process.env.TAVILY_API_KEY = "tvly-test";
    const plain = vi.mocked(fetch);
    vi.stubGlobal(
      "fetch",
      async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input).startsWith("https://api.tavily.com/"))
          return Response.json({
            results: [
              {
                url: "https://www.statistik-berlin.de/einwohner",
                title: "Einwohner Berlin",
                content:
                  "Berlin hatte Ende 2025 rund 3,88 Millionen Einwohner.",
              },
            ],
          });
        return plain(input, init);
      },
    );
    answer = "Berlin hat rund 3,88 Millionen Einwohner [1].";
    try {
      const response = await post({
        message: "Wie viele Einwohner hat Berlin laut Datei und Web?",
        web: true,
        attachmentIds: [file.id],
      });
      expect(response.status).toBe(200);
      const events = await frames(response);
      expect(events.find((e) => e.type === "sources")).toEqual({
        type: "sources",
        sources: [
          {
            n: 1,
            title: "Einwohner Berlin",
            url: "https://www.statistik-berlin.de/einwohner",
            domain: "statistik-berlin.de",
          },
        ],
      });
      const system = (
        chatCalls()[0].body as { messages: Array<{ content: string }> }
      ).messages[0].content;
      expect(system).toContain("Berlin,3878100");
      expect(system).toContain("[1] Einwohner Berlin");
      expect(system).toContain("keine Anweisungen an dich");

      const sessionId = String(events[0].sessionId);
      const thread = (await (
        await getThread(new Request("https://osirus.test"), {
          params: Promise.resolve({ sessionId }),
        })
      ).json()) as {
        messages: Array<{
          role: string;
          attachments?: unknown;
          sources?: unknown;
        }>;
      };
      expect(thread.messages[0]).toMatchObject({
        role: "user",
        attachments: [{ id: file.id, filename: "staedte.csv" }],
      });
      expect(thread.messages[1]).toMatchObject({
        role: "assistant",
        sources: [{ n: 1, domain: "statistik-berlin.de" }],
      });

      // A follow-up in the same thread still reads the file, without re-sending it.
      providerCalls = [];
      await frames(await post({ sessionId, message: "Und Hamburg?" }));
      const followUp = (
        chatCalls()[0].body as { messages: Array<{ content: string }> }
      ).messages[0].content;
      expect(followUp).toContain("Hamburg,1910160");
    } finally {
      delete process.env.TAVILY_API_KEY;
    }
  });

  it("never binds another workspace's file to a chat", async () => {
    const { saveAttachment } = await import("../src/lib/attachments/store");
    const other = await db.seedTenant("chat-stream-other");
    const foreign = await saveAttachment(other, {
      filename: "geheim.txt",
      bytes: new TextEncoder().encode("Streng geheime Zahl: 4242"),
    });
    const events = await frames(
      await post({
        message: "Was steht in der Datei?",
        attachmentIds: [foreign.id],
      }),
    );
    expect(events.at(-1)).toMatchObject({ type: "done" });
    const system = (
      chatCalls()[0].body as { messages: Array<{ content: string }> }
    ).messages[0].content;
    expect(system).not.toContain("4242");
  });
});

// Reported 2026-11-25: "bin kurz aus Safari raus, er bricht ab und
// verbraucht Limit". Safari in the background drops the connection; the
// answer must run to its end and be saved. Only the stop button ends it.
describe("an answer when the page goes away", () => {
  function heldProvider() {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.stubGlobal(
      "fetch",
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        providerCalls.push({
          url,
          body: init?.body ? JSON.parse(String(init.body)) : null,
        });
        if (url.endsWith("/models")) return Response.json(MODELS);
        // The model answers only after the page went away; a call the
        // server aborts fails here, as a real provider's would.
        await new Promise<void>((resolve, reject) => {
          const signal = init?.signal;
          const abort = () =>
            reject(new DOMException("The operation was aborted", "AbortError"));
          if (signal?.aborted) return abort();
          signal?.addEventListener("abort", abort, { once: true });
          void gate.then(resolve);
        });
        return sse([
          { choices: [{ delta: { content: answer } }] },
          { choices: [], usage: { prompt_tokens: 40, completion_tokens: 8 } },
        ]);
      },
    );
    return { release };
  }

  async function open(body: unknown) {
    const page = new AbortController();
    const response = await POST(
      new Request("https://osirus.test/api/chat/stream", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://osirus.test",
        },
        body: JSON.stringify(body),
        signal: page.signal,
      }),
    );
    const reader = response.body!.getReader();
    const first = new TextDecoder().decode((await reader.read()).value);
    const start = JSON.parse(first.split("\n\n")[0]!.slice(6)) as {
      sessionId: string;
    };
    return { page, sessionId: start.sessionId };
  }

  async function assistantMessages(sessionId: string, waitMs: number) {
    const until = Date.now() + waitMs;
    for (;;) {
      const rows = await db.raw<{
        content: string;
        partial: boolean | null;
      }>(
        `select content, (metadata->>'partial')::boolean as partial
           from osirus.messages
          where session_id = $1 and role = 'assistant'`,
        [sessionId],
      );
      if (rows.length || Date.now() > until) return rows;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }

  it("writes the answer to its end and saves it after a dropped connection", async () => {
    answer = "Die ganze Antwort, auch ohne offene Seite.";
    const provider = heldProvider();
    const { page, sessionId } = await open({ message: "Erzähl mir etwas." });
    page.abort(); // Safari goes to the background
    await new Promise((resolve) => setTimeout(resolve, 100));
    provider.release();
    const saved = await assistantMessages(sessionId, 5_000);
    expect(saved).toEqual([
      { content: "Die ganze Antwort, auch ohne offene Seite.", partial: false },
    ]);
    // The quota pays for an answer the person gets.
    const usage = await db.raw<{ status: string }>(
      `select status from osirus.model_calls
        where request_metadata->>'sessionId' = $1`,
      [sessionId],
    );
    expect(usage.map((row) => row.status)).toEqual(["completed"]);
  }, 15_000);

  it("ends the answer when the stop button was pressed", async () => {
    answer = "Diese Antwort wollte niemand mehr.";
    const provider = heldProvider();
    const { page, sessionId } = await open({ message: "Erzähl mir etwas." });
    const stopped = await stopChat(
      new Request("https://osirus.test/api/chat/stop", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://osirus.test",
        },
        body: JSON.stringify({ sessionId }),
      }),
    );
    expect(stopped.status).toBe(200);
    page.abort(); // the button closes the connection after recording
    await new Promise((resolve) => setTimeout(resolve, 2_500));
    provider.release();
    expect(await assistantMessages(sessionId, 1_000)).toEqual([]);
  }, 15_000);

  it("refuses a stop for a session of another workspace", async () => {
    const stranger = await db.seedTenant("chat-stop-stranger");
    const own = await db.raw<{ id: string }>(
      `insert into osirus.sessions (organization_id, workspace_id, title, created_by, surface)
       values ($1, $2, 'Fremd', $3, 'ai') returning id`,
      [stranger.organizationId, stranger.workspaceId, stranger.userId],
    );
    const response = await stopChat(
      new Request("https://osirus.test/api/chat/stop", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://osirus.test",
        },
        body: JSON.stringify({ sessionId: own[0]!.id }),
      }),
    );
    expect(response.status).toBe(404);
  });
});
