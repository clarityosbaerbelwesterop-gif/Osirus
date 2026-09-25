import {
  markupChecks,
  QA_VIEWPORTS,
  type BrowserQa,
  type QaCheck,
  type QaReport,
} from "../coding/browser-qa";
import type { SandboxHandle } from "../sandbox/driver";
import { collectScreenshots, type ScreenshotCollection } from "./screenshots";
import { BROWSER_SCRIPT } from "./script";

// The computer/visual arm: a real browser inside the sandbox VM.
//
// The deployed app has no browser, so it drives one where the app under
// test already runs -- in the isolated VM -- and reaches the preview at
// localhost, without publishing anything. The first use installs
// playwright-core and a Chromium build for the VM's Linux from the npm
// registry (the only host the workspace may reach for it). What comes back
// is evidence: HTTP status, console errors, failed requests, the effect of
// each action, accessibility counts, horizontal overflow at desktop, iPad
// and phone width, and screenshots saved in the workspace.

export const BROWSER_PACKAGES = [
  "playwright-core@1.63.0",
  "@sparticuz/chromium@153.0.0",
];
const DIR = ".osirus-browser";

export type BrowserAction =
  | { type: "click"; selector: string }
  | { type: "fill"; selector: string; text: string }
  | { type: "press"; key: string }
  | { type: "wait"; selector: string };

export type BrowserSession = {
  status: number | null;
  title: string | null;
  html: string;
  visibleText?: string;
  consoleErrors: string[];
  failedRequests: string[];
  actions: Array<{
    type: string;
    selector: string | null;
    ok: boolean;
    detail: string;
  }>;
  viewports: QaReport["viewports"];
  a11y: {
    unnamedButtons?: number;
    imagesWithoutAlt?: number;
    unlabelledInputs?: number;
    headings?: number;
  };
  selectors: Array<{ selector: string; count: number }>;
  texts: Array<{ text: string; found: boolean }>;
  error?: string;
};

export class SandboxBrowser implements BrowserQa {
  readonly mode = "browser" as const;
  private ready = false;

  constructor(
    private readonly handle: SandboxHandle,
    private readonly options: {
      /** A local browser (tests); the VM uses @sparticuz/chromium. */
      chromiumPath?: string;
      packages?: string[];
      /** Extra environment for the install (a test's proxy settings). */
      installEnv?: Record<string, string>;
    } = {},
  ) {}

  private async ensure() {
    if (this.ready) return;
    const marker = await this.handle.readFile(`${DIR}/ready`).catch(() => null);
    if (!marker) {
      await this.handle.writeFiles([
        {
          path: `${DIR}/package.json`,
          content: '{"type":"module","private":true}',
        },
      ]);
      const install = await this.handle.runCommand({
        cmd: "npm",
        args: [
          "install",
          "--no-audit",
          "--no-fund",
          "--prefix",
          DIR,
          ...(this.options.packages ?? BROWSER_PACKAGES),
        ],
        env: this.options.installEnv,
        timeoutMs: 300_000,
      });
      if (install.exitCode !== 0)
        throw new Error(
          `browser_install_failed: ${(install.stderr || install.stdout).slice(-300)}`,
        );
      await this.handle.writeFiles([{ path: `${DIR}/ready`, content: "1" }]);
    }
    await this.handle.writeFiles([
      { path: `${DIR}/browser.mjs`, content: BROWSER_SCRIPT },
    ]);
    this.ready = true;
  }

  async session(input: {
    url: string;
    actions?: BrowserAction[];
    selectors?: string[];
    texts?: string[];
  }): Promise<BrowserSession> {
    await this.ensure();
    const payload = Buffer.from(
      JSON.stringify({
        url: input.url,
        actions: input.actions ?? [],
        selectors: input.selectors ?? [],
        texts: input.texts ?? [],
        viewports: QA_VIEWPORTS,
        shotDir: `${DIR}/shots`,
      }),
    ).toString("base64");
    // Start from an empty folder so an image from an earlier session is
    // never passed off as this one's.
    await this.handle.runCommand({
      cmd: "rm",
      args: ["-rf", `${DIR}/shots`],
    });
    await this.handle.runCommand({
      cmd: "mkdir",
      args: ["-p", `${DIR}/shots`],
    });
    const result = await this.handle.runCommand({
      cmd: "node",
      args: [`${DIR}/browser.mjs`, payload],
      env: this.options.chromiumPath
        ? { OSIRUS_CHROMIUM_PATH: this.options.chromiumPath }
        : // The VM is Amazon Linux 2023. This tells @sparticuz/chromium to
          // unpack the shared libraries its Chromium needs there and put
          // them on LD_LIBRARY_PATH; without it the browser exits with 127.
          { AWS_LAMBDA_JS_RUNTIME: "nodejs22.x" },
      timeoutMs: 120_000,
    });
    const marker = result.stdout.lastIndexOf("OSIRUS_REPORT ");
    if (marker < 0)
      throw new Error(
        `browser_failed: ${(result.stderr || result.stdout).slice(-300)}`,
      );
    return JSON.parse(
      result.stdout.slice(marker + "OSIRUS_REPORT ".length),
    ) as BrowserSession;
  }

  /** Read the images the last session saved back out of the sandbox. */
  async screenshots(
    session: Pick<BrowserSession, "viewports">,
  ): Promise<ScreenshotCollection> {
    return collectScreenshots(this.handle, `${DIR}/shots`, session.viewports);
  }

  /** A QA run that also returns the images it took. */
  async runWithScreenshots(
    url: string,
    expectations: { selectors?: string[]; texts?: string[] },
  ): Promise<{ report: QaReport; screenshots: ScreenshotCollection }> {
    const session = await this.session({ url, ...expectations });
    return {
      report: reportFrom(url, session, expectations),
      screenshots: await this.screenshots(session),
    };
  }

  async run(
    url: string,
    expectations: { selectors?: string[]; texts?: string[] },
  ): Promise<QaReport> {
    const session = await this.session({ url, ...expectations });
    return reportFrom(url, session, expectations);
  }
}

export function reportFrom(
  url: string,
  session: BrowserSession,
  expectations: { selectors?: string[]; texts?: string[] },
): QaReport {
  const checks: QaCheck[] = markupChecks(session.html, expectations);
  for (const entry of session.selectors)
    checks.push({
      id: `selector:${entry.selector.slice(0, 40)}`,
      passed: entry.count > 0,
      detail: `${entry.count} element(s) match ${entry.selector}.`,
    });
  checks.push({
    id: "buttons-have-names",
    passed: (session.a11y.unnamedButtons ?? 0) === 0,
    detail: `${session.a11y.unnamedButtons ?? 0} button(s) without an accessible name.`,
  });
  checks.push({
    id: "images-have-alt",
    passed: (session.a11y.imagesWithoutAlt ?? 0) === 0,
    detail: `${session.a11y.imagesWithoutAlt ?? 0} image(s) without alt text.`,
  });
  checks.push({
    id: "inputs-have-labels",
    passed: (session.a11y.unlabelledInputs ?? 0) === 0,
    detail: `${session.a11y.unlabelledInputs ?? 0} form field(s) without a label.`,
  });
  for (const viewport of session.viewports)
    checks.push({
      id: `no-overflow:${viewport.name}`,
      passed: !viewport.horizontalOverflow,
      detail: `No horizontal scroll at ${viewport.name} width.`,
    });
  if (session.error)
    checks.push({ id: "page-loaded", passed: false, detail: session.error });
  return {
    mode: "browser",
    url,
    status: session.status,
    title: session.title,
    consoleErrors: session.consoleErrors,
    failedRequests: session.failedRequests,
    viewports: session.viewports,
    checks,
  };
}
