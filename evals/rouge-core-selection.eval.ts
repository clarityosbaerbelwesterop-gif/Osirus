import { writeFileSync } from "node:fs";
import { expect, it } from "vitest";
import { createRougeRuntime } from "../src/lib/rouge";
import { CORE_TASKS } from "./rouge/core-selection-tasks";

// Core selection tournament (M56.1): which foundation core Rouge runs on
// when Grok 4.6 cannot answer. Every candidate runs the same teacher-written,
// code-checked tasks through Rouge, pinned to itself with substitution
// forbidden, so each score is that core's own. Logs are public: they carry
// scores, counts and latencies only, never a prompt or an answer.
//
// ROUGE_CANDIDATES  comma-separated core ids (default below)
// ROUGE_EVIDENCE    where to write the JSON evidence
// ROUGE_PARALLEL    candidates evaluated at once (default 4)

const DEFAULT_CANDIDATES = [
  "grok-4.6",
  "nemotron-3-ultra-550b-a55b:free",
  "deepseek-v4-pro:free",
  "kimi-k3:free",
  "qwen3.6-plus:free",
  "glm-5.3-flash-thinking:free",
  "gemini-3.6-flash:free",
  "mimo-v2.6-pro:free",
  "k2-horizon:free",
  "laguna-s-2.1:free",
  "step-3.7-flash:free",
];

type Result = {
  core: string;
  correct: number;
  strict: number;
  answered: number;
  refused: number;
  errors: number;
  total: number;
  refusalCodes: string[];
  medianLatencyMs: number | null;
  outputTokens: number;
  byFamily: Record<string, { correct: number; total: number }>;
  stoppedEarly: boolean;
};

function median(values: number[]) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
}

async function evaluate(core: string): Promise<Result> {
  const rouge = createRougeRuntime({
    core,
    priority: "P1",
    allowCoreSubstitute: false,
  });
  const result: Result = {
    core,
    correct: 0,
    strict: 0,
    answered: 0,
    refused: 0,
    errors: 0,
    total: CORE_TASKS.length,
    refusalCodes: [],
    medianLatencyMs: null,
    outputTokens: 0,
    byFamily: {},
    stoppedEarly: false,
  };
  const latencies: number[] = [];
  let consecutiveRefusals = 0;
  for (const task of CORE_TASKS) {
    const family = (result.byFamily[task.family] ??= { correct: 0, total: 0 });
    family.total += 1;
    try {
      const response = await rouge.respond({
        requestId: `core-select:${core}:${task.id}:${Date.now()}`,
        messages: [{ role: "user", content: task.prompt }],
        effort: "standard",
      });
      consecutiveRefusals = 0;
      result.answered += 1;
      latencies.push(response.latencyMs);
      result.outputTokens += response.usage.outputTokens;
      // Integrity: the pinned core answered, nobody else.
      expect(response.core.served).toBe(core);
      if (task.correct(response.text)) {
        result.correct += 1;
        family.correct += 1;
      }
      if (task.strict(response.text)) result.strict += 1;
    } catch (error) {
      const code = (error as { code?: string }).code ?? "error";
      if (
        [
          "insufficient_credit",
          "model_not_configured",
          "rate_limited",
          "provider_unavailable",
          "timeout",
          "capacity_deferred",
          "credential_rejected",
        ].includes(code)
      ) {
        result.refused += 1;
        consecutiveRefusals += 1;
      } else {
        result.errors += 1;
      }
      if (!result.refusalCodes.includes(code)) result.refusalCodes.push(code);
      // A core that refuses three times in a row is not available now.
      if (
        consecutiveRefusals >= 3 ||
        code === "insufficient_credit" ||
        code === "model_not_configured"
      ) {
        result.stoppedEarly = true;
        break;
      }
    }
  }
  result.medianLatencyMs = median(latencies);
  return result;
}

it(
  "selects Rouge's substitute cores by measurement",
  async () => {
    const candidates = (
      process.env.ROUGE_CANDIDATES || DEFAULT_CANDIDATES.join(",")
    )
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean);
    const parallel = Math.max(1, Number(process.env.ROUGE_PARALLEL) || 4);
    const results: Result[] = [];
    // Each core is reported the moment it finishes, and the evidence file is
    // rewritten then too: a run cut short by the job's time limit still
    // leaves every finished core's result behind.
    const finished = (result: Result) => {
      results.push(result);
      console.log(
        `core done: ${result.core} correct ${result.correct}/${result.total} strict ${result.strict}/${result.total} refused ${result.refused} errors ${result.errors} median ${result.medianLatencyMs ?? "-"} ms${result.stoppedEarly ? " (stopped early)" : ""}`,
      );
      if (process.env.ROUGE_EVIDENCE)
        writeFileSync(
          process.env.ROUGE_EVIDENCE,
          JSON.stringify(
            { milestone: "M56.1", partial: true, results },
            null,
            2,
          ),
        );
    };
    for (let i = 0; i < candidates.length; i += parallel) {
      await Promise.all(
        candidates
          .slice(i, i + parallel)
          .map((core) => evaluate(core).then(finished)),
      );
    }

    // Ranking: accuracy over all tasks (a refused task counts as wrong, so an
    // unavailable core cannot win), then instruction-exact replies, then
    // median latency.
    const ranked = [...results].sort(
      (a, b) =>
        b.correct - a.correct ||
        b.strict - a.strict ||
        (a.medianLatencyMs ?? Infinity) - (b.medianLatencyMs ?? Infinity),
    );
    // A substitute must be available and genuinely good: it answered every
    // task and got at least 80% right.
    const eligible = ranked.filter(
      (r) => r.answered === r.total && r.correct / r.total >= 0.8,
    );

    const evidence = {
      milestone: "M56.1",
      tasks: CORE_TASKS.length,
      families: [...new Set(CORE_TASKS.map((t) => t.family))],
      at: new Date().toISOString(),
      ranked,
      recommendedSubstitutes: eligible.slice(0, 3).map((r) => r.core),
    };
    if (process.env.ROUGE_EVIDENCE)
      writeFileSync(
        process.env.ROUGE_EVIDENCE,
        JSON.stringify(evidence, null, 2),
      );

    console.log(
      `Core selection: ${CORE_TASKS.length} tasks, ${candidates.length} candidates, substitution forbidden`,
    );
    console.table(
      ranked.map((r) => ({
        core: r.core,
        correct: `${r.correct}/${r.total}`,
        strict: `${r.strict}/${r.total}`,
        refused: r.refused,
        errors: r.errors,
        codes: r.refusalCodes.join(" "),
        medianMs: r.medianLatencyMs,
        outTokens: r.outputTokens,
      })),
    );
    console.log(
      `Recommended substitutes (in order): ${evidence.recommendedSubstitutes.join(", ") || "none"}`,
    );
  },
  60 * 60_000,
);
