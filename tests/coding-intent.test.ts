import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ApprovalCard } from "../src/components/approvals/approval-card";
import { WorkingMotion } from "../src/components/chat/working-motion";
import {
  applyCodingIntent,
  chatSlash,
  codingIntentDecision,
  codingPermissionFromInput,
  codingSlash,
  intendedAction,
} from "../src/lib/coding/intent";
import { showWorkingMotion } from "../src/lib/ui/live-activity";
import { approvalView } from "../src/lib/ui/approval-view";

const NOW = Date.parse("2026-10-03T12:00:00.000Z");

function approval(toolId: string, input: Record<string, unknown>) {
  return approvalView(
    {
      id: "a1",
      run_id: "11111111-1111-4111-8111-111111111111",
      action: `tool:${toolId}`,
      risk: "low",
      status: "requested",
      expires_at: "2026-10-03T13:00:00.000Z",
      request: {
        toolId,
        fingerprint: JSON.stringify({ toolId, input }),
      },
    },
    NOW,
  );
}

describe("the one coding action", () => {
  it("names a file read and a command as one line", () => {
    expect(intendedAction("workspace.read", { path: "src/auth.ts" })).toEqual({
      text: "liest",
      target: "src/auth.ts",
      tail: "",
      diff: [],
    });
    expect(
      intendedAction("workspace.run", { cmd: "npm", args: ["test"] }),
    ).toMatchObject({ text: "führt", target: "npm test", tail: "aus" });
  });

  it("renders a replace as red and green under that line, not a whole file", () => {
    const view = approval("workspace.replace", {
      path: "src/auth.ts",
      search: "return false;",
      replacement: "return true;",
    });
    const html = renderToStaticMarkup(
      createElement(ApprovalCard, {
        approval: view,
        runId: view.runId ?? "run",
        onDecided: () => undefined,
      }),
    );
    expect(html).toContain("liest".replace("liest", "ändert"));
    expect(html).toContain("src/auth.ts");
    expect(html).toContain("diff-remove");
    expect(html).toContain("diff-add");
    expect(html).toContain("-return false;");
    expect(html).toContain("+return true;");
    expect(html).toContain(">Yes<");
    expect(html).not.toContain("Approval needed");
    expect(html).not.toContain("Reject");
    expect(html).not.toContain("Low risk");
    expect(html).not.toContain("Exact input");
    expect(html).not.toContain("<details");
  });

  it("does not dump a long file write", () => {
    const action = intendedAction("workspace.write", {
      path: "src/auth.ts",
      content: Array.from({ length: 40 }, (_, index) => `line ${index}`).join(
        "\n",
      ),
    });
    expect(action?.diff).toEqual([]);
    expect(action?.text).toBe("schreibt");
  });

  it("asks before a read, an edit, and a command, and lets edits pass", () => {
    expect(
      codingIntentDecision({ permission: "ask", toolId: "workspace.read" }),
    ).toBe("ask");
    expect(
      codingIntentDecision({ permission: "ask", toolId: "workspace.run" }),
    ).toBe("ask");
    expect(
      codingIntentDecision({
        permission: "accept-edits",
        toolId: "workspace.replace",
      }),
    ).toBe("allow");
    expect(
      codingIntentDecision({
        permission: "accept-edits",
        toolId: "workspace.read",
      }),
    ).toBe("ask");
    expect(
      codingIntentDecision({ permission: "ask", toolId: "workspace.tree" }),
    ).toBeNull();
    expect(applyCodingIntent("deny", "allow")).toBe("deny");
    expect(
      codingPermissionFromInput({
        surface: "agent",
        coding: { permission: "accept-edits" },
      }),
    ).toBeNull();
    expect(
      codingPermissionFromInput(
        JSON.stringify({
          surface: "coding",
          coding: { permission: "accept-edits" },
        }),
      ),
    ).toBe("accept-edits");
  });
});

describe("slash commands that already exist", () => {
  it("keeps pause, resume, the mode switch, and stop, and skips the rest", () => {
    expect(codingSlash("/pause")).toBe("pause");
    expect(codingSlash("/resume")).toBe("resume");
    expect(codingSlash("/accept-edits")).toBe("accept-edits");
    expect(codingSlash("/ask")).toBe("ask");
    expect(codingSlash("/compact")).toBe("unknown");
    expect(codingSlash("/teleport")).toBe("unknown");
    expect(chatSlash("/stop")).toBe("stop");
    expect(chatSlash("/compact")).toBe("unknown");
    expect(chatSlash("/teleport")).toBe("unknown");
    expect(chatSlash("fix the login")).toBeNull();
  });
});

describe("working motion", () => {
  it("shows only while the run is actually working", () => {
    expect(showWorkingMotion({ label: "Working" })).toBe(true);
    expect(showWorkingMotion({ label: "Starting" })).toBe(true);
    expect(showWorkingMotion({ label: "Needs you" })).toBe(false);
    expect(showWorkingMotion({ label: "Done" })).toBe(false);
    expect(showWorkingMotion({ label: "Couldn't finish" })).toBe(false);
    expect(showWorkingMotion({ label: "Working", paused: true })).toBe(false);
    expect(
      renderToStaticMarkup(createElement(WorkingMotion, { active: false })),
    ).toBe("");
    const live = renderToStaticMarkup(
      createElement(WorkingMotion, { active: true }),
    );
    expect(live).toContain("work-motion");
    expect(live).not.toMatch(/Working|%|token|UnoRouter/);
  });
});
