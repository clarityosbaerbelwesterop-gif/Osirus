import { describe, expect, it } from "vitest";
import {
  evidenceRefsForBrowser,
  formatObserveActVerify,
  observeActVerifyFromSession,
  verifyBrowserSession,
} from "../src/lib/agent/observe-act-verify";

const PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Cart</title></head>
<body><h1>Cart</h1><button id="add">Add item</button><p id="count">1 item</p></body></html>`;

describe("observe-act-verify", () => {
  it("grades a fixture session against probes", () => {
    const session = {
      status: 200,
      title: "Cart",
      html: PAGE,
      visibleText: "Cart\nAdd item\n1 item",
      consoleErrors: [],
      failedRequests: [],
      actions: [
        { type: "click", selector: "#add", ok: true, detail: "clicked" },
      ],
      viewports: [
        { name: "desktop", horizontalOverflow: false, screenshotBytes: 1200 },
        { name: "ipad", horizontalOverflow: false, screenshotBytes: 900 },
        { name: "phone", horizontalOverflow: false, screenshotBytes: 800 },
      ],
      a11y: { unnamedButtons: 0, imagesWithoutAlt: 0, unlabelledInputs: 0 },
      selectors: [{ selector: "#add", count: 1 }],
      texts: [{ text: "1 item", found: true }],
    };
    const result = observeActVerifyFromSession(
      "http://127.0.0.1:4173/",
      session,
      {
        selectors: ["#add"],
        texts: ["1 item"],
      },
    );
    expect(result.observe.title).toBe("Cart");
    expect(result.acts).toHaveLength(1);
    expect(result.verify.passed).toBe(true);
    expect(result.evidenceRefs).toContain("browser:http://127.0.0.1:4173/");
    expect(
      result.evidenceRefs.some((ref) => ref.startsWith("screenshot:")),
    ).toBe(true);
    expect(formatObserveActVerify(result)).toMatch(/Verify \(browser\)/);
  });

  it("reports failed checks without claiming success", () => {
    const session = {
      status: 200,
      title: "Cart",
      html: PAGE,
      visibleText: "Cart",
      consoleErrors: ["boom"],
      failedRequests: [],
      actions: [],
      viewports: [
        { name: "phone", horizontalOverflow: true, screenshotBytes: 0 },
      ],
      a11y: { unnamedButtons: 1, imagesWithoutAlt: 0, unlabelledInputs: 0 },
      selectors: [{ selector: "#add", count: 1 }],
      texts: [{ text: "1 item", found: false }],
    };
    const verify = verifyBrowserSession("http://127.0.0.1/", session, {
      texts: ["1 item"],
    });
    expect(verify.passed).toBe(false);
    expect(verify.failedCheckIds.length).toBeGreaterThan(0);
  });

  it("collects evidence refs from actions and screenshots", () => {
    const refs = evidenceRefsForBrowser("http://localhost/", {
      status: 200,
      title: "T",
      html: "",
      actions: [{ type: "click", selector: "#x", ok: true, detail: "ok" }],
      viewports: [
        { name: "desktop", horizontalOverflow: false, screenshotBytes: 1 },
      ],
      consoleErrors: [],
      failedRequests: [],
      a11y: {},
      selectors: [],
      texts: [{ text: "hello", found: true }],
    });
    expect(refs).toEqual(
      expect.arrayContaining([
        "browser:http://localhost/",
        "screenshot:desktop",
        "text:hello",
        "action:click:#x",
      ]),
    );
  });
});
