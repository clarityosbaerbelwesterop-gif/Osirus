import { writeFileSync } from "node:fs";
import { it } from "vitest";
import { UnoRouterProvider } from "../src/lib/models/unorouter";
import { coreSpec } from "../src/lib/rouge/foundation";
import { UnoRouterFoundation } from "../src/lib/rouge/foundations/unorouter";
import { defaultPolicy, foundationPolicy } from "../src/lib/rouge/policy";
import { RougeRuntime } from "../src/lib/rouge/runtime";
import { CORE_TASKS, type CoreTask } from "./rouge/core-selection-tasks";
import { KERNEL_HOLDOUT } from "./rouge/kernel-holdout-tasks";

// M57 kernel evaluation: the raw core vs Rouge p0 (foundation only) vs Rouge
// p1 (kernel), all pinned to the same core with substitution forbidden, on
// the development set and on the blind holdout. The kernel stays Rouge's
// default only if, on the holdout, it follows instructions better than the
// raw core without being less correct. Metadata only in the public logs.
//
// ROUGE_EVAL_CORE  the core (required)
// ROUGE_EVIDENCE   where to write the JSON evidence

type Side = "raw" | "rouge-p0" | "rouge-p1";
type Tally = {
  correct: number;
  strict: number;
  answered: number;
  failed: number;
  repairs: number;
  outputTokens: number;
  latencies: number[];
};

const empty = (): Tally => ({
  correct: 0,
  strict: 0,
  answered: 0,
  failed: 0,
  repairs: 0,
  outputTokens: 0,
  latencies: [],
});

function median(values: number[]) {
  if (!values.length) return null;
  return [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]!;
}

it(
  "Rouge kernel vs foundation vs raw core",
  async () => {
    const core = process.env.ROUGE_EVAL_CORE;
    if (!core) throw new Error("ROUGE_EVAL_CORE is required");
    const spec = coreSpec(core);
    const foundation = new UnoRouterFoundation(spec, { priority: "P1" });
    const p0 = new RougeRuntime({
      foundation,
      policy: foundationPolicy(core),
      allowCoreSubstitute: false,
    });
    const p1 = new RougeRuntime({
      foundation,
      policy: defaultPolicy(core),
      allowCoreSubstitute: false,
    });

    const sets: Array<[string, CoreTask[]]> = [
      ["dev", CORE_TASKS],
      ["holdout", KERNEL_HOLDOUT],
    ];
    const results: Record<string, Record<Side, Tally>> = {};
    for (const [set, tasks] of sets) {
      const tally: Record<Side, Tally> = {
        raw: empty(),
        "rouge-p0": empty(),
        "rouge-p1": empty(),
      };
      results[set] = tally;
      for (const task of tasks) {
        const score = (side: Side, text: string) => {
          tally[side].answered += 1;
          if (task.correct(text)) tally[side].correct += 1;
          if (task.strict(text)) tally[side].strict += 1;
        };
        // Raw: the core alone, the task as the prompt, same reasoning level
        // Rouge's "standard" maps to.
        const started = Date.now();
        try {
          const raw = await new UnoRouterProvider({
            model: core,
            fallback: false,
            priority: "P1",
            reasoningEffort: spec.reasoningLevels.length ? "medium" : undefined,
          }).complete({
            requestId: `kernel-eval:raw:${task.id}:${started}`,
            role: "STRONG",
            messages: [{ role: "user", content: task.prompt }],
          });
          score("raw", raw.text);
          tally.raw.outputTokens += raw.usage.outputTokens ?? 0;
          tally.raw.latencies.push(Date.now() - started);
        } catch {
          tally.raw.failed += 1;
        }
        for (const [side, rouge] of [
          ["rouge-p0", p0],
          ["rouge-p1", p1],
        ] as const) {
          try {
            const response = await rouge.respond({
              requestId: `kernel-eval:${side}:${task.id}:${Date.now()}`,
              messages: [{ role: "user", content: task.prompt }],
              effort: "standard",
            });
            score(side, response.text);
            tally[side].repairs += response.kernel?.repairs ?? 0;
            tally[side].outputTokens += response.usage.outputTokens;
            tally[side].latencies.push(response.latencyMs);
          } catch {
            tally[side].failed += 1;
          }
        }
      }
    }

    const holdout = results.holdout!;
    const promoted =
      holdout["rouge-p1"].strict > holdout.raw.strict &&
      holdout["rouge-p1"].correct >= holdout.raw.correct &&
      holdout["rouge-p1"].failed <= holdout.raw.failed;

    const rows = Object.entries(results).flatMap(([set, tally]) =>
      (Object.keys(tally) as Side[]).map((side) => ({
        set,
        side,
        correct: `${tally[side].correct}/${tally[side].answered + tally[side].failed}`,
        strict: `${tally[side].strict}/${tally[side].answered + tally[side].failed}`,
        failed: tally[side].failed,
        repairs: tally[side].repairs,
        outTokens: tally[side].outputTokens,
        medianMs: median(tally[side].latencies),
      })),
    );
    const evidence = {
      milestone: "M57",
      core,
      substitution: "forbidden",
      at: new Date().toISOString(),
      rows,
      promotionRule:
        "holdout: p1.strict > raw.strict AND p1.correct >= raw.correct AND p1.failed <= raw.failed",
      promoted,
    };
    if (process.env.ROUGE_EVIDENCE)
      writeFileSync(
        process.env.ROUGE_EVIDENCE,
        JSON.stringify(evidence, null, 2),
      );
    console.log(
      `Rouge M57 kernel evaluation on ${core} (substitution forbidden)`,
    );
    console.table(rows);
    console.log(
      `Kernel promotion (holdout rule): ${promoted ? "PROMOTED" : "NOT PROMOTED"}`,
    );
  },
  60 * 60_000,
);
