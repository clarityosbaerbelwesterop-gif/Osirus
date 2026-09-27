import { writeFileSync } from "node:fs";
import { expect, it } from "vitest";
import { UnoRouterProvider } from "../src/lib/models/unorouter";
import { providerRefusalOf } from "../src/lib/models/provider";
import { createRougeRuntime } from "../src/lib/rouge";
import { MemoryTelemetry } from "../src/lib/rouge/telemetry";

// M56 live evaluation: Rouge's foundation on a real core, against the raw
// core, with substitution forbidden -- every number below is the named core's
// own. Four calls at most. The repository's Action logs are public, so only
// metadata is printed: never a prompt or an answer.
//
// ROUGE_EVAL_CORE   the core to evaluate (default grok-4.6)
// ROUGE_EVIDENCE    where to write the JSON evidence

type Row = {
  side: "raw" | "rouge";
  effort: string;
  outcome: "correct" | "incorrect" | "refused" | "error";
  code: string | null;
  servedModel: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  latencyMs: number;
};

// Checkable without a model judge: the answer is a number.
const TASKS = [
  {
    id: "arith",
    prompt: "What is 17 * 23? Reply with the number only.",
    answer: "391",
  },
  {
    id: "units",
    prompt: "How many seconds are in 3.5 hours? Reply with the number only.",
    answer: "12600",
  },
];

const correct = (text: string, answer: string) =>
  text.replace(/[\s,.]/g, "").includes(answer);

it(
  "Rouge foundation vs the raw core",
  async () => {
    const core = process.env.ROUGE_EVAL_CORE || "grok-4.6";
    const rows: Row[] = [];

    for (const task of TASKS) {
      // A. The raw core: one call, the task as the prompt.
      const rawStarted = Date.now();
      const raw = new UnoRouterProvider({
        model: core,
        fallback: false,
        reasoningEffort: "medium",
        priority: "P3",
      });
      const rawId = `rouge-eval:raw:${task.id}:${rawStarted}`;
      try {
        const result = await raw.complete({
          requestId: rawId,
          role: "STRONG",
          messages: [{ role: "user", content: task.prompt }],
        });
        rows.push({
          side: "raw",
          effort: "medium",
          outcome: correct(result.text, task.answer) ? "correct" : "incorrect",
          code: null,
          servedModel: raw.servedModel(rawId) ?? core,
          inputTokens: result.usage.inputTokens ?? null,
          outputTokens: result.usage.outputTokens ?? null,
          latencyMs: Date.now() - rawStarted,
        });
      } catch (error) {
        const refusal = providerRefusalOf(error);
        rows.push({
          side: "raw",
          effort: "medium",
          outcome: refusal ? "refused" : "error",
          code: refusal?.code ?? (error as { code?: string }).code ?? "error",
          servedModel: null,
          inputTokens: null,
          outputTokens: null,
          latencyMs: Date.now() - rawStarted,
        });
      }

      // B. Rouge on the same core, the same reasoning level ("standard").
      const telemetry = new MemoryTelemetry();
      const rouge = createRougeRuntime({
        core,
        priority: "P3",
        allowCoreSubstitute: false,
        telemetry,
      });
      const started = Date.now();
      try {
        const response = await rouge.respond({
          requestId: `rouge-eval:rouge:${task.id}:${started}`,
          messages: [{ role: "user", content: task.prompt }],
          effort: "standard",
        });
        rows.push({
          side: "rouge",
          effort: response.effort,
          outcome: correct(response.text, task.answer)
            ? "correct"
            : "incorrect",
          code: null,
          servedModel: response.core.served,
          inputTokens: response.usage.inputTokens,
          outputTokens: response.usage.outputTokens,
          latencyMs: response.latencyMs,
        });
      } catch (error) {
        const code = (error as { code?: string }).code ?? "error";
        rows.push({
          side: "rouge",
          effort: "standard",
          outcome: providerRefusalOf({ name: "ProviderError", code })
            ? "refused"
            : "error",
          code,
          servedModel: null,
          inputTokens: null,
          outputTokens: null,
          latencyMs: Date.now() - started,
        });
      }
      // A refused core refuses every call: do not spend more of the budget.
      if (rows.every((row) => row.outcome === "refused")) break;
    }

    const evidence = {
      milestone: "M56",
      core,
      substitution: "forbidden",
      at: new Date().toISOString(),
      rows,
    };
    if (process.env.ROUGE_EVIDENCE)
      writeFileSync(
        process.env.ROUGE_EVIDENCE,
        JSON.stringify(evidence, null, 2),
      );
    console.log(`Rouge M56 evaluation on ${core} (substitution forbidden)`);
    console.table(rows);

    // Integrity, not a score: nothing was served by another model.
    for (const row of rows)
      if (row.servedModel) expect(row.servedModel).toBe(core);
  },
  10 * 60_000,
);
