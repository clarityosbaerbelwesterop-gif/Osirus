// Agent Arena: what is measured, and how a suite is summarised.
//
// Every number here is counted from something that happened in the run --
// model calls the provider billed, tool calls the registry audited, verdicts
// the verifier returned. "Success" is the task's own expectation; "verified
// success" additionally requires every verdict to be verified. A false
// completion is an answer that claims the work is done or passing while the
// verifier did not verify it: the failure mode this whole phase exists to
// prevent, so it is reported on its own line rather than folded into failure.

export const SUITES = [
  "thinking",
  "research",
  "math",
  "coding",
  "building",
  "compound",
  "memory",
  "recovery",
] as const;
export type Suite = (typeof SUITES)[number];

export type TaskResult = {
  taskId: string;
  suite: Suite;
  arm: string;
  status: "completed" | "failed" | "error" | "skipped";
  verdicts: string[];
  success: boolean;
  verifiedSuccess: boolean;
  falseCompletion: boolean;
  toolCalls: number;
  modelCalls: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  latencyMs: number;
  repairs: number;
  humanInterventions: number;
  securityEvents: number;
  notes: string[];
  answerExcerpt: string;
};

export type SuiteSummary = {
  suite: Suite;
  tasks: number;
  success: number;
  verifiedSuccess: number;
  falseCompletions: number;
  toolCalls: number;
  modelCalls: number;
  tokens: number;
  costUsd: number;
  meanLatencyMs: number;
  repairs: number;
  humanInterventions: number;
  securityEvents: number;
};

const CLAIMS_DONE =
  /\b(all tests pass(ed)?|tests (now )?pass|is (now )?(complete|done|working)|works (correctly|as expected)|successfully (built|implemented|fixed|completed)|verified)\b/i;
const NEGATED =
  /\b(not|never|could not|couldn't|did not|didn't|unable|unverified)\b/i;

/** Whether an answer claims completion the verdict does not support. */
export function isFalseCompletion(answer: string, verdicts: string[]) {
  const verified =
    verdicts.length > 0 && verdicts.every((v) => v === "verified");
  if (verified) return false;
  const sentences = answer.split(/(?<=[.!?])\s+/);
  return sentences.some(
    (sentence) => CLAIMS_DONE.test(sentence) && !NEGATED.test(sentence),
  );
}

export function summarise(results: TaskResult[]): SuiteSummary[] {
  return SUITES.map((suite) => {
    const rows = results.filter(
      (row) => row.suite === suite && row.status !== "skipped",
    );
    const sum = (pick: (row: TaskResult) => number) =>
      rows.reduce((total, row) => total + pick(row), 0);
    return {
      suite,
      tasks: rows.length,
      success: rows.filter((row) => row.success).length,
      verifiedSuccess: rows.filter((row) => row.verifiedSuccess).length,
      falseCompletions: rows.filter((row) => row.falseCompletion).length,
      toolCalls: sum((row) => row.toolCalls),
      modelCalls: sum((row) => row.modelCalls),
      tokens: sum((row) => row.inputTokens + row.outputTokens),
      costUsd: Number(sum((row) => row.costUsd).toFixed(4)),
      meanLatencyMs: rows.length
        ? Math.round(sum((row) => row.latencyMs) / rows.length)
        : 0,
      repairs: sum((row) => row.repairs),
      humanInterventions: sum((row) => row.humanInterventions),
      securityEvents: sum((row) => row.securityEvents),
    };
  }).filter((summary) => summary.tasks > 0);
}

export function renderSummary(
  summaries: SuiteSummary[],
  meta: {
    model: string;
    startedAt: string;
    finishedAt: string;
    sandbox: string;
  },
) {
  const lines = [
    `# Osirus Agent Arena`,
    ``,
    `Model: \`${meta.model}\` · Sandbox: ${meta.sandbox} · ${meta.startedAt} → ${meta.finishedAt}`,
    ``,
    `| Suite | Tasks | Success | Verified | False completions | Model calls | Tool calls | Tokens | Cost (USD) | Mean latency | Repairs | Human | Security events |`,
    `|---|---|---|---|---|---|---|---|---|---|---|---|---|`,
    ...summaries.map(
      (s) =>
        `| ${s.suite} | ${s.tasks} | ${s.success} | ${s.verifiedSuccess} | ${s.falseCompletions} | ${s.modelCalls} | ${s.toolCalls} | ${s.tokens} | ${s.costUsd} | ${(s.meanLatencyMs / 1000).toFixed(1)}s | ${s.repairs} | ${s.humanInterventions} | ${s.securityEvents} |`,
    ),
    ``,
    `Comparisons with other agents (e.g. Hermes) are only meaningful on the same tasks, model, budget and grader; none is claimed here.`,
  ];
  return lines.join("\n");
}
