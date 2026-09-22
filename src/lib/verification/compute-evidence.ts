import type { CheckOutcome } from "./engine";

// Is the answer's result something a computation actually produced?
//
// The loop records every compute.run call as structured evidence: the request,
// the value the engine produced, and the independent check of that value. This
// compares the answer's "Result:" line against that record. A number that no
// computation produced is an assertion; a number whose independent check
// disagreed is wrong; only a number that came out of the engine -- and ideally
// survived a second method -- is evidence.

type ComputeEvidence = {
  toolId: string;
  ok: boolean;
  input?: unknown;
  data?: unknown;
};

type ComputeRecord = {
  op: string;
  value: unknown;
  text: string;
  agrees: boolean | null;
  checkMethod: string;
  unitMismatch: boolean;
};

function records(evidence: ComputeEvidence[]): ComputeRecord[] {
  return evidence
    .filter((entry) => entry.toolId === "compute.run" && entry.ok && entry.data)
    .map((entry) => {
      const data = entry.data as {
        result?: {
          op?: string;
          ok?: boolean;
          value?: unknown;
          text?: string;
          error?: string;
        };
        check?: { agrees?: boolean | null; method?: string };
      };
      return {
        op: data.result?.op ?? "unknown",
        value: data.result?.value,
        text: data.result?.text ?? "",
        agrees: data.check?.agrees ?? null,
        checkMethod: data.check?.method ?? "none",
        unitMismatch: data.result?.error === "dimension_mismatch",
      };
    });
}

function numbersIn(value: unknown, into: number[] = []): number[] {
  if (typeof value === "number" && Number.isFinite(value)) into.push(value);
  else if (typeof value === "string") {
    for (const match of value.matchAll(/-?\d+(?:\.\d+)?(?:e[-+]?\d+)?/gi))
      into.push(Number(match[0]));
  } else if (Array.isArray(value))
    value.forEach((item) => numbersIn(item, into));
  else if (value && typeof value === "object")
    Object.values(value).forEach((item) => numbersIn(item, into));
  return into;
}

function close(a: number, b: number) {
  return Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(a), Math.abs(b));
}

function normalise(text: string) {
  return text.replaceAll("**", "^").replace(/\s+/g, "").toLowerCase();
}

export function resultLine(answer: string): string | null {
  return answer.match(/^\s*result\s*:(.*)$/im)?.[1]?.trim() ?? null;
}

export function computeEvidenceCheck(
  answer: string,
  evidence: ComputeEvidence[],
): CheckOutcome {
  const runs = records(evidence);
  const line = resultLine(answer);

  if (runs.length === 0) {
    return {
      status: "inconclusive",
      detail:
        "No computation was run, so the result is asserted rather than computed.",
      evidence: { computeRuns: 0 },
    };
  }
  if (!line) {
    return {
      status: "failed",
      detail: "There is no 'Result:' line to compare with the computations.",
    };
  }

  const stated = numbersIn(line);
  const matchesRun = (run: ComputeRecord) => {
    const produced = numbersIn(run.value).concat(numbersIn(run.text));
    if (stated.length && produced.length) {
      return stated.some((value) =>
        produced.some((computed) => close(value, computed)),
      );
    }
    const symbolic = normalise(run.text || String(run.value ?? ""));
    return symbolic.length > 0 && normalise(line).includes(symbolic);
  };

  const matched = runs.filter(matchesRun);
  const contradicted = matched.filter(
    (run) => run.agrees === false || run.unitMismatch,
  );
  if (contradicted.length > 0) {
    return {
      status: "failed",
      detail: `The stated result comes from a computation its independent check rejected (${contradicted
        .map((run) => `${run.op} via ${run.checkMethod}`)
        .join(", ")}).`,
      evidence: { resultLine: line.slice(0, 200) },
    };
  }
  if (matched.length === 0) {
    return {
      status: "failed",
      detail: `The stated result does not match any of the ${runs.length} computation(s) this run performed.`,
      evidence: {
        resultLine: line.slice(0, 200),
        computed: runs.map((run) => run.text.slice(0, 80)),
      },
    };
  }
  const crossChecked = matched.filter((run) => run.agrees === true);
  return {
    status: "passed",
    detail: crossChecked.length
      ? `Result matches a computation confirmed by an independent method (${crossChecked[0]!.checkMethod}).`
      : "Result matches a deterministic computation; no second method was available to confirm it.",
    evidence: {
      resultLine: line.slice(0, 200),
      method: crossChecked[0]?.checkMethod ?? matched[0]!.op,
      independentlyConfirmed: crossChecked.length > 0,
    },
  };
}
