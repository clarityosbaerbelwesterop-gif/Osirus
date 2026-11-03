import { z } from "zod";
import { describe, expect, it } from "vitest";
import type { AgentDecision } from "../src/lib/agent/decision";
import {
  callSignature,
  repeatedCallNote,
  runAgentLoop,
  type Decider,
} from "../src/lib/agent/loop";
import { ToolRegistry, type ToolContext } from "../src/lib/tools/registry";

// The Rouge Agent once asked fifty times to create a repository that already
// existed: the stage was retried from scratch after a slow reply, and every
// identical failed call was made again. These tests pin the guard.

const context: ToolContext = {
  runId: "11111111-1111-4111-8111-111111111111",
  stageId: "22222222-2222-4222-8222-222222222222",
  armId: "building",
  organizationId: "33333333-3333-4333-8333-333333333333",
  workspaceId: "44444444-4444-4444-8444-444444444444",
};

function tools(counter: { create: number; read: number; flaky: number }) {
  return new ToolRegistry({ approvalGate: async () => "approved" })
    .register({
      id: "repo.create",
      title: "Create",
      summary: "Create a repository.",
      trust: "builtin",
      effect: "external",
      risk: "medium",
      arms: ["building"],
      inputSchema: z.object({ name: z.string() }),
      run: async () => {
        counter.create += 1;
        throw new Error(
          "github_422: Repository creation failed.: name already exists on this account",
        );
      },
    })
    .register({
      id: "file.write",
      title: "Write",
      summary: "Write a file.",
      trust: "builtin",
      effect: "external",
      risk: "medium",
      arms: ["building"],
      inputSchema: z.object({ path: z.string() }),
      run: async () => ({ written: true }),
    })
    .register({
      id: "repo.read",
      title: "Read",
      summary: "Read the repository.",
      trust: "builtin",
      effect: "read",
      risk: "low",
      arms: ["building"],
      inputSchema: z.object({ name: z.string() }),
      run: async () => {
        counter.read += 1;
        return { files: ["README.md"] };
      },
    })
    .register({
      id: "net.flaky",
      title: "Flaky",
      summary: "Times out once.",
      trust: "builtin",
      effect: "external",
      risk: "low",
      arms: ["building"],
      inputSchema: z.object({ id: z.string() }),
      run: async () => {
        counter.flaky += 1;
        if (counter.flaky === 1) throw new Error("fetch failed: timeout");
        return { ok: true };
      },
    });
}

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

const create: AgentDecision = {
  action: "USE_TOOL",
  summary: "Repo Goal anlegen",
  toolId: "repo.create",
  toolInput: { name: "Goal" },
};

describe("agent loop: identical calls", () => {
  it("stops repeating a call that keeps failing, and says why", async () => {
    const counter = { create: 0, read: 0, flaky: 0 };
    const { decide, prompts } = scripted([
      create,
      create,
      create,
      create,
      {
        action: "FINISH",
        summary: "Fertig",
        answer: "Repo existiert bereits.",
      },
    ]);
    const result = await runAgentLoop({
      objective: "Lege das Repo Goal an",
      directives: [],
      context: [],
      tools: tools(counter),
      toolContext: context,
      decide,
      bounds: { maxConsecutiveFailures: 5 },
    });
    // One identical retry, then never again: two calls, not fifty.
    expect(counter.create).toBe(2);
    expect(result.status).toBe("finished");
    expect(
      result.state.steps.filter((step) => step.detail === "repeated_call"),
    ).toHaveLength(2);
    expect(prompts[3]).toContain("already failed 2 times");
    // The reason GitHub gave reaches the model, not just a status code.
    expect(prompts[1]).toContain("name already exists");
  });

  it("does not make a change twice once it succeeded", async () => {
    const counter = { create: 0, read: 0, flaky: 0 };
    const write: AgentDecision = {
      action: "USE_TOOL",
      summary: "README schreiben",
      toolId: "file.write",
      toolInput: { path: "README.md" },
    };
    const { decide, prompts } = scripted([
      write,
      write,
      { action: "FINISH", summary: "Fertig", answer: "README geschrieben." },
    ]);
    const result = await runAgentLoop({
      objective: "README",
      directives: [],
      context: [],
      tools: tools(counter),
      toolContext: context,
      decide,
    });
    expect(result.state.toolCalls).toBe(1);
    expect(prompts[2]).toContain("already succeeded");
  });

  it("lets a read repeat a few times, then points at the result", async () => {
    const counter = { create: 0, read: 0, flaky: 0 };
    const read: AgentDecision = {
      action: "USE_TOOL",
      summary: "Repo lesen",
      toolId: "repo.read",
      toolInput: { name: "Goal" },
    };
    const { decide } = scripted([
      read,
      read,
      read,
      read,
      { action: "FINISH", summary: "Fertig", answer: "ok" },
    ]);
    await runAgentLoop({
      objective: "Lesen",
      directives: [],
      context: [],
      tools: tools(counter),
      toolContext: context,
      decide,
    });
    expect(counter.read).toBe(3);
  });

  it("allows one identical retry after a timeout", async () => {
    const counter = { create: 0, read: 0, flaky: 0 };
    const call: AgentDecision = {
      action: "USE_TOOL",
      summary: "Senden",
      toolId: "net.flaky",
      toolInput: { id: "a" },
    };
    const { decide } = scripted([
      call,
      call,
      { action: "FINISH", summary: "Fertig", answer: "ok" },
    ]);
    await runAgentLoop({
      objective: "Senden",
      directives: [],
      context: [],
      tools: tools(counter),
      toolContext: context,
      decide,
    });
    expect(counter.flaky).toBe(2);
  });

  it("keeps the guard across a resumed slice", async () => {
    const counter = { create: 0, read: 0, flaky: 0 };
    const first = await runAgentLoop({
      objective: "Goal",
      directives: [],
      context: [],
      tools: tools(counter),
      toolContext: context,
      decide: scripted([create, { action: "YIELD", summary: "Weiter" }]).decide,
    });
    expect(first.status).toBe("yielded");
    const second = await runAgentLoop({
      objective: "Goal",
      directives: [],
      context: [],
      tools: tools(counter),
      toolContext: context,
      decide: scripted([
        create,
        create,
        { action: "FINISH", summary: "Fertig", answer: "ok" },
      ]).decide,
      resume: first.state,
    });
    expect(second.status).toBe("finished");
    // The first slice's failure counts: one retry here, the next is blocked.
    expect(counter.create).toBe(2);
    expect(second.state.steps.at(-2)?.detail).toBe("repeated_call");
  });

  it("signs a call by its content, not its key order", () => {
    expect(callSignature("t", { a: 1, b: [1, { c: 2, d: 3 }] })).toBe(
      callSignature("t", { b: [1, { d: 3, c: 2 }], a: 1 }),
    );
    expect(callSignature("t", { a: 1 })).not.toBe(callSignature("t", { a: 2 }));
    expect(callSignature("t", { a: 1 })).not.toBe(callSignature("u", { a: 1 }));
  });

  it("names nothing for a call never made", () => {
    expect(repeatedCallNote(undefined, "external")).toBeNull();
  });
});
