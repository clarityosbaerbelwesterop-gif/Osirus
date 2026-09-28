import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { expect, it } from "vitest";
import { UnoRouterProvider } from "../src/lib/models/unorouter";
import {
  coreSpec,
  type FoundationAdapter,
  type FoundationCall,
} from "../src/lib/rouge/foundation";
import { UnoRouterFoundation } from "../src/lib/rouge/foundations/unorouter";
import { cognitivePolicy } from "../src/lib/rouge/policy";
import { RougeRuntime } from "../src/lib/rouge/runtime";
import type { RougeCognition } from "../src/lib/rouge/types";
import { CORE_TASKS } from "./rouge/core-selection-tasks";
import { KERNEL_HOLDOUT } from "./rouge/kernel-holdout-tasks";
import {
  answerSegment,
  FAMILIES,
  generateBenchmark,
  type BenchTask,
  type Family,
  type Verdict,
} from "./rouge/m57-benchmark";
import { paired } from "./rouge/stats";

// M57 capability gate: does Rouge's cognitive kernel make the same core
// measurably more capable?
//
// Three sides answer every task, all on the same core, substitution
// forbidden:
//   raw    the core alone: one call, the task as the only message;
//   sc     the core with self-consistency: k independent raw samples and a
//          majority vote -- the strongest simple baseline at a similar call
//          budget, so a gain over raw cannot be put down to "more calls";
//   rouge  Rouge p2: task model, independent approaches, agreement as
//          uncertainty, adjudication and verification, synthesis.
//
// Tasks are generated from a seed (evals/rouge/m57-benchmark.ts). "dev" uses
// a fixed seed and is for calibration and debugging only. "holdout" uses a
// fresh random seed per run, recorded in the evidence after the run: nobody
// -- teacher, kernel or core -- can have seen those tasks before. Only a
// holdout run can pass the gate.
//
// Public logs: per-task verdicts, calls and latencies. Never a prompt or an
// answer.
//
// ROUGE_EVAL_CORE        the core (required)
// ROUGE_M57_SET          dev | holdout (default holdout)
// ROUGE_M57_SEED         holdout seed (default: random)
// ROUGE_M57_PER_FAMILY   tasks per family (default 3 dev, 6 holdout)
// ROUGE_M57_SIDES        comma-separated sides (default raw,rouge,sc);
//                        "raw" alone calibrates difficulty on dev
// ROUGE_M57_SC           self-consistency samples (default 5)
// ROUGE_M57_CONCURRENCY  model calls in flight at once (default 4)
// ROUGE_M57_PARALLEL     tasks in flight at once (default 2)
// ROUGE_M57_BUDGET_MS    no new task starts after this (default 300 min)
// ROUGE_EVIDENCE         where to write the JSON evidence
//
// The free core is tightly rate limited. A rate limit or outage is
// infrastructure, not capability, so every side retries it the same way
// (honouring Retry-After, on the same key) before a call counts as failed.
// The first development run, without retries, lost half of its raw calls
// to rate limits and could not be scored.

type Side = "raw" | "sc" | "rouge";
type Outcome = Verdict | "failed";

type TaskResult = {
  id: string;
  family: Family;
  outcome: Record<Side, Outcome | null>;
  failure: Partial<Record<Side, string>>;
  calls: Record<Side, number>;
  retries: Record<Side, number>;
  latencyMs: Record<Side, number | null>;
  cognition: RougeCognition | null;
  tier: number;
};

const RETRYABLE = new Set([
  "rate_limited",
  "provider_unavailable",
  "timeout",
  "capacity_deferred",
]);
const MAX_RETRIES = 6;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Honour Retry-After when given; otherwise back off 20 s, 40 s, ... 180 s. */
function backoffMs(error: unknown, attempt: number) {
  const asked = (error as { retryAfterMs?: number })?.retryAfterMs;
  const base = Math.min(180_000, 20_000 * 2 ** attempt);
  return Math.max(asked ?? 0, base) + Math.floor(Math.random() * 5_000);
}

const retryable = (error: unknown) =>
  RETRYABLE.has((error as { code?: string })?.code ?? "");

async function withRetry<T>(job: () => Promise<T>, onRetry: () => void) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await job();
    } catch (error) {
      if (!retryable(error) || attempt >= MAX_RETRIES) throw error;
      onRetry();
      await sleep(backoffMs(error, attempt));
    }
  }
}

/** Caps model calls in flight across every side. */
class Limiter {
  private queue: Array<() => void> = [];
  constructor(private slots: number) {}
  async acquire() {
    if (this.slots > 0) this.slots -= 1;
    else await new Promise<void>((resolve) => this.queue.push(resolve));
  }
  release() {
    const next = this.queue.shift();
    if (next) next();
    else this.slots += 1;
  }
  async run<T>(job: () => Promise<T>) {
    await this.acquire();
    try {
      return await job();
    } finally {
      this.release();
    }
  }
}

/**
 * The core behind Rouge, with the same call cap and the same retries as the
 * raw sides. A call is retried only before it produced any output: an
 * answer is never stitched together from two attempts.
 */
class LimitedFoundation implements FoundationAdapter {
  constructor(
    private readonly inner: FoundationAdapter,
    private readonly limiter: Limiter,
    private readonly onRetry: (requestId: string) => void,
  ) {}
  get core() {
    return this.inner.core;
  }
  servedModel(requestId: string) {
    return this.inner.servedModel(requestId);
  }
  async *stream(call: FoundationCall) {
    for (let attempt = 0; ; attempt += 1) {
      let started = false;
      let failure: unknown = null;
      await this.limiter.acquire();
      try {
        for await (const event of this.inner.stream(call)) {
          started = true;
          yield event;
        }
        return;
      } catch (error) {
        if (started || !retryable(error) || attempt >= MAX_RETRIES) throw error;
        failure = error;
      } finally {
        this.limiter.release();
      }
      this.onRetry(call.requestId);
      await sleep(backoffMs(failure, attempt));
    }
  }
}

function median(values: number[]) {
  if (!values.length) return null;
  return [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]!;
}

/** The value a reply commits to, as the task's own checker reads it. */
function committed(reply: string) {
  const segment = answerSegment(reply);
  return segment ? segment.toLowerCase().replace(/[\s,.]/g, "") : "";
}

const refusalCode = (error: unknown) =>
  (error as { code?: string })?.code ?? "error";

it(
  "M57 capability gate: raw core vs self-consistency vs Rouge p2",
  async () => {
    const core = process.env.ROUGE_EVAL_CORE;
    if (!core) throw new Error("ROUGE_EVAL_CORE is required");
    const set = process.env.ROUGE_M57_SET === "dev" ? "dev" : "holdout";
    const seed =
      set === "dev" ? "m57-dev-1" : process.env.ROUGE_M57_SEED || randomUUID();
    const perFamily =
      Number(process.env.ROUGE_M57_PER_FAMILY) || (set === "dev" ? 3 : 6);
    const sides = new Set(
      (process.env.ROUGE_M57_SIDES || "raw,rouge,sc")
        .split(",")
        .map((side) => side.trim()),
    );
    const samples = sides.has("sc")
      ? Math.max(2, Number(process.env.ROUGE_M57_SC) || 5)
      : 0;
    const limiter = new Limiter(
      Math.max(1, Number(process.env.ROUGE_M57_CONCURRENCY) || 4),
    );
    const parallel = Math.max(1, Number(process.env.ROUGE_M57_PARALLEL) || 2);
    const deadline =
      Date.now() + (Number(process.env.ROUGE_M57_BUDGET_MS) || 300 * 60_000);

    const tasks = generateBenchmark(seed, perFamily);

    // Contamination: no holdout task may equal a development or teacher
    // task, or repeat within the set.
    const prompts = new Set(tasks.map((task) => task.prompt));
    expect(prompts.size).toBe(tasks.length);
    if (set === "holdout") {
      const seen = new Set([
        ...generateBenchmark("m57-dev-1", 6).map((task) => task.prompt),
        ...CORE_TASKS.map((task) => task.prompt),
        ...KERNEL_HOLDOUT.map((task) => task.prompt),
      ]);
      expect(tasks.filter((task) => seen.has(task.prompt))).toHaveLength(0);
    }

    const spec = coreSpec(core);
    // Rouge's retries, per task: request ids are "m57:rouge:<task>:...".
    const rougeRetries = new Map<string, number>();
    const foundation = new LimitedFoundation(
      new UnoRouterFoundation(spec, { priority: "P1" }),
      limiter,
      (requestId) => {
        const task = requestId.split(":")[2] ?? "";
        rougeRetries.set(task, (rougeRetries.get(task) ?? 0) + 1);
      },
    );
    const rouge = new RougeRuntime({
      foundation,
      policy: cognitivePolicy(core),
      allowCoreSubstitute: false,
    });
    // The raw core, exactly as a caller without Rouge would use it: no
    // system prompt, the reasoning level Rouge's "standard" maps to.
    const rawCall = (requestId: string, prompt: string, onRetry: () => void) =>
      withRetry(
        () =>
          limiter.run(async () => {
            const provider = new UnoRouterProvider({
              model: core,
              fallback: false,
              priority: "P1",
              reasoningEffort: spec.reasoningLevels.length
                ? "medium"
                : undefined,
            });
            const result = await provider.complete({
              requestId,
              role: "STRONG",
              messages: [{ role: "user", content: prompt }],
            });
            // Integrity: the named core answered, nobody else.
            const served = provider.servedModel?.(requestId);
            if (served && served !== core)
              throw Object.assign(new Error("substituted"), {
                code: "substituted",
              });
            return result.text;
          }),
        onRetry,
      );

    const runTask = async (task: BenchTask): Promise<TaskResult> => {
      const result: TaskResult = {
        id: task.id,
        family: task.family,
        outcome: { raw: null, sc: null, rouge: null },
        failure: {},
        calls: { raw: 1, sc: samples, rouge: 0 },
        retries: { raw: 0, sc: 0, rouge: 0 },
        latencyMs: { raw: null, sc: null, rouge: null },
        cognition: null,
        tier: task.tier,
      };
      const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const raw = (async () => {
        if (!sides.has("raw")) return;
        const started = Date.now();
        try {
          const text = await rawCall(
            `m57:raw:${task.id}:${stamp}`,
            task.prompt,
            () => (result.retries.raw += 1),
          );
          result.outcome.raw = task.check(text);
          result.latencyMs.raw = Date.now() - started;
        } catch (error) {
          result.outcome.raw = "failed";
          result.failure.raw = refusalCode(error);
        }
      })();
      const sc = (async () => {
        if (!samples) return;
        const started = Date.now();
        const replies = await Promise.all(
          Array.from({ length: samples }, (_, i) =>
            rawCall(
              `m57:sc${i}:${task.id}:${stamp}`,
              task.prompt,
              () => (result.retries.sc += 1),
            ).catch((error: unknown) => {
              result.failure.sc = refusalCode(error);
              return null;
            }),
          ),
        );
        const answered = replies.filter(
          (reply): reply is string => reply !== null,
        );
        if (answered.length < Math.ceil(samples / 2)) {
          result.outcome.sc = "failed";
          return;
        }
        // Majority by the value each sample commits to, read the same way
        // the checker reads it: the baseline gets perfect normalisation.
        const votes = new Map<string, { reply: string; count: number }>();
        for (const reply of answered) {
          const key = committed(reply);
          if (!key) continue;
          const entry = votes.get(key) ?? { reply, count: 0 };
          entry.count += 1;
          votes.set(key, entry);
        }
        const top = [...votes.values()].sort((a, b) => b.count - a.count)[0];
        result.outcome.sc = top ? task.check(top.reply) : "no_answer";
        result.latencyMs.sc = Date.now() - started;
      })();
      const kernel = (async () => {
        if (!sides.has("rouge")) return;
        try {
          const response = await rouge.respond({
            requestId: `m57:rouge:${task.id}:${stamp}`,
            messages: [{ role: "user", content: task.prompt }],
            effort: "standard",
          });
          if (response.core.substituted || response.core.served !== core) {
            result.outcome.rouge = "failed";
            result.failure.rouge = "substituted";
            return;
          }
          result.outcome.rouge = task.check(response.text);
          result.latencyMs.rouge = response.latencyMs;
          result.cognition = response.kernel?.cognition ?? null;
          result.calls.rouge =
            (response.kernel?.cognition?.calls ?? 1) +
            (response.kernel?.repairs ?? 0);
        } catch (error) {
          result.outcome.rouge = "failed";
          result.failure.rouge = refusalCode(error);
        }
      })();
      await Promise.all([raw, sc, kernel]);
      result.retries.rouge = rougeRetries.get(task.id) ?? 0;
      return result;
    };

    const results: TaskResult[] = [];
    let skipped = 0;
    const mark = (outcome: Outcome | null) =>
      outcome === "correct"
        ? "+"
        : outcome === null
          ? "."
          : outcome === "failed"
            ? "!"
            : "-";
    for (let i = 0; i < tasks.length; i += parallel) {
      if (Date.now() > deadline) {
        skipped = tasks.length - i;
        break;
      }
      const batch = await Promise.all(
        tasks.slice(i, i + parallel).map(runTask),
      );
      for (const r of batch) {
        results.push(r);
        const c = r.cognition;
        console.log(
          `task ${r.id} t${r.tier}: raw ${mark(r.outcome.raw)} sc ${mark(r.outcome.sc)} rouge ${mark(r.outcome.rouge)}` +
            ` | rouge ${c ? `${c.mode} tm=${c.taskModel} kind=${c.taskKind} d=${c.difficulty} conf=${c.confidence?.toFixed(2) ?? "-"}${c.adjudicated ? " adjudicated" : ""}${c.verified ? " verified" : ""}${c.corrected ? " corrected" : ""}` : "-"} calls ${r.calls.rouge}` +
            ` | ms raw ${r.latencyMs.raw ?? "-"} sc ${r.latencyMs.sc ?? "-"} rouge ${r.latencyMs.rouge ?? "-"}` +
            ` | retries raw ${r.retries.raw} sc ${r.retries.sc} rouge ${r.retries.rouge}` +
            (Object.keys(r.failure).length
              ? ` | failures ${JSON.stringify(r.failure)}`
              : ""),
        );
      }
    }

    // Paired analysis on the tasks every compared side completed. A side's
    // provider failures are reported, and too many of them void the gate.
    const complete = (sides: Side[]) =>
      results.filter((r) =>
        sides.every(
          (side) => r.outcome[side] !== null && r.outcome[side] !== "failed",
        ),
      );
    const right = (r: TaskResult, side: Side) => r.outcome[side] === "correct";
    const vsRaw = complete(["raw", "rouge"]);
    const rougeVsRaw = paired(
      vsRaw.map((r) => right(r, "rouge")),
      vsRaw.map((r) => right(r, "raw")),
      { seed },
    );
    const vsSc = samples ? complete(["sc", "rouge"]) : [];
    const rougeVsSc = samples
      ? paired(
          vsSc.map((r) => right(r, "rouge")),
          vsSc.map((r) => right(r, "sc")),
          { seed: `${seed}:sc` },
        )
      : null;

    const byFamily = FAMILIES.map((family) => {
      const rows = vsRaw.filter((r) => r.family === family);
      const count = (side: Side) => rows.filter((r) => right(r, side)).length;
      const scRows = vsSc.filter((r) => r.family === family);
      return {
        family,
        n: rows.length,
        raw: count("raw"),
        rouge: count("rouge"),
        delta: count("rouge") - count("raw"),
        sc: samples
          ? `${scRows.filter((r) => right(r, "sc")).length}/${scRows.length}`
          : "-",
      };
    });
    const side = (s: Side) => {
      const done = results.filter((r) => r.outcome[s] !== null);
      return {
        side: s,
        correct: done.filter((r) => r.outcome[s] === "correct").length,
        wrong: done.filter((r) => r.outcome[s] === "wrong").length,
        noAnswer: done.filter((r) => r.outcome[s] === "no_answer").length,
        failed: done.filter((r) => r.outcome[s] === "failed").length,
        of: done.length,
        retries: done.reduce((sum, r) => sum + r.retries[s], 0),
        meanCalls: done.length
          ? Number(
              (
                done.reduce((sum, r) => sum + r.calls[s], 0) / done.length
              ).toFixed(2),
            )
          : null,
        medianMs: median(
          done
            .map((r) => r.latencyMs[s])
            .filter((v): v is number => v !== null),
        ),
      };
    };
    const summary = (["raw", "sc", "rouge"] as Side[])
      .filter((s) => sides.has(s))
      .map(side);
    // Difficulty per family and tier, from whatever each side answered:
    // this is what a dev calibration run is read for.
    const accuracy = FAMILIES.flatMap((family) =>
      [0, 1].map((tier) => {
        const rows = results.filter(
          (r) => r.family === family && r.tier === tier,
        );
        const rate = (s: Side) => {
          const done = rows.filter(
            (r) => r.outcome[s] !== null && r.outcome[s] !== "failed",
          );
          return done.length
            ? `${done.filter((r) => right(r, s)).length}/${done.length}`
            : "-";
        };
        return {
          family,
          tier,
          raw: rate("raw"),
          sc: rate("sc"),
          rouge: rate("rouge"),
        };
      }),
    );

    // The gate, fixed before any holdout run (docs/rouge/architecture.md):
    const coverage = vsRaw.length / tasks.length;
    const improved = byFamily.filter((f) => f.delta > 0).length;
    const worst = Math.min(...byFamily.map((f) => f.delta));
    const gate = {
      holdout: set === "holdout",
      coverage: coverage >= 0.9,
      ciAboveZero: rougeVsRaw.ci95[0] > 0,
      significant: rougeVsRaw.pValue < 0.05,
      familiesImproved: improved >= 3,
      noFamilyRegression: worst >= -1,
    };
    const passed = Object.values(gate).every(Boolean);

    const evidence = {
      milestone: "M57",
      set,
      seed,
      core,
      perFamily,
      tasks: tasks.length,
      skipped,
      selfConsistencySamples: samples,
      at: new Date().toISOString(),
      sides: [...sides],
      summary,
      accuracy,
      rougeVsRaw,
      rougeVsSc,
      byFamily,
      gate,
      passed,
      results,
    };
    if (process.env.ROUGE_EVIDENCE)
      writeFileSync(
        process.env.ROUGE_EVIDENCE,
        JSON.stringify(evidence, null, 2),
      );

    console.log(
      `M57 ${set}: ${tasks.length} tasks (${perFamily} per family), core ${core}, substitution forbidden, seed ${seed}`,
    );
    console.table(summary);
    console.table(byFamily);
    console.table(accuracy);
    const pct = (x: number) => `${(x * 100).toFixed(1)} pp`;
    console.log(
      `Rouge vs raw: ${pct(rougeVsRaw.diff)} (95% CI ${pct(rougeVsRaw.ci95[0])} .. ${pct(rougeVsRaw.ci95[1])}), rouge-only ${rougeVsRaw.aOnly}, raw-only ${rougeVsRaw.bOnly}, McNemar p=${rougeVsRaw.pValue.toFixed(4)}, n=${rougeVsRaw.n}`,
    );
    if (rougeVsSc)
      console.log(
        `Rouge vs self-consistency@${samples}: ${pct(rougeVsSc.diff)} (95% CI ${pct(rougeVsSc.ci95[0])} .. ${pct(rougeVsSc.ci95[1])}), rouge-only ${rougeVsSc.aOnly}, sc-only ${rougeVsSc.bOnly}, McNemar p=${rougeVsSc.pValue.toFixed(4)}, n=${rougeVsSc.n}`,
      );
    console.log(
      `Gate: ${JSON.stringify(gate)} => ${passed ? "PASSED" : "NOT PASSED"}`,
    );
  },
  (Number(process.env.ROUGE_M57_BUDGET_MS) || 300 * 60_000) + 40 * 60_000,
);
