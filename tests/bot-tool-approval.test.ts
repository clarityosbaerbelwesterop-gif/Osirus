import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createTestDatabase, type TestDatabase } from "./helpers/pglite";

// Audit 2026-11-15: approving a bot's MCP call read the request, then marked
// it running in a second statement. Two approvals arriving together (a
// double click, two tabs) both read "pending" and both called the tool,
// which reaches outside Osirus. The claim is one conditional update now.

const holder = vi.hoisted(() => ({
  db: null as TestDatabase | null,
  calls: 0,
}));

vi.mock("server-only", () => ({}));
vi.mock("../src/lib/db/client", () => ({
  queryAs: (userId: string, text: string, params?: unknown[]) =>
    holder.db!.queryAs(userId, text, params),
  querySystem: (text: string, params?: unknown[]) =>
    holder.db!.querySystem(text, params),
  db: () => {
    throw new Error("tests never reach Neon");
  },
}));
vi.mock("../src/lib/connectors/mcp-store", () => ({
  mcpToolsForWorkspace: async () => [
    {
      id: "mcp.demo.send",
      title: "Nachricht senden",
      summary: "Sendet eine Nachricht.",
      trust: "mcp",
      effect: "external",
      risk: "medium",
      arms: ["general"],
      inputSchema: z.object({ text: z.string() }),
      run: async () => {
        holder.calls += 1;
        await new Promise((resolve) => setTimeout(resolve, 20));
        return { sent: true };
      },
    },
  ],
}));

const { decideToolRequest } = await import("../src/lib/agents/bot-tools");
const { createChatSession, saveChatMessage } =
  await import("../src/lib/gateway/threads");

let db: TestDatabase;
beforeAll(async () => {
  db = await createTestDatabase();
  holder.db = db;
}, 120_000);
afterAll(async () => {
  await db?.close();
});

async function pendingRequest() {
  const identity = await db.seedTenant(
    `tool-${Math.random().toString(36).slice(2, 7)}`,
  );
  const sessionId = await createChatSession(identity as never, {
    title: "Bot",
    surface: "bot",
  });
  const saved = await saveChatMessage(identity as never, {
    sessionId,
    role: "assistant",
    content: "Gibst du den Aufruf frei?",
    metadata: {
      surface: "ai",
      toolRequest: {
        id: "req-1",
        toolId: "mcp.demo.send",
        label: "Nachricht senden",
        arguments: { text: "Hallo" },
        reason: "Die Person bat darum.",
        status: "pending",
      },
    },
  });
  return { identity, sessionId, messageId: saved.id };
}

describe("approving a bot's tool call", () => {
  it("runs the call once when two approvals arrive together", async () => {
    holder.calls = 0;
    const { identity, sessionId, messageId } = await pendingRequest();
    const decide = () =>
      decideToolRequest(identity as never, {
        sessionId,
        messageId,
        approve: true,
      });
    const [first, second] = await Promise.all([decide(), decide()]);
    expect(holder.calls).toBe(1);
    expect([first?.status, second?.status].sort()).toEqual(["done", "running"]);
    const again = await decide();
    expect(again?.status).toBe("done");
    expect(holder.calls).toBe(1);
  });

  it("does not run a call that was declined a moment earlier", async () => {
    holder.calls = 0;
    const { identity, sessionId, messageId } = await pendingRequest();
    const [declined, approved] = await Promise.all([
      decideToolRequest(identity as never, {
        sessionId,
        messageId,
        approve: false,
      }),
      decideToolRequest(identity as never, {
        sessionId,
        messageId,
        approve: true,
      }),
    ]);
    expect(declined?.status).toBe("denied");
    expect(approved?.status).toBe("denied");
    expect(holder.calls).toBe(0);
  });
});
