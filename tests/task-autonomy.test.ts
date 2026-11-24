import { describe, expect, it } from "vitest";
import {
  importantCall,
  taskAutonomyDecision,
  taskAutonomyFromInput,
} from "../src/lib/policy/task-autonomy";

// The Rouge Agent: a task is approved as a whole; only what matters asks.

const tool = (
  id: string,
  effect: "read" | "write" | "external",
  risk: "low" | "medium" | "high",
  trust: "builtin" | "connector" | "mcp" = "connector",
) => ({ id, effect, risk, trust });

describe("a task approved as a whole", () => {
  it("is on for Rouge Agent runs that say so, never for other surfaces", () => {
    expect(taskAutonomyFromInput({ surface: "agent", autonomy: "task" })).toBe(
      "task",
    );
    expect(taskAutonomyFromInput('{"surface":"agent"}')).toBe("ask");
    expect(
      taskAutonomyFromInput({ surface: "coding", autonomy: "task" }),
    ).toBeNull();
    expect(taskAutonomyFromInput("not json")).toBeNull();
  });

  it("lets the everyday steps of the task run without asking", () => {
    for (const step of [
      tool("github.pull_request", "external", "medium"),
      tool("github.issue", "external", "medium"),
      tool("github.repo.create", "external", "medium"),
      tool("sandbox.preview", "external", "medium", "builtin"),
    ])
      expect(
        taskAutonomyDecision({
          autonomy: "task",
          tool: step,
          callInput: {},
          base: "ask",
        }),
        step.id,
      ).toBe("allow");
    expect(
      taskAutonomyDecision({
        autonomy: "task",
        tool: tool("github.file.write", "external", "medium"),
        callInput: { branch: "osirus/fix-typo" },
        base: "ask",
      }),
    ).toBe("allow");
  });

  it("still asks before what matters", () => {
    const ask = (step: ReturnType<typeof tool>, callInput: unknown = {}) =>
      taskAutonomyDecision({
        autonomy: "task",
        tool: step,
        callInput,
        base: "ask",
      });
    // Straight onto the main branch (no branch means the default one).
    expect(ask(tool("github.file.write", "external", "medium"))).toBe("ask");
    expect(
      ask(tool("github.file.write", "external", "medium"), { branch: "main" }),
    ).toBe("ask");
    // A built-in high-risk action.
    expect(ask(tool("billing.charge", "external", "high", "builtin"))).toBe(
      "ask",
    );
    // A third-party tool: once per task (the approval gate remembers it).
    expect(ask(tool("mcp:crm:update", "external", "high", "mcp"))).toBe("ask");
  });

  it("never loosens a deny, and changes nothing when steps are asked", () => {
    expect(
      taskAutonomyDecision({
        autonomy: "task",
        tool: tool("github.issue", "external", "medium"),
        callInput: {},
        base: "deny",
      }),
    ).toBe("deny");
    expect(
      taskAutonomyDecision({
        autonomy: "ask",
        tool: tool("github.issue", "external", "medium"),
        callInput: {},
        base: "ask",
      }),
    ).toBe("ask");
    expect(importantCall(tool("github.issue", "external", "medium"), {})).toBe(
      false,
    );
  });
});
