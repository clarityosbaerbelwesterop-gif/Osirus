import { describe, expect, it } from "vitest";
import {
  applyGrounding,
  groundingFromAttachment,
  groundingFromBrowserSession,
  groundingFromQaReport,
  groundComputerInspectResult,
} from "../src/lib/agent/multimodal-grounding";
import { createTaskState } from "../src/lib/agent/task-state";

describe("multimodal grounding", () => {
  it("grounds a hypothesis from browser DOM evidence", () => {
    const state = createTaskState({
      objective: "Check export screen",
      hypotheses: [
        { id: "h-export", statement: "Export ready is visible on the page." },
      ],
    });
    applyGrounding(
      state,
      groundingFromBrowserSession(
        {
          status: 200,
          title: "Export",
          html: "<h1>Export ready</h1>",
          visibleText: "Export ready",
          consoleErrors: [],
          failedRequests: [],
          actions: [],
          viewports: [
            { name: "desktop", horizontalOverflow: false, screenshotBytes: 0 },
          ],
          a11y: {},
          selectors: [],
          texts: [{ text: "Export ready", found: true }],
        },
        "http://127.0.0.1/",
        { hypothesisIds: ["h-export"], relation: "supports" },
      ),
    );
    expect(state.evidenceRefs.some((ref) => ref.startsWith("browser:"))).toBe(
      true,
    );
    expect(state.hypotheses[0]?.status).toBe("SUPPORTED");
  });

  it("grounds from a QA report with check refs", () => {
    const bundle = groundingFromQaReport({
      mode: "browser",
      url: "http://preview/",
      status: 200,
      title: "Home",
      consoleErrors: [],
      failedRequests: [],
      viewports: [
        { name: "desktop", horizontalOverflow: false, screenshotBytes: 500 },
      ],
      checks: [
        { id: "text:Hello", passed: true, detail: "found" },
        { id: "no-overflow:desktop", passed: true, detail: "ok" },
      ],
    });
    expect(bundle.refs).toContain("qa:browser:http://preview/");
    expect(bundle.refs).toContain("check:text:Hello");
    expect(bundle.relation).toBe("supports");
  });

  it("grounds from attachment chunk locators", () => {
    const state = createTaskState({
      objective: "Read design note",
      hypotheses: [{ id: "h-colour", statement: "Primary colour is #2F6FED." }],
    });
    applyGrounding(
      state,
      groundingFromAttachment("design-1", "chunk-1", "primary colour #2F6FED", {
        hypothesisIds: ["h-colour"],
      }),
    );
    expect(state.evidenceRefs).toContain("attachment:design-1:chunk-1");
    expect(state.hypotheses[0]?.supportingEvidence.length).toBeGreaterThan(0);
  });

  it("grounds computer.inspect tool payloads in the loop shape", () => {
    const state = createTaskState({
      objective: "Use the cart",
      hypotheses: [{ id: "h-count", statement: 'Cart shows "1 item".' }],
    });
    groundComputerInspectResult(
      state,
      {
        url: "http://127.0.0.1:4173/",
        status: 200,
        title: "Cart",
        visibleText: "1 item",
        consoleErrors: [],
        failedRequests: [],
        actions: [{ type: "click", selector: "#add", ok: true, detail: "ok" }],
        layout: [{ viewport: "desktop", horizontalOverflow: false }],
        accessibility: {},
        expectedText: [{ text: "1 item", found: true }],
      },
      ["h-count"],
    );
    expect(state.evidenceRefs.length).toBeGreaterThan(0);
    expect(state.hypotheses[0]?.status).toBe("SUPPORTED");
  });
});
