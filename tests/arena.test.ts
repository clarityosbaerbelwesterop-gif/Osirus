import { describe, expect, it } from "vitest";
import { runArenaTask } from "../src/lib/arena/harness";
import {
  isFalseCompletion,
  renderSummary,
  summarise,
  type TaskResult,
} from "../src/lib/arena/metrics";
import { ARENA_TASKS } from "../src/lib/arena/suites";
import type { ModelProvider } from "../src/lib/models/provider";
import { LocalWorkspaceDriver } from "../src/lib/sandbox/local";

// The arena harness end to end with the model replaced by a script. This is
// the machinery the live-eval workflow runs with the real model: routing,
// composition, every stage, the loop, the tools, fault injection, the
// verifier and the metrics. The score of a scripted model means nothing and
// is not asserted; that the harness measures correctly is.

function scriptedProvider(decisions: unknown[]): ModelProvider {
  let index = 0;
  return {
    modelId: () => "scripted",
    structured: async <T>(input: { validate: (value: unknown) => T }) => {
      const next = decisions[Math.min(index, decisions.length - 1)];
      index += 1;
      return {
        value: input.validate(next),
        usage: { inputTokens: 100, outputTokens: 20, cost: 0.001 },
      };
    },
    complete: async () => ({ text: "", usage: {} }),
    stream: async function* () {},
    capabilities: async () => ({}),
    healthCheck: async () => true,
    cancel: async () => undefined,
    normalizeUsage: () => ({}),
    normalizeError: () => new Error("x"),
  } as unknown as ModelProvider;
}

describe("arena harness", () => {
  it("runs a recovery task through the real math arm, survives the injected fault, and measures it", async () => {
    const task = ARENA_TASKS.find(
      (entry) => entry.id === "recovery-tool-fails-once",
    )!;
    const compute = {
      action: "USE_TOOL",
      summary: "Compute 17!",
      toolId: "compute.run",
      toolInput: { op: "evaluate", expression: "17!" },
    };
    const result = await runArenaTask(task, {
      provider: scriptedProvider([
        compute,
        compute,
        {
          action: "FINISH",
          summary: "Done",
          answer: "17! = 355687428096000\n\nResult: 355687428096000",
        },
      ]),
      sandbox: async () => new LocalWorkspaceDriver(),
    });
    expect(result.status, result.notes.join(" | ")).toBe("completed");
    expect(result.notes.join(" ")).toMatch(
      /Injected fault on first call to compute.run/,
    );
    expect(result.toolCalls).toBeGreaterThanOrEqual(2);
    expect(result.modelCalls).toBeGreaterThanOrEqual(3);
    expect(result.inputTokens).toBeGreaterThan(0);
    expect(result.answerExcerpt).toContain("355687428096000");
    expect(result.verdicts.length).toBeGreaterThan(0);
    // The metric follows the verifier, whatever it concluded.
    expect(result.verifiedSuccess).toBe(
      result.verdicts.every((verdict) => verdict === "verified") &&
        result.success,
    );
  }, 60_000);

  it("counts a claim of completion without a verified verdict as false completion", () => {
    expect(
      isFalseCompletion("All tests pass and the feature works.", ["rejected"]),
    ).toBe(true);
    expect(isFalseCompletion("All tests pass.", ["verified"])).toBe(false);
    expect(
      isFalseCompletion("The tests did not pass; I could not fix it.", [
        "rejected",
      ]),
    ).toBe(false);
  });

  it("summarises per suite and never claims a comparison it did not run", () => {
    const row = (
      suite: TaskResult["suite"],
      overrides: Partial<TaskResult>,
    ): TaskResult => ({
      taskId: "t",
      suite,
      arm: "coding",
      status: "completed",
      verdicts: ["verified"],
      success: true,
      verifiedSuccess: true,
      falseCompletion: false,
      toolCalls: 3,
      modelCalls: 4,
      inputTokens: 1000,
      outputTokens: 200,
      costUsd: 0.01,
      latencyMs: 2000,
      repairs: 0,
      humanInterventions: 0,
      securityEvents: 0,
      notes: [],
      answerExcerpt: "",
      ...overrides,
    });
    const summaries = summarise([
      row("coding", {}),
      row("coding", {
        success: false,
        verifiedSuccess: false,
        falseCompletion: true,
      }),
      row("math", {}),
      row("math", { status: "skipped" }),
    ]);
    expect(summaries.find((s) => s.suite === "coding")).toMatchObject({
      tasks: 2,
      success: 1,
      verifiedSuccess: 1,
      falseCompletions: 1,
      tokens: 2400,
    });
    expect(summaries.find((s) => s.suite === "math")?.tasks).toBe(1);
    const text = renderSummary(summaries, {
      model: "m",
      startedAt: "a",
      finishedAt: "b",
      sandbox: "s",
    });
    expect(text).toMatch(/none is claimed here/);
    expect(text).not.toMatch(/beats/i);
  });
});
