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
  "chat-research",
  "connections",
  "settings",
  "approvals",
  "inbox",
  "automations",
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

  await page.route("**/api/health", (route) => json(route, HEALTHY));
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
