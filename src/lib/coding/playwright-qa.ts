import {
  markupChecks,
  QA_VIEWPORTS,
  type BrowserQa,
  type QaReport,
} from "./browser-qa";

// Real browser QA with Playwright.
//
// Imported only by tests and the live-eval runner, never by app code: the
// deployed functions have no browser, and pulling Playwright into the server
// bundle would not change that. Where it runs, it reports what a user would
// hit -- console errors, failed requests, horizontal overflow at iPad and
// phone width -- as evidence the verifier can read.

export class PlaywrightQa implements BrowserQa {
  readonly mode = "browser" as const;

  constructor(private readonly executablePath?: string) {}

  async run(
    url: string,
    expectations: { selectors?: string[]; texts?: string[] },
  ): Promise<QaReport> {
    const { chromium } = await import("playwright-core");
    const browser = await chromium.launch({
      executablePath: this.executablePath ?? process.env.OSIRUS_CHROMIUM_PATH,
      args: ["--no-sandbox"],
    });
    const consoleErrors: string[] = [];
    const failedRequests: string[] = [];
    try {
      const page = await browser.newPage();
      // The browser asks for /favicon.ico on its own; a page that never
      // referenced one is not broken because it is missing.
      const isFavicon = (url: string) => /\/favicon\.ico(\?|$)/.test(url);
      page.on("console", (message) => {
        if (message.type() === "error" && !isFavicon(message.location().url))
          consoleErrors.push(message.text().slice(0, 300));
      });
      page.on("pageerror", (error) =>
        consoleErrors.push(`pageerror: ${error.message.slice(0, 300)}`),
      );
      page.on("requestfailed", (request) => {
        if (!isFavicon(request.url()))
          failedRequests.push(`${request.method()} ${request.url()}`);
      });
      page.on("response", (response) => {
        if (response.status() >= 400 && !isFavicon(response.url()))
          failedRequests.push(`${response.status()} ${response.url()}`);
      });
      const response = await page.goto(url, {
        waitUntil: "networkidle",
        timeout: 20_000,
      });
      const html = await page.content();
      const title = await page.title();
      const checks = markupChecks(html, expectations);
      for (const selector of expectations.selectors ?? []) {
        const count = await page.locator(selector).count();
        checks.push({
          id: `selector:${selector.slice(0, 40)}`,
          passed: count > 0,
          detail: `${count} element(s) match ${selector}.`,
        });
      }
      const unnamedButtons = await page
        .locator("button")
        .evaluateAll(
          (buttons) =>
            buttons.filter(
              (button) =>
                !(button.textContent ?? "").trim() &&
                !button.getAttribute("aria-label"),
            ).length,
        );
      checks.push({
        id: "buttons-have-names",
        passed: unnamedButtons === 0,
        detail: `${unnamedButtons} button(s) without an accessible name.`,
      });

      const viewports: QaReport["viewports"] = [];
      for (const viewport of QA_VIEWPORTS) {
        await page.setViewportSize({
          width: viewport.width,
          height: viewport.height,
        });
        const overflow = await page.evaluate(
          () =>
            document.documentElement.scrollWidth >
            document.documentElement.clientWidth + 1,
        );
        const screenshot = await page.screenshot({ fullPage: false });
        viewports.push({
          name: viewport.name,
          horizontalOverflow: overflow,
          screenshotBytes: screenshot.length,
        });
        checks.push({
          id: `no-overflow:${viewport.name}`,
          passed: !overflow,
          detail: `No horizontal scroll at ${viewport.width}px (${viewport.name}).`,
        });
      }
      return {
        mode: "browser",
        url,
        status: response?.status() ?? null,
        title,
        consoleErrors,
        failedRequests,
        viewports,
        checks,
      };
    } finally {
      await browser.close();
    }
  }
}
