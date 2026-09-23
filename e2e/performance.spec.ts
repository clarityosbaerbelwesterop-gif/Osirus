import { expect, test } from "@playwright/test";
import { mockApis, openSurface, VIEWPORTS, type Surface } from "./support";

// Performance budgets on the production build: layout stability, largest
// contentful paint on a local server, and the JavaScript each surface ships
// (bytes over the wire, compressed). Budgets sit above today's numbers with
// headroom; a regression past them fails the build rather than drifting.
// The fixture route renders every surface, so its script total is an upper
// bound for the matching product route.

const BUDGET = {
  cls: 0.1,
  lcpMs: 2500,
  scriptKb: 350,
};

const SURFACES: Surface[] = ["chat-empty", "chat-coding", "connections"];

for (const surface of SURFACES) {
  test(`${surface} stays within the performance budget`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize(VIEWPORTS.desktop);
    await mockApis(page);
    let scriptBytes = 0;
    page.on("response", async (response) => {
      if (response.request().resourceType() !== "script") return;
      const sizes = await response
        .request()
        .sizes()
        .catch(() => null);
      if (sizes) scriptBytes += sizes.responseBodySize;
    });
    await page.addInitScript(() => {
      const state = { cls: 0, lcp: 0 };
      (window as unknown as { __perf: typeof state }).__perf = state;
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries() as (PerformanceEntry & {
          value: number;
          hadRecentInput: boolean;
        })[])
          if (!entry.hadRecentInput) state.cls += entry.value;
      }).observe({ type: "layout-shift", buffered: true });
      new PerformanceObserver((list) => {
        const last = list.getEntries().at(-1);
        if (last) state.lcp = last.startTime;
      }).observe({ type: "largest-contentful-paint", buffered: true });
    });
    await openSurface(page, surface);
    await page.waitForTimeout(1000);
    const perf = await page.evaluate(
      () =>
        (window as unknown as { __perf: { cls: number; lcp: number } }).__perf,
    );
    const scriptKb = Math.round(scriptBytes / 1024);
    await testInfo.attach("performance.json", {
      body: JSON.stringify({ surface, ...perf, scriptKb }, null, 2),
      contentType: "application/json",
    });
    console.log(
      `${surface}: CLS ${perf.cls.toFixed(3)}, LCP ${Math.round(perf.lcp)} ms, JS ${scriptKb} KB`,
    );
    expect(perf.cls).toBeLessThan(BUDGET.cls);
    expect(perf.lcp).toBeLessThan(BUDGET.lcpMs);
    expect(scriptKb).toBeLessThan(BUDGET.scriptKb);
  });
}
