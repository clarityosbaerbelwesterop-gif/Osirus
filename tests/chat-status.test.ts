import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RunCard } from "../src/components/run-status/run-card";
import {
  chatRunPresentation,
  chatStatusLine,
  customerProgramCaption,
} from "../src/lib/ui/chat-status";
import type { RunView } from "../src/lib/ui/run-view";

function view(overrides: Partial<RunView> = {}): RunView {
  return {
    runId: "run-1",
    objective: "Fix it",
    status: "running",
    statusLabel: "Working",
    tone: "accent",
    live: true,
    armId: "coding",
    armLabel: "Coding",
    composition: [],
    stages: [
      {
        id: "s1",
        name: "Ground the objective",
        state: "running",
        stateLabel: "In progress",
        durationMs: null,
        verdictLabel: null,
        verdictTone: null,
        waitsOn: [],
      },
    ],
    doneCount: 1,
    totalCount: 7,
    progress: 1 / 7,
    current: {
      id: "s1",
      name: "Ground the objective",
      state: "running",
      stateLabel: "In progress",
      durationMs: null,
      verdictLabel: null,
      verdictTone: null,
      waitsOn: [],
    },
    currentStep: "Ground the objective",
    evidence: [
      { id: "e1", label: "Routed to Coding", at: "2026-10-03T00:00:00.000Z" },
    ],
    pendingApprovals: [],
    approvals: [],
    failure: null,
    memoryCount: null,
    ...overrides,
  };
}

describe("chat run status", () => {
  it("uses only the five customer states", () => {
    expect(chatRunPresentation("created").label).toBe("Starting");
    expect(chatRunPresentation("queued").label).toBe("Starting");
    expect(chatRunPresentation("running").label).toBe("Working");
    expect(chatRunPresentation("planning").label).toBe("Working");
    expect(chatRunPresentation("verifying").label).toBe("Working");
    expect(chatRunPresentation("waiting_for_approval").label).toBe("Needs you");
    expect(chatRunPresentation("completed").label).toBe("Done");
    expect(chatRunPresentation("failed").label).toBe("Couldn't finish");
    expect(chatRunPresentation("cancelled").label).toBe("Couldn't finish");
  });

  it("uses the honest failure sentence and not a stage name", () => {
    expect(
      chatStatusLine(
        "failed",
        "The model provider is limiting requests right now. The run waits and retries automatically; you can also try again in a few minutes.",
      ),
    ).not.toMatch(/ground|qwen|UnoRouter|token/i);
  });

  it("keeps the selected name and does not claim a native checkpoint", () => {
    expect(customerProgramCaption("ROUGE 1 · API fallback")).toBe(
      "ROUGE 1. Not a native checkpoint.",
    );
    expect(customerProgramCaption("QUASNIR · API fallback")).toContain(
      "QUASNIR",
    );
    expect(
      customerProgramCaption("ROUGE-1 / api_fallback / UnoRouter / qwen3:free"),
    ).toBeNull();
    expect(customerProgramCaption("eye2-qwen")).toBeNull();
  });
});

describe("RunCard while a run is in progress", () => {
  it("shows one status line and a badge, with steps closed", () => {
    const html = renderToStaticMarkup(
      createElement(RunCard, {
        view: view(),
        resumed: true,
        onRefresh: () => undefined,
        onOpenWorkbench: () => undefined,
      }),
    );
    expect(html).toContain(">Working<");
    expect(html).toContain('role="status"');
    expect(html).not.toContain("1 of 7");
    expect(html).not.toContain("run-progress");
    expect(html).not.toContain("<details open");
    expect(html).toContain(">Details<");
    expect(html).not.toMatch(/<p[^>]*>[^<]*Ground the objective/);
  });

  it("shows the honest error instead of an internal stage", () => {
    const html = renderToStaticMarkup(
      createElement(RunCard, {
        view: view({
          status: "failed",
          live: true,
          failure: {
            stage: "Ground the objective",
            message: "This step ran out of time.",
          },
        }),
        resumed: false,
        onRefresh: () => undefined,
        onOpenWorkbench: null,
      }),
    );
    expect(html).toContain("Couldn&#x27;t finish");
    expect(html).toContain("This step ran out of time.");
    expect(html).not.toContain("Ground the objective:");
  });
});
