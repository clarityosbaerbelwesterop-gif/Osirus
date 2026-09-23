import { mkdir, readFile, writeFile, appendFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { runArenaTask } from "../src/lib/arena/harness";
import {
  renderSummary,
  summarise,
  type Suite,
  type TaskResult,
} from "../src/lib/arena/metrics";
import { ARENA_TASKS } from "../src/lib/arena/suites";
import {
  evaluateGate,
  gateMetrics,
  renderGate,
  type GateMetrics,
} from "../src/lib/arena/gate";
import { registerBrowserQa } from "../src/lib/coding/browser-qa";
import { PlaywrightQa } from "../src/lib/coding/playwright-qa";
import { UnoRouterProvider } from "../src/lib/models/unorouter";
import { resolveSandbox } from "../src/lib/sandbox";
import { LocalWorkspaceDriver } from "../src/lib/sandbox/local";

// Live arena run. Real model, real retrieval, real computation, real sandbox,
// real browser. Results are written as JSON and Markdown; nothing here
// asserts that the agent did well -- a live eval reports, it does not gate.

const suites = new Set(
  (process.env.ARENA_SUITES ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean) as Suite[],
);
const maxCostUsd = Number(process.env.ARENA_MAX_COST_USD ?? "3");
const maxTokens = Number(process.env.ARENA_MAX_TOKENS ?? "1500000");
const outDir = process.env.ARENA_OUT_DIR ?? "arena-results";

describe("agent arena (live)", () => {
  it("runs the selected suites within budget", async () => {
    registerBrowserQa(() => new PlaywrightQa());
    const hosted = process.env.OSIRUS_SANDBOX_CREDENTIALS === "ci";
    const sandbox = hosted
      ? async () => resolveSandbox()
      : async () => new LocalWorkspaceDriver();
    const sandboxLabel = hosted
      ? (await resolveSandbox()).availability().reason
      : "Local temporary workspace on the ephemeral runner";

    const provider = new UnoRouterProvider();
    const model = provider.modelId("STRONG");
    const startedAt = new Date().toISOString();
    const results: Array<TaskResult & { events: string[] }> = [];
    const spent = { costUsd: 0, tokens: 0 };

    for (const task of ARENA_TASKS) {
      if (suites.size > 0 && !suites.has(task.suite)) continue;
      if (spent.costUsd >= maxCostUsd || spent.tokens >= maxTokens) {
        results.push({
          taskId: task.id,
          suite: task.suite,
          arm: "",
          status: "skipped",
          verdicts: [],
          success: false,
          verifiedSuccess: false,
          falseCompletion: false,
          toolCalls: 0,
          modelCalls: 0,
          inputTokens: 0,
          outputTokens: 0,
          costUsd: 0,
          latencyMs: 0,
          repairs: 0,
          humanInterventions: 0,
          securityEvents: 0,
          notes: ["Skipped: the run's budget was spent."],
          answerExcerpt: "",
          events: [],
        });
        continue;
      }
      let result: TaskResult & { events: string[] };
      try {
        result = await runArenaTask(task, {
          provider,
          sandbox,
          budget: { maxCostUsd, maxTokens },
          spent,
        });
      } catch (error) {
        result = {
          taskId: task.id,
          suite: task.suite,
          arm: "",
          status: "error",
          verdicts: [],
          success: false,
          verifiedSuccess: false,
          falseCompletion: false,
          toolCalls: 0,
          modelCalls: 0,
          inputTokens: 0,
          outputTokens: 0,
          costUsd: 0,
          latencyMs: 0,
          repairs: 0,
          humanInterventions: 0,
          securityEvents: 0,
          notes: [
            error instanceof Error ? error.message.slice(0, 400) : "error",
          ],
          answerExcerpt: "",
          events: [],
        };
      }
      spent.costUsd += result.costUsd;
      spent.tokens += result.inputTokens + result.outputTokens;
      results.push(result);
      console.log(
        `[arena] ${task.id}: ${result.status} verdicts=${result.verdicts.join(",") || "none"} success=${result.success} verified=${result.verifiedSuccess} falseCompletion=${result.falseCompletion} model=${result.modelCalls} tools=${result.toolCalls} tokens=${result.inputTokens + result.outputTokens} ${(result.latencyMs / 1000).toFixed(1)}s`,
      );
      for (const note of result.notes) console.log(`[arena]   note: ${note}`);
    }

    const finishedAt = new Date().toISOString();
    const summary = renderSummary(summarise(results), {
      model,
      startedAt,
      finishedAt,
      sandbox: sandboxLabel,
    });
    await mkdir(outDir, { recursive: true });
    await writeFile(
      `${outDir}/results.json`,
      JSON.stringify(
        {
          model,
          startedAt,
          finishedAt,
          sandbox: sandboxLabel,
          maxCostUsd,
          maxTokens,
          results,
        },
        null,
        2,
      ),
    );
    // Regression gate against the stored baseline for this model, if any.
    const current = gateMetrics(model, results);
    const baselinePath = `evals/baselines/${model.replaceAll(/[^a-zA-Z0-9._-]/g, "_")}.json`;
    const baseline = await readFile(baselinePath, "utf8")
      .then((text) => JSON.parse(text) as GateMetrics)
      .catch(() => null);
    const gate = evaluateGate({ baseline, current });
    const gateText = renderGate(gate);
    await writeFile(
      `${outDir}/gate.json`,
      JSON.stringify({ current, gate }, null, 2),
    );
    await writeFile(`${outDir}/summary.md`, `${summary}\n\n${gateText}\n`);
    if (process.env.GITHUB_STEP_SUMMARY)
      await appendFile(
        process.env.GITHUB_STEP_SUMMARY,
        `${summary}\n\n${gateText}\n`,
      );
    console.log(summary);
    console.log(gateText);
    expect(results.length).toBeGreaterThan(0);
    if (gate.enforced) expect(gate.passed, gateText).toBe(true);
  });
});
