import { readFile, writeFile } from "node:fs/promises";
import { expect, it } from "vitest";
import { InProcessExecutor } from "../src/lib/intelligence/executors/in-process";
import type { LiveOrderContent } from "../src/lib/intelligence/rsi/phases";
import {
  budgetedProvider,
  rawVsOsirusSide,
} from "../src/lib/intelligence/benchmark/raw-vs-osirus";
import type {
  EvalTask,
  StrategyVersion,
  TaskSpec,
  Trial,
} from "../src/lib/intelligence/types";
import { UnoRouterProvider } from "../src/lib/models/unorouter";
import { LocalWorkspaceDriver } from "../src/lib/sandbox/local";

// The live lane of the Recursive Intelligence Cycle, run by
// .github/workflows/rsi-live.yml on the free model:
//
//   - champion vs challenger on the same tasks, same model, same budgets;
//   - raw model vs the same model inside Osirus, same tasks, same verifier.
//
// It spends only the calls the cycle reserved for this order. When they run
// out, remaining work is marked excluded -- never guessed, never faked.
// The rows go back to the cycle, which recomputes the decision itself.

const orderPath = process.env.RSI_ORDER_FILE ?? "order.json";
const outPath = process.env.RSI_EVIDENCE ?? "evidence.json";

function version(
  id: string,
  order: LiveOrderContent,
  genome: Record<string, unknown>,
): StrategyVersion {
  return {
    id,
    strategyId: order.strategyId,
    kind: "math_science",
    version: 1,
    genome,
    parentId: null,
    mutation: { operator: "live", rationale: "" },
    status: "experimental",
    riskClass: "low",
    model: order.model,
    canaryPercent: 0,
    metrics: {},
  };
}

function evalTask(entry: {
  id: string;
  partition: string;
  spec: unknown;
}): EvalTask {
  return {
    id: entry.id,
    suite: "rsi.live",
    capabilityId: "live",
    partition: entry.partition as EvalTask["partition"],
    difficulty: {},
    difficultyScore: 0,
    spec: entry.spec as TaskSpec,
    generator: "curriculum",
    fingerprint: entry.id,
    parentId: null,
    labelVerified: true,
    labelEvidence: {},
  };
}

it("runs one live order within its reserved calls", async () => {
  const startedAt = new Date().toISOString();
  const { order } = JSON.parse(await readFile(orderPath, "utf8")) as {
    order: LiveOrderContent;
  };
  const reserved = order.reserved ?? 0;
  const meter = budgetedProvider(
    new UnoRouterProvider({ model: order.model, maxRateLimitWaitSeconds: 90 }),
    reserved,
  );
  const executor = new InProcessExecutor({
    provider: () => meter.provider,
    sandbox: async () => new LocalWorkspaceDriver(),
    maxTokensPerTrial: 200_000,
  });
  const champion = version("champion", order, order.champion.genome);
  const challenger = version("challenger", order, order.challenger.genome);
  const trials: Array<Record<string, unknown>> = [];
  const benchmark: Array<Record<string, unknown>> = [];

  const runTrial = async (task: EvalTask, side: "champion" | "challenger") => {
    const trial = {
      id: `${task.id}:${side}`,
      experimentId: order.orderId,
      strategyVersionId: side,
      evalTaskId: task.id,
      partition: task.partition,
      replicate: 0,
      status: "running",
      runId: null,
      attempts: 1,
      result: null,
    } as Trial;
    const before = meter.spent();
    const outcome = await executor.execute({
      trial,
      task,
      version: side === "champion" ? champion : challenger,
      model: order.model,
      signal: AbortSignal.timeout(20 * 60_000),
    });
    const result = outcome.status === "completed" ? outcome.result : null;
    const exhausted = meter.exhausted() && !result?.verified;
    trials.push({
      taskId: task.id,
      partition: task.partition,
      side,
      verified: Boolean(result?.verified) && !exhausted,
      falseCompletion: Boolean(result?.falseCompletion),
      // A trial cut off by the order's call budget says nothing about the
      // strategy: it is marked as a provider-side stop and excluded.
      failureClass: exhausted
        ? "provider:budget"
        : (result?.failureClass ?? null),
      modelCalls: meter.spent().calls - before.calls,
      tokens: meter.spent().tokens - before.tokens,
      latencyMs: result?.latencyMs ?? 0,
    });
  };

  // Work in pairs, so every call spent buys a comparison.
  for (const entry of order.tasks) {
    if (meter.remaining() < 2) break;
    const task = evalTask(entry);
    await runTrial(task, "champion");
    await runTrial(task, "challenger");
  }
  for (const entry of order.benchmark) {
    if (meter.remaining() < 2) {
      benchmark.push({
        taskId: entry.id,
        family: entry.family,
        raw: null,
        osirus: null,
        excluded: "order budget spent",
      });
      continue;
    }
    const task = evalTask({ ...entry, partition: "holdout" });
    const raw = await rawVsOsirusSide.raw(meter.provider, task.spec, meter);
    const before = meter.spent();
    const outcome = await executor.execute({
      trial: {
        id: `${task.id}:osirus`,
        experimentId: order.orderId,
        strategyVersionId: "champion",
        evalTaskId: task.id,
        partition: "holdout",
        replicate: 0,
        status: "running",
        runId: null,
        attempts: 1,
        result: null,
      },
      task,
      version: champion,
      model: order.model,
      signal: AbortSignal.timeout(20 * 60_000),
    });
    const result = outcome.status === "completed" ? outcome.result : null;
    benchmark.push({
      taskId: task.id,
      family: entry.family,
      raw,
      osirus:
        meter.exhausted() && !result?.verified
          ? null
          : {
              verified: Boolean(result?.verified),
              modelCalls: meter.spent().calls - before.calls,
              tokens: meter.spent().tokens - before.tokens,
            },
      excluded:
        meter.exhausted() && !result?.verified ? "order budget spent" : null,
    });
  }

  const evidence = {
    orderId: order.orderId,
    evidence: {
      trials,
      benchmark,
      spent: { modelCalls: meter.spent().calls, tokens: meter.spent().tokens },
      runner: {
        runId: process.env.GITHUB_RUN_ID ?? null,
        startedAt,
        finishedAt: new Date().toISOString(),
      },
    },
  };
  await writeFile(outPath, JSON.stringify(evidence));
  if (process.env.GITHUB_STEP_SUMMARY)
    await writeFile(
      process.env.GITHUB_STEP_SUMMARY,
      [
        `## RSI live order ${order.orderId.slice(0, 8)}`,
        ``,
        `Hypothesis: ${order.hypothesis.statement}`,
        ``,
        `Trials: ${trials.length}; raw-vs-Osirus pairs: ${benchmark.filter((row) => !row.excluded).length}; calls ${meter.spent().calls}/${reserved}.`,
        ``,
        ...benchmark.map(
          (row) =>
            `- ${row.family}: raw ${row.raw ? ((row.raw as { verified: boolean }).verified ? "verified" : "failed") : "–"}, Osirus ${row.osirus ? ((row.osirus as { verified: boolean }).verified ? "verified" : "failed") : "–"}${row.excluded ? ` (${row.excluded})` : ""}`,
        ),
      ].join("\n"),
      { flag: "a" },
    );
  expect(meter.spent().calls).toBeLessThanOrEqual(reserved);
});
