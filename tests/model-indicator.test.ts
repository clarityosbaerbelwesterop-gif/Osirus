import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
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

// Per-message model indicator: the chat shows which model actually served a
// run, read from osirus.model_calls against a real Postgres (PGlite) with
// every migration and row-level security applied. Never fabricated: a run
// without a completed model call renders no caption.

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
  auth: { getSession: async () => ({ data: { session: null } }) },
}));

// The Markdown pipeline loads lazily in the browser; the caption tests are
// about the caption, so the dynamic import resolves to an inert stub.
vi.mock("next/dynamic", () => ({
  default: () => {
    const Stub = () => null;
    return Stub;
  },
}));

const { RuntimeRepository } = await import("../src/lib/runtime/repository");
const { MessageList } = await import("../src/components/chat/message-list");

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
  tenant = await db.seedTenant("model-indicator");
});

async function seedSessionWithRun(label: string) {
  const repository = new RuntimeRepository(tenant.userId);
  const sessionId = await repository.createSession({
    organizationId: tenant.organizationId,
    workspaceId: tenant.workspaceId,
    title: label,
  });
  const [run] = await db.raw<{ id: string }>(
    `insert into osirus.runs (organization_id, workspace_id, session_id,
       requested_by, objective, primary_capability, complexity, status)
     values ($1, $2, $3, $4, $5, 'general', 'low', 'completed')
     returning id`,
    [
      tenant.organizationId,
      tenant.workspaceId,
      sessionId,
      tenant.userId,
      `objective of ${label}`,
    ],
  );
  return { repository, sessionId, runId: run!.id };
}

describe("RuntimeRepository.modelCallsForSession", () => {
  it("returns the latest completed call for a run, ignoring started ones", async () => {
    const { repository, sessionId, runId } =
      await seedSessionWithRun("latest-completed");
    await repository.createMessage({
      organizationId: tenant.organizationId,
      workspaceId: tenant.workspaceId,
      sessionId,
      runId,
      role: "assistant",
      content: "First answer",
    });
    const first = await repository.createModelCall({
      organizationId: tenant.organizationId,
      workspaceId: tenant.workspaceId,
      runId,
      stageId: null,
      model: "grok-4-fast",
      role: "answer",
    });
    await repository.finishModelCall(first, {
      status: "completed",
      inputTokens: 800,
      outputTokens: 400,
      latencyMs: 820,
    });
    const second = await repository.createModelCall({
      organizationId: tenant.organizationId,
      workspaceId: tenant.workspaceId,
      runId,
      stageId: null,
      model: "claude-sonnet-4-5",
      role: "answer",
    });
    await repository.finishModelCall(second, {
      status: "completed",
      inputTokens: 10,
      outputTokens: 5,
      latencyMs: 100,
    });
    // A still-running call must never displace a completed one.
    await repository.createModelCall({
      organizationId: tenant.organizationId,
      workspaceId: tenant.workspaceId,
      runId,
      stageId: null,
      model: "never-finished-model",
      role: "answer",
    });

    const map = await repository.modelCallsForSession(sessionId);
    expect(map[runId]?.model).toBe("claude-sonnet-4-5");
    expect(map[runId]?.inputTokens).toBe(10);
    expect(map[runId]?.outputTokens).toBe(5);
    expect(map[runId]?.latencyMs).toBe(100);
  });

  it("omits runs without a completed model call", async () => {
    const { repository, sessionId, runId } =
      await seedSessionWithRun("no-completed");
    await repository.createMessage({
      organizationId: tenant.organizationId,
      workspaceId: tenant.workspaceId,
      sessionId,
      runId,
      role: "assistant",
      content: "Answer without a finished call",
    });
    const started = await repository.createModelCall({
      organizationId: tenant.organizationId,
      workspaceId: tenant.workspaceId,
      runId,
      stageId: null,
      model: "grok-4-fast",
      role: "answer",
    });
    await repository.finishModelCall(started, { status: "failed" });

    const map = await repository.modelCallsForSession(sessionId);
    expect(map[runId]).toBeUndefined();
    expect(Object.keys(map)).toHaveLength(0);
  });

  it("returns nothing for another tenant's session (RLS)", async () => {
    const { repository, sessionId, runId } =
      await seedSessionWithRun("cross-tenant");
    await repository.createMessage({
      organizationId: tenant.organizationId,
      workspaceId: tenant.workspaceId,
      sessionId,
      runId,
      role: "assistant",
      content: "Tenant one answer",
    });
    const call = await repository.createModelCall({
      organizationId: tenant.organizationId,
      workspaceId: tenant.workspaceId,
      runId,
      stageId: null,
      model: "grok-4-fast",
      role: "answer",
    });
    await repository.finishModelCall(call, { status: "completed" });

    const other = await db.seedTenant("model-indicator-other");
    const foreign = new RuntimeRepository(other.userId);
    expect(await foreign.modelCallsForSession(sessionId)).toEqual({});
  });
});

describe("RuntimeRepository.getSessionState", () => {
  it("carries run ids on messages and the model map for the chat", async () => {
    const { repository, sessionId, runId } =
      await seedSessionWithRun("session-state");
    await repository.createMessage({
      organizationId: tenant.organizationId,
      workspaceId: tenant.workspaceId,
      sessionId,
      runId,
      role: "user",
      content: "Question",
    });
    await repository.createMessage({
      organizationId: tenant.organizationId,
      workspaceId: tenant.workspaceId,
      sessionId,
      runId,
      role: "assistant",
      content: "Answer",
    });
    const call = await repository.createModelCall({
      organizationId: tenant.organizationId,
      workspaceId: tenant.workspaceId,
      runId,
      stageId: null,
      model: "grok-4-fast",
      role: "answer",
    });
    await repository.finishModelCall(call, {
      status: "completed",
      inputTokens: 900,
      outputTokens: 300,
      latencyMs: 640,
    });

    const state = await repository.getSessionState(
      sessionId,
      tenant.workspaceId,
    );
    const answer = state.messages.find(
      (message) => message.role === "assistant",
    );
    expect(answer?.runId).toBe(runId);
    expect(state.modelCalls[runId]?.model).toBe("grok-4-fast");
    expect(state.modelCalls[runId]?.outputTokens).toBe(300);
  });
});

describe("MessageList model caption", () => {
  const baseMessage = {
    id: "m1",
    role: "assistant" as const,
    content: "Here is the answer.",
    runId: "run-1",
  };

  it("does not show a catalog model id or a token count", () => {
    const html = renderToStaticMarkup(
      createElement(MessageList, {
        messages: [baseMessage],
        runObjective: null,
        runSlot: null,
        streamingId: null,
      }),
    );
    expect(html).not.toContain("grok");
    expect(html).not.toContain("tokens");
    expect(html).not.toContain("UnoRouter");
    expect(html).not.toContain("message-model");
  });

  it("shows only the selected program name, not a native checkpoint", () => {
    const html = renderToStaticMarkup(
      createElement(MessageList, {
        messages: [
          {
            ...baseMessage,
            caption: "ROUGE 1. Not a native checkpoint.",
          },
        ],
        runObjective: null,
        runSlot: null,
        streamingId: null,
      }),
    );
    expect(html).toContain("ROUGE 1. Not a native checkpoint.");
    expect(html).not.toContain("qwen");
    expect(html).not.toContain("UnoRouter");
  });
});
