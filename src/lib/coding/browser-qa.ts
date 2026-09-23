import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { isSafeRelativePath } from "../sandbox/driver";
import type { CodingWorkspace } from "./workspace";

// Checking a built interface.
//
// Two implementations, labelled differently on purpose. BrowserQa drives a
// real browser (Playwright) and sees what a user sees: console errors, failed
// requests, rendered landmarks, layout at phone and iPad width. The HTTP check
// only fetches the page; it can say the preview answers and what the markup
// contains, and it reports itself as "http", never as browser QA. Which one
// ran is part of the evidence.

export type QaViewport = { name: string; width: number; height: number };

export const QA_VIEWPORTS: QaViewport[] = [
  { name: "desktop", width: 1280, height: 800 },
  { name: "ipad", width: 820, height: 1180 },
  { name: "phone", width: 390, height: 844 },
];

export type QaCheck = { id: string; passed: boolean; detail: string };

export type QaReport = {
  mode: "browser" | "http" | "unavailable";
  url: string;
  status: number | null;
  title: string | null;
  consoleErrors: string[];
  failedRequests: string[];
  viewports: Array<{
    name: string;
    horizontalOverflow: boolean;
    screenshotBytes: number;
  }>;
  checks: QaCheck[];
  reason?: string;
};

export interface BrowserQa {
  readonly mode: "browser" | "http";
  run(
    url: string,
    expectations: { selectors?: string[]; texts?: string[] },
  ): Promise<QaReport>;
}

export function qaPassed(report: QaReport) {
  return (
    report.mode !== "unavailable" &&
    report.status !== null &&
    report.status < 400 &&
    report.consoleErrors.length === 0 &&
    report.checks.every((check) => check.passed)
  );
}

/** Markup-level checks shared by both implementations. */
export function markupChecks(
  html: string,
  expectations: { selectors?: string[]; texts?: string[] },
): QaCheck[] {
  const checks: QaCheck[] = [];
  const lower = html.toLowerCase();
  checks.push({
    id: "has-title",
    passed: /<title>[^<]+<\/title>/i.test(html),
    detail: "The document has a non-empty <title>.",
  });
  checks.push({
    id: "has-lang",
    passed: /<html[^>]*\blang=/i.test(html),
    detail: "The <html> element declares a language.",
  });
  checks.push({
    id: "has-viewport-meta",
    passed: /<meta[^>]+name=["']viewport["']/i.test(html),
    detail: "A viewport meta tag is present (needed for phone and iPad).",
  });
  const imagesWithoutAlt = (html.match(/<img(?![^>]*\balt=)[^>]*>/gi) ?? [])
    .length;
  checks.push({
    id: "images-have-alt",
    passed: imagesWithoutAlt === 0,
    detail: `${imagesWithoutAlt} image(s) without alt text.`,
  });
  for (const text of expectations.texts ?? []) {
    checks.push({
      id: `text:${text.slice(0, 40)}`,
      passed: lower.includes(text.toLowerCase()),
      detail: `Expected text "${text.slice(0, 80)}" in the page.`,
    });
  }
  return checks;
}

/** Fetch-only preview check. Honest about being less than browser QA. */
export class HttpPreviewCheck implements BrowserQa {
  readonly mode = "http" as const;

  async run(
    url: string,
    expectations: { selectors?: string[]; texts?: string[] },
  ): Promise<QaReport> {
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(15_000),
        redirect: "follow",
      });
      const html = (await response.text()).slice(0, 2_000_000);
      const title = html.match(/<title>([^<]*)<\/title>/i)?.[1]?.trim() ?? null;
      return {
        mode: "http",
        url,
        status: response.status,
        title,
        consoleErrors: [],
        failedRequests: [],
        viewports: [],
        checks: [
          ...markupChecks(html, expectations),
          ...(expectations.selectors ?? []).map((selector) => ({
            id: `selector:${selector.slice(0, 40)}`,
            // Without a DOM only id selectors can be checked from markup.
            passed: selector.startsWith("#")
              ? new RegExp(`id=["']${selector.slice(1)}["']`).test(html)
              : false,
            detail: selector.startsWith("#")
              ? `Element ${selector} present in the markup.`
              : `Selector ${selector} needs a browser to check.`,
          })),
        ],
      };
    } catch (error) {
      return {
        mode: "unavailable",
        url,
        status: null,
        title: null,
        consoleErrors: [],
        failedRequests: [],
        viewports: [],
        checks: [],
        reason: error instanceof Error ? error.message : "fetch_failed",
      };
    }
  }
}

const CONTENT_TYPES: Record<string, string> = {
  html: "text/html; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  mjs: "text/javascript; charset=utf-8",
  css: "text/css; charset=utf-8",
  json: "application/json",
  svg: "image/svg+xml",
  txt: "text/plain; charset=utf-8",
};

/**
 * Serve a workspace directory over HTTP on 127.0.0.1, for QA.
 *
 * Files are read through the workspace API, so the same path checks apply as
 * for the agent's own reads. Only used where a browser runs next to the
 * process (tests, CI, live evals); a deployed function has no browser to
 * point at it.
 */
export async function serveWorkspaceDirectory(
  workspace: CodingWorkspace,
  directory: string,
) {
  const server = createServer((request, response) => {
    void (async () => {
      const pathname = decodeURIComponent(
        new URL(request.url ?? "/", "http://localhost").pathname,
      );
      let relative = pathname.replace(/^\/+/, "") || "index.html";
      if (relative.endsWith("/")) relative += "index.html";
      const full = directory === "." ? relative : `${directory}/${relative}`;
      if (!isSafeRelativePath(full)) {
        response.writeHead(400).end();
        return;
      }
      try {
        const content = await workspace.read(full, 5_000_000);
        const extension = relative.split(".").pop() ?? "";
        response.writeHead(200, {
          "content-type":
            CONTENT_TYPES[extension] ?? "application/octet-stream",
        });
        response.end(content);
      } catch {
        response.writeHead(404).end("not found");
      }
    })();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
