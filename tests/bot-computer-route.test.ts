import { beforeEach, describe, expect, it, vi } from "vitest";
import type { z } from "zod";

// The bot computer API: the owner's bots only, validated actions only, and
// every action becomes one Open Terminal call on the bot's own machine.

const state = vi.hoisted(() => ({
  bot: { id: "8a6f3c1e-1d2b-4c3d-9e4f-5a6b7c8d9e0f", name: "Rechner" } as {
    id: string;
    name: string;
  } | null,
  calls: [] as Array<{
    method: string;
    path: string;
    query?: unknown;
    body?: unknown;
  }>,
  opened: [] as string[],
  saved: 0,
}));

vi.mock("@/lib/product/api", () => ({
  json: (body: unknown, status = 200) => Response.json(body, { status }),
  guardWrite: async (request: Request, input: { schema: z.ZodTypeAny }) => {
    const parsed = input.schema.safeParse(await request.json());
    if (!parsed.success)
      return {
        ok: false,
        response: Response.json({ error: "invalid_request" }, { status: 400 }),
      };
    return {
      ok: true,
      identity: { userId: "u", workspaceId: "ws" },
      body: parsed.data,
    };
  },
}));
vi.mock("@/lib/agents/store", () => ({ getAgent: async () => state.bot }));
vi.mock("@/lib/sandbox", () => ({
  resolveSandbox: async () => ({
    availability: () => ({ configured: true, driver: "test", reason: "" }),
  }),
}));
vi.mock("@/lib/agents/bot-computer", () => ({
  openComputer: async (_driver: unknown, name: string) => {
    state.opened.push(name);
    return { keepAlive: async () => undefined };
  },
  saveFolder: async () => {
    state.saved += 1;
    return true;
  },
}));
vi.mock("@/lib/agents/bot-computer-files", () => ({
  databaseComputerFiles: () => ({
    load: async () => null,
    save: async () => true,
  }),
}));
vi.mock("@/lib/agents/open-terminal", () => ({
  ensureOpenTerminal: async () => undefined,
  callOpenTerminal: async (
    _machine: unknown,
    request: { method: string; path: string; query?: unknown; body?: unknown },
  ) => {
    state.calls.push(request);
    return {
      status: 200,
      body: { id: "p1", status: "done", log_path: "/home/x/.local/p1.jsonl" },
    };
  },
}));

beforeEach(() => {
  state.bot = { id: "8a6f3c1e-1d2b-4c3d-9e4f-5a6b7c8d9e0f", name: "Rechner" };
  state.calls = [];
  state.opened = [];
  state.saved = 0;
});

async function post(body: unknown, agentId = state.bot?.id ?? "x") {
  const { POST } =
    await import("../src/app/api/agents/[agentId]/computer/route");
  return POST(
    new Request("https://osirus-ai.com/api/agents/x/computer", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ agentId }) },
  );
}

describe("a bot's computer API", () => {
  it("runs a command on the bot's own machine", async () => {
    const response = await post({ action: "run", command: "python3 -V" });
    expect(response.status).toBe(200);
    expect(state.opened).toEqual([expect.stringMatching(/^osirus-pc-/)]);
    expect(state.calls).toEqual([
      {
        method: "POST",
        path: "/execute",
        query: { wait: 20 },
        body: { command: "python3 -V" },
      },
    ]);
    // What the command changed is kept at once.
    expect(state.saved).toBe(1);
    // Paths on the machine are not handed to the browser.
    expect(JSON.stringify(await response.json())).not.toContain("log_path");
  });

  it("maps files, processes and kill to Open Terminal", async () => {
    await post({ action: "files", path: "daten" });
    await post({ action: "processes" });
    await post({ action: "kill", id: "20261124-1-ab" });
    expect(state.calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      "GET /files/list",
      "GET /execute",
      "DELETE /execute/20261124-1-ab",
    ]);
  });

  it("refuses other people's bots, bad ids and unknown actions", async () => {
    state.bot = null;
    expect(
      (
        await post(
          { action: "processes" },
          "8a6f3c1e-1d2b-4c3d-9e4f-5a6b7c8d9e0f",
        )
      ).status,
    ).toBe(404);
    expect((await post({ action: "processes" }, "not-a-uuid")).status).toBe(
      400,
    );
    state.bot = { id: "8a6f3c1e-1d2b-4c3d-9e4f-5a6b7c8d9e0f", name: "R" };
    expect((await post({ action: "kill", id: "../../etc" })).status).toBe(400);
    expect((await post({ action: "shutdown" })).status).toBe(400);
    expect(state.calls).toEqual([]);
  });
});
