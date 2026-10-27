import type { Page, Route } from "@playwright/test";
import type { RunSnapshot } from "../src/lib/runtime/types";
import {
  FIXTURE_IDS,
  codingRunFixture,
  researchFixture,
  workspaceFixture,
} from "../src/app/ui-fixtures/fixtures";

// Shared setup for the UI suites. The fixture surfaces render the real
// components with deterministic data; the client calls those components make
// are answered here, so no test depends on a database, a model or a sandbox.

export const SURFACES = [
  "chat-empty",
  "chat-active",
  "chat-coding",
  "coding",
  "chat-research",
  "connections",
  "settings",
  "approvals",
  "inbox",
  "automations",
  "intelligence",
  "work",
  "agents",
  "agents-empty",
  "agents-thread",
  "agents-room",
  "agents-group",
  "history",
  "rouge-empty",
  "tour",
] as const;
export type Surface = (typeof SURFACES)[number];

export const VIEWPORTS = {
  phone: { width: 375, height: 812 },
  tablet: { width: 768, height: 1024 },
  laptop: { width: 1024, height: 768 },
  desktop: { width: 1440, height: 900 },
} as const;

export const PREVIEW_URL = "https://fixture-3000.vercel.run/";

const HEALTHY = {
  status: "ok",
  service: "osirus",
  checks: { auth: true, database: true, provider: true },
  capabilities: { sandbox: "vercel", sandboxReason: null },
};

type Json = Record<string, unknown> | unknown[];
const json = (route: Route, body: Json, status = 200) =>
  route.fulfill({ status, json: body });

export type ApiLog = { method: string; path: string; body: unknown }[];

/**
 * Answer the client calls of the fixture surfaces. Returns the list of write
 * requests the page made, so journeys can assert what was sent.
 */
/** The model list Code's picker receives: opaque ids, names and classes. */
export const MODELS_FIXTURE = {
  defaultId: "m_gpt5aaaaaaaaaaaaa",
  freeOnly: false,
  models: [
    {
      id: "m_gpt5aaaaaaaaaaaaa",
      name: "GPT-5",
      tier: "top",
      free: false,
      reasoning: true,
      contextLength: 400000,
    },
    {
      id: "m_sonnetaaaaaaaaaaa",
      name: "Claude Sonnet 4.5",
      tier: "top",
      free: false,
      reasoning: false,
      contextLength: 200000,
    },
    {
      id: "m_r1aaaaaaaaaaaaaaa",
      name: "DeepSeek R1",
      tier: "top",
      free: true,
      reasoning: true,
      contextLength: 128000,
    },
    {
      id: "m_llamaaaaaaaaaaaaa",
      name: "Llama 3.3 70B Instruct",
      tier: "balanced",
      free: true,
      reasoning: false,
      contextLength: 128000,
    },
  ],
};

export const CHAT_SESSION = "5f6a7b8c-9d0e-4f1a-8b2c-3d4e5f6a7b8c";

/** A complete Agents answer as server-sent events. */
export function chatStreamBody(answer = "Hallo! Wie kann ich helfen?") {
  const frames = [
    {
      type: "start",
      sessionId: CHAT_SESSION,
      title: "Hallo",
      created: true,
      cached: false,
    },
    { type: "reasoning", text: "Begrüßung, kurz antworten." },
    { type: "text", text: answer.slice(0, 7) },
    { type: "text", text: answer.slice(7) },
    {
      type: "done",
      messageId: "6a7b8c9d-0e1f-4a2b-8c3d-4e5f6a7b8c9d",
      latencyMs: 420,
    },
  ];
  return frames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join("");
}

export async function mockApis(
  page: Page,
  options: { runSnapshot?: () => RunSnapshot | null } = {},
): Promise<ApiLog> {
  const log: ApiLog = [];
  const record = (route: Route) => {
    const request = route.request();
    if (request.method() !== "GET") {
      let body: unknown = null;
      try {
        body = request.postDataJSON();
      } catch {
        body = request.postData();
      }
      log.push({
        method: request.method(),
        path: new URL(request.url()).pathname,
        body,
      });
    }
  };

  await page.context().addCookies([
    {
      name: "osirus-consent",
      value: "necessary",
      url: process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000",
    },
  ]);
  await page.route("**/api/health", (route) => json(route, HEALTHY));
  await page.route("**/api/models", (route) => json(route, MODELS_FIXTURE));
  await page.route("**/api/chat/stream", (route) => {
    record(route);
    return route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: chatStreamBody(),
    });
  });
  await page.route("**/api/connectors/github/repos", (route) => {
    record(route);
    return json(route, {
      ok: true,
      repositories: [
        {
          owner: "osirus-demo",
          name: "stats-lib",
          private: false,
          defaultBranch: "main",
        },
      ],
    });
  });
  await page.route("**/api/connectors/github/branches**", (route) => {
    record(route);
    return json(route, { ok: true, branches: ["main", "dev"] });
  });
  await page.route("**/api/connectors/github", (route) => {
    record(route);
    return json(route, {
      status: "CONNECTED",
      login: "baerbel",
      scopes: ["contents:read", "contents:write", "pull_requests:write"],
    });
  });
  await page.route("**/api/workspaces/**", (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/file"))
      return json(route, {
        content:
          "export function median(values: number[]) {\n  const sorted = [...values].sort((a, b) => a - b);\n}\n",
      });
    return json(route, {
      ...workspaceFixture,
      workspace: { ...workspaceFixture.workspace, previewUrl: PREVIEW_URL },
    });
  });
  await page.route(`${PREVIEW_URL}**`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/html",
      body: "<!doctype html><title>Preview</title><h1>stats-lib demo</h1>",
    }),
  );
  await page.route("**/api/research/**", (route) =>
    json(route, researchFixture),
  );
  await page.route("**/api/runtime/**", (route) => {
    record(route);
    const request = route.request();
    if (request.method() === "GET") {
      const snapshot = options.runSnapshot?.() ?? codingRunFixture("done");
      return snapshot
        ? json(route, snapshot)
        : json(route, { error: "not_found" }, 404);
    }
    return json(route, { ok: true });
  });
  await page.route("**/api/sessions/**", (route) => {
    record(route);
    return json(route, { ok: true });
  });
  await page.route("**/api/group-chats/*/messages", (route) => {
    record(route);
    if (route.request().method() === "GET")
      return json(route, { messages: [] });
    const body = route.request().postDataJSON() as { content?: string };
    const asksBea = /@(Bea|alle)\b/i.test(body.content ?? "");
    return json(route, {
      replyRule: "mentions-only",
      replies: asksBea
        ? [
            {
              agentId: "22222222-2222-4222-8222-222222222222",
              name: "Bea",
              status: "completed",
              text: "Gern: zuerst die Freigaben.",
            },
          ]
        : [],
    });
  });
  await page.route("**/api/group-chats", (route) => {
    record(route);
    return json(
      route,
      { chat: { id: "66666666-6666-4666-8666-666666666666", title: "Team" } },
      201,
    );
  });
  await page.route("**/api/agents", (route) => {
    record(route);
    return json(
      route,
      {
        agent: {
          id: "77777777-7777-4777-8777-777777777777",
          name: "Cleo",
          status: "active",
          tier: "balanced",
        },
      },
      201,
    );
  });
  for (const pattern of [
    "**/api/mcp/**",
    "**/api/automations**",
    "**/api/notifications",
    "**/api/policy",
    "**/api/memory/**",
  ]) {
    await page.route(pattern, (route) => {
      record(route);
      return json(route, { ok: true, result: { ok: true, toolCount: 2 } });
    });
  }
  return log;
}

/** Open a fixture surface and wait until fonts and the status line settle. */
export async function openSurface(page: Page, surface: Surface) {
  await page.goto(`/ui-fixtures/${surface}`, { waitUntil: "load" });
  await page.evaluate(() => document.fonts.ready);
  await page
    .locator(".status-line")
    .filter({ hasText: /Online|Degraded|unavailable/ })
    .first()
    .waitFor({ state: "attached", timeout: 5_000 })
    .catch(() => undefined);
}

export async function horizontalOverflow(page: Page) {
  return page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );
}

export { FIXTURE_IDS };
