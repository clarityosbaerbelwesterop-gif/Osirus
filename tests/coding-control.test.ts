import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { EffortField } from "../src/components/coding/effort-field";
import { EffortMotion } from "../src/components/coding/effort-motion";
import {
  actionLeavesCodingTask,
  navigationLeavesCodingTask,
} from "../src/lib/coding/task-bound";
import {
  codingToolsNeeded,
  routeCodingEffort,
  taskForEffort,
} from "../src/lib/product/effort-router";
import {
  canPauseCodingRun,
  canResumeCodingRun,
} from "../src/lib/runtime/pause";
import { pollNudge } from "../src/lib/runtime/poll-nudge";
import type { RunSnapshot } from "../src/lib/runtime/types";

const grant = {
  repository: "https://github.com/acme/widgets",
  branch: "main",
};

describe("coding effort router", () => {
  it("keeps a chosen level and does not replace it", () => {
    const routed = routeCodingEffort({
      chosen: "leicht",
      task: "think harder and redesign the whole repository",
      toolsNeeded: true,
    });
    expect(routed).toEqual({ effort: "leicht", source: "chosen" });
  });

  it("suggests from the task when nobody has chosen", () => {
    expect(
      routeCodingEffort({
        chosen: null,
        task: "fix the failing login bug in the session file",
        toolsNeeded: codingToolsNeeded(
          "fix the failing login bug in the session file",
        ),
      }).effort,
    ).toBe("hoch");
    expect(
      routeCodingEffort({
        chosen: null,
        task: "think harder about the migration",
        toolsNeeded: true,
      }),
    ).toEqual({ effort: "ultra", source: "suggested" });
    expect(
      routeCodingEffort({
        chosen: null,
        task: "keep it light, just a note",
        toolsNeeded: true,
      }).effort,
    ).toBe("leicht");
  });

  it("ignores the repository lines appended at start", () => {
    expect(
      taskForEffort("Rename the label\nhttps://github.com/acme/widgets\nmain"),
    ).toBe("Rename the label");
  });

  it("shows a suggestion as text and a choice as chosen", () => {
    const suggested = renderToStaticMarkup(
      createElement(EffortField, {
        chosen: null,
        suggestion: "hoch",
        onChoose: () => undefined,
      }),
    );
    expect(suggested).toContain("Suggestion: Hoch");
    expect(suggested).toContain('data-chosen="false"');
    expect(suggested).not.toContain("effort-chosen-mark");
    expect(suggested).not.toMatch(/%|badge|pill/);
    const chosen = renderToStaticMarkup(
      createElement(EffortField, {
        chosen: "mittel",
        suggestion: "ultra",
        onChoose: () => undefined,
      }),
    );
    expect(chosen).toContain("Chosen");
    expect(chosen).toContain('value="mittel"');
    expect(chosen).not.toContain("Suggestion:");
    const motion = renderToStaticMarkup(
      createElement(EffortMotion, { effort: "hoch", active: false }),
    );
    expect(motion).toBe("");
  });
});

describe("coding run stops when an action leaves the task", () => {
  it("stops a branch or repository change and ignores file checkout", () => {
    expect(
      actionLeavesCodingTask({
        ...grant,
        toolId: "workspace.run",
        toolInput: { cmd: "git", args: ["switch", "other"] },
      }),
    ).toBe("other_branch");
    expect(
      actionLeavesCodingTask({
        ...grant,
        toolId: "workspace.run",
        toolInput: { cmd: "git", args: ["checkout", "--", "src/a.ts"] },
      }),
    ).toBeNull();
    expect(
      actionLeavesCodingTask({
        ...grant,
        toolId: "workspace.run",
        toolInput: {
          cmd: "git",
          args: ["clone", "https://github.com/other/repo"],
        },
      }),
    ).toBe("other_repository");
  });

  it("treats leaving Coding as leaving the in-progress task", () => {
    const current = new URL("https://osirus.example/app/coding?session=a");
    expect(
      navigationLeavesCodingTask(
        new URL("https://osirus.example/app"),
        current,
      ),
    ).toBe(true);
    expect(
      navigationLeavesCodingTask(
        new URL("https://osirus.example/app/coding?session=a"),
        current,
      ),
    ).toBe(false);
    expect(
      navigationLeavesCodingTask(
        new URL("https://osirus.example/app/coding?new=1"),
        current,
      ),
    ).toBe(true);
  });
});

describe("pause and resume the same coding run", () => {
  it("allows pause only while a coding run is in progress", () => {
    expect(
      canPauseCodingRun({ coding: true, status: "running", paused: false }),
    ).toBe(true);
    expect(
      canPauseCodingRun({ coding: true, status: "running", paused: true }),
    ).toBe(false);
    expect(
      canPauseCodingRun({ coding: true, status: "completed", paused: false }),
    ).toBe(false);
    expect(
      canPauseCodingRun({ coding: false, status: "running", paused: false }),
    ).toBe(false);
    expect(
      canResumeCodingRun({ coding: true, status: "running", paused: true }),
    ).toBe(true);
    expect(
      canResumeCodingRun({ coding: true, status: "running", paused: false }),
    ).toBe(false);
  });

  it("does not drive a paused run", () => {
    const snapshot = {
      run: {
        id: "run",
        sessionId: "session",
        objective: "fix it",
        status: "running",
        cancelRequested: false,
        pausedAt: "2026-10-03T14:00:00.000Z",
      },
      stages: [{ status: "pending" }],
      attempts: [],
      dependencies: [],
      artifacts: [],
      approvals: [],
      events: [],
      checkpoints: [],
      messages: [],
    } as unknown as RunSnapshot;
    expect(pollNudge(snapshot)).toEqual({
      settleCancel: false,
      drive: false,
      finalize: false,
    });
  });
});
