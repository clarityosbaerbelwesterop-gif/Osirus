import { z } from "zod";
import { describe, expect, it } from "vitest";
import {
  agentDecisionSchema,
  coerceAgentDecision,
  type AgentDecision,
} from "../src/lib/agent/decision";
import { runAgentLoop, type Decider } from "../src/lib/agent/loop";
import type { RunSnapshot } from "../src/lib/runtime/types";
import { latestTodos } from "../src/lib/ui/run-view";
import { ToolRegistry, type ToolContext } from "../src/lib/tools/registry";

// Learned from Cursor and Antigravity: the agent keeps a visible task list,
// and the person can comment on the running work without stopping it.

const context: ToolContext = {
  runId: "11111111-1111-4111-8111-111111111111",
  stageId: "22222222-2222-4222-8222-222222222222",
  armId: "general",
  organizationId: "33333333-3333-4333-8333-333333333333",
  workspaceId: "44444444-4444-4444-8444-444444444444",
};

const registry = () =>
  new ToolRegistry({ approvalGate: async () => "approved" }).register({
    id: "file.write",
    title: "Write",
    summary: "Write a file.",
    trust: "builtin",
    effect: "external",
    risk: "low",
    arms: ["general"],
    inputSchema: z.object({ path: z.string() }),
    run: async () => ({ written: true }),
  });

function scripted(decisions: AgentDecision[]) {
  const prompts: string[] = [];
  let index = 0;
  const decide: Decider = async (input) => {
    prompts.push(input.user);
    const next = decisions[Math.min(index, decisions.length - 1)]!;
    index += 1;
    return next;
  };
  return { decide, prompts };
}

describe("decision: task list", () => {
  it("reads a task list and drops a malformed one instead of the decision", () => {
    const ok = agentDecisionSchema.parse({
      action: "RESPOND",
      summary: "Plan",
      todos: [
        { text: "Repo prüfen" },
        { text: "README schreiben", done: true },
      ],
    });
    expect(ok.todos).toEqual([
      { text: "Repo prüfen", done: false },
      { text: "README schreiben", done: true },
    ]);
    const loose = coerceAgentDecision({
      action: "RESPOND",
      summary: "Plan",
      todos: "erst prüfen, dann schreiben",
    });
    expect(loose.action).toBe("RESPOND");
    expect(loose.todos).toBeUndefined();
  });
});

describe("agent loop: task list and notes", () => {
  it("carries a changed task list on the step and keeps it in the prompt", async () => {
    const todos = [
      { text: "Datei schreiben", done: false },
      { text: "Antworten", done: false },
    ];
    const { decide, prompts } = scripted([
      {
        action: "USE_TOOL",
        summary: "Datei schreiben",
        toolId: "file.write",
        toolInput: { path: "a.md" },
        todos,
      },
      {
        action: "USE_TOOL",
        summary: "Noch eine Datei",
        toolId: "file.write",
        toolInput: { path: "b.md" },
        todos,
      },
      {
        action: "FINISH",
        summary: "Fertig",
        answer: "Erledigt.",
        todos: [
          { text: "Datei schreiben", done: true },
          { text: "Antworten", done: true },
        ],
      },
    ]);
    const result = await runAgentLoop({
      objective: "Schreib zwei Dateien",
      directives: [],
      context: [],
      tools: registry(),
      toolContext: context,
      decide,
    });
    expect(result.status).toBe("finished");
    const carried = result.state.steps.filter((step) => step.todos);
    // Sent three times, changed twice: only the changes reach the person.
    expect(carried).toHaveLength(2);
    expect(carried.at(-1)?.todos?.every((todo) => todo.done)).toBe(true);
    expect(prompts[1]).toContain("- [ ] Datei schreiben");
  });

  it("hands each note to the model once, before its next decision", async () => {
    const reads: number[] = [];
    const { decide, prompts } = scripted([
      {
        action: "USE_TOOL",
        summary: "Datei schreiben",
        toolId: "file.write",
        toolInput: { path: "a.md" },
      },
      { action: "FINISH", summary: "Fertig", answer: "Erledigt." },
    ]);
    const result = await runAgentLoop({
      objective: "Schreib eine Datei",
      directives: [],
      context: [],
      tools: registry(),
      toolContext: context,
      decide,
      hooks: {
        notes: async (after) => {
          reads.push(after);
          return after < 7
            ? [{ sequence: 7, text: "Nimm das vorhandene Repo." }]
            : [];
        },
      },
    });
    expect(result.status).toBe("finished");
    expect(reads).toEqual([0, 7]);
    expect(prompts[0]).toContain("Nimm das vorhandene Repo.");
    expect(prompts[1]).toContain("Nimm das vorhandene Repo.");
    expect(result.state.notes).toEqual(["Nimm das vorhandene Repo."]);
  });

  it("keeps working when notes cannot be read", async () => {
    const { decide } = scripted([
      { action: "FINISH", summary: "Fertig", answer: "Erledigt." },
    ]);
    const result = await runAgentLoop({
      objective: "Antworte",
      directives: [],
      context: [],
      tools: registry(),
      toolContext: context,
      decide,
      hooks: {
        notes: () => {
          throw new Error("db down");
        },
      },
    });
    expect(result.status).toBe("finished");
  });
});

describe("run view: task list", () => {
  it("shows the list of the latest step that carried one", () => {
    const event = (sequence: number, data: Record<string, unknown>) => ({
      id: `e${sequence}`,
      runId: context.runId,
      sequence,
      type: "agent.step",
      visibility: "user" as const,
      summary: "Schritt",
      at: "2026-11-04T12:00:00.000Z",
      data,
    });
    const events: RunSnapshot["events"] = [
      event(1, { todos: [{ text: "A", done: false }] }),
      event(2, { todos: [{ text: "A", done: true }, { text: 5 }] }),
      event(3, {}),
    ];
    expect(latestTodos(events)).toEqual([{ text: "A", done: true }]);
    expect(latestTodos([])).toEqual([]);
  });
});
