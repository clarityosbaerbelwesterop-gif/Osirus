import { describe, expect, it, vi } from "vitest";
import {
  parseToolPlan,
  toolErrorText,
  toolPlanMessages,
} from "../src/lib/agents/bot-tool-plan";

vi.mock("server-only", () => ({}));
const { collapseRegenerations } = await import("../src/lib/gateway/threads");

const tools = ["mcp.abc123.list_issues", "mcp.abc123.create_issue"];

describe("bot tool planning", () => {
  it("takes a tool from the catalog with its arguments", () => {
    const plan = parseToolPlan(
      'Klar. {"tool": "mcp.abc123.list_issues", "arguments": {"state": "open"}, "reason": "Offene Issues abrufen."}',
      tools,
    );
    expect(plan).toEqual({
      toolId: "mcp.abc123.list_issues",
      arguments: { state: "open" },
      reason: "Offene Issues abrufen.",
    });
  });

  it("means no tool for null, unknown ids, broken JSON or oversized input", () => {
    expect(parseToolPlan('{"tool": null}', tools)).toBeNull();
    expect(
      parseToolPlan('{"tool": "mcp.other.delete_all", "arguments": {}}', tools),
    ).toBeNull();
    expect(
      parseToolPlan('{"tool": "mcp.abc123.list_issues", "arguments": ', tools),
    ).toBeNull();
    expect(parseToolPlan("Keine Werkzeuge nötig.", tools)).toBeNull();
    expect(
      parseToolPlan(
        JSON.stringify({
          tool: tools[0],
          arguments: { body: "x".repeat(9_000) },
        }),
        tools,
      ),
    ).toBeNull();
  });

  it("reads braces inside strings without losing the object", () => {
    const plan = parseToolPlan(
      '{"tool": "mcp.abc123.create_issue", "arguments": {"title": "Fix {braces} in \\"parser\\""}, "reason": "Issue anlegen."}',
      tools,
    );
    expect(plan?.arguments).toEqual({ title: 'Fix {braces} in "parser"' });
  });

  it("takes a short id from the planner and maps it to the catalog", () => {
    expect(
      parseToolPlan(
        '{"tool": "t2", "arguments": {"title": "Bug"}, "reason": "Issue anlegen."}',
        tools,
      )?.toolId,
    ).toBe("mcp.abc123.create_issue");
    expect(
      parseToolPlan('{"tool": "T1", "arguments": {}}', tools)?.toolId,
    ).toBe("mcp.abc123.list_issues");
    expect(parseToolPlan('{"tool": "t9", "arguments": {}}', tools)).toBeNull();
  });

  it("lists every tool by short id for the planner and keeps the message as the user turn", () => {
    const messages = toolPlanMessages({
      botName: "Lena",
      message: "Welche Issues sind offen?",
      tools: tools.map((id) => ({ id, title: id, summary: "GitHub issues" })),
    });
    expect(messages[0]!.content).toContain("- t1: mcp.abc123.list_issues");
    expect(messages[0]!.content).toContain("- t2: mcp.abc123.create_issue");
    expect(messages[0]!.content).toContain('"tool"');
    expect(messages[1]).toEqual({
      role: "user",
      content: "Welche Issues sind offen?",
    });
  });
});

describe("tool errors the person reads", () => {
  it("names an oversized answer, a timeout and a refused token in German", () => {
    expect(
      toolErrorText(new Error("outbound_blocked:response_too_large")),
    ).toContain("zu groß");
    expect(
      toolErrorText(new Error("The operation was aborted due to timeout")),
    ).toContain("rechtzeitig");
    expect(toolErrorText(new Error("mcp_unauthorized:401"))).toContain("Token");
    expect(toolErrorText(new Error("mcp_tool_error: x"))).toBe(
      "mcp_tool_error: x",
    );
  });
});

describe("thread collapse", () => {
  it("keeps a bot's tool request when its answer follows", () => {
    const thread = [
      { role: "user" },
      { role: "assistant", toolRequest: { id: "t" } },
      { role: "assistant" },
    ];
    expect(collapseRegenerations(thread)).toHaveLength(3);
    expect(
      collapseRegenerations([
        { role: "user" },
        { role: "assistant" },
        { role: "assistant" },
      ]),
    ).toHaveLength(2);
  });
});
