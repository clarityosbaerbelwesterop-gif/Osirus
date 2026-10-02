/**
 * AI Lab — eval runner skeleton (Phase J).
 *
 * Runs local task fixtures (JSON) against any `ModelBackend` and records one
 * `EvalRecord` per task with the full model / seed / config triple. The seed
 * is mandatory and enforced at runtime: pass@1 numbers without a seed are not
 * acceptable evidence in this program (contracts/model-backend.ts, reuse doc
 * § 3 eval-harness row).
 *
 * Benchmark philosophy (see PHILOSOPHY.md, spec § 27):
 * - Deterministic graders first. Exact-match / contains / regex grading is
 *   the default; deterministic checks outrank model judgment.
 * - Model-as-judge is refused unless explicitly enabled per run
 *   (`allowModelJudge: true`) and is then flagged (`modelJudged: true`) on
 *   every record it produced, so judged numbers can never be mixed silently
 *   into deterministically graded results.
 * - Reported vs. measured: only records produced by this runner count as
 *   measured. Third-party numbers must be re-measured here before they may
 *   appear in any Osirus artifact.
 *
 * This module performs no network or GPU calls itself; the backend decides.
 * Tests use a FakeBackend — real model calls never run inside the test gate.
 */

import type { BackendKind, ModelBackend } from "../contracts/model-backend";
import { fnv1aHash } from "../datasets/pipeline";

/** Deterministic grader kinds, plus the gated model-as-judge escape hatch. */
export type GraderKind = "exact_match" | "contains" | "regex" | "model_judge";

export interface EvalGrader {
  readonly kind: GraderKind;
  /**
   * Expected answer for exact_match, required substring for contains, source
   * of the regular expression for regex. Unused for model_judge.
   */
  readonly expected?: string;
}

/** One task from a local JSON fixture. */
export interface EvalTaskSpec {
  /** Unique task identifier, e.g. "humaneval/0". */
  readonly taskId: string;
  /** Prompt text handed to the backend unchanged. */
  readonly prompt: string;
  /** Deterministic grader by default; model_judge only when gated on. */
  readonly grader: EvalGrader;
  /** Hard cap on generated tokens (default 256). */
  readonly maxTokens?: number;
  /** Sampling temperature; use 0 for deterministic eval decoding (default 0). */
  readonly temperature?: number;
  /** Optional stop sequences forwarded to the backend. */
  readonly stop?: readonly string[];
}

/**
 * One graded eval result. This is the unit of measured evidence: model,
 * backend kind, seed, and config hash are always recorded so a number can
 * never be detached from the conditions that produced it.
 */
export interface EvalRecord {
  /** Honest upstream model identifier (never a rebrand). */
  readonly modelId: string;
  readonly backendKind: BackendKind;
  /** Mandatory RNG seed of the run. */
  readonly seed: number;
  /** FNV-1a hash of the stable-stringified run config. */
  readonly configHash: string;
  readonly taskId: string;
  readonly pass: boolean;
  /** Wall-clock latency reported by the backend, in milliseconds. */
  readonly latencyMs: number;
  /** ISO 8601 timestamp of the record. */
  readonly createdAt: string;
  /** Which grader produced the verdict. */
  readonly graderKind: GraderKind;
  /**
   * True only when the verdict came from model-as-judge (explicitly enabled
   * for the run). Deterministically graded records always carry `false`.
   */
  readonly modelJudged: boolean;
}

export interface RunEvalsOptions {
  readonly backend: ModelBackend;
  readonly tasks: readonly EvalTaskSpec[];
  /**
   * Mandatory RNG seed, forwarded to every generation request and recorded
   * on every record. Must be a finite integer — otherwise the run throws.
   */
  readonly seed: number;
  /** Run configuration; hashed into `configHash` for attribution. */
  readonly config?: Record<string, unknown>;
  /**
   * Escape hatch for model-as-judge tasks. Defaults to false; without it any
   * `model_judge` task aborts the run. Judged records are flagged.
   */
  readonly allowModelJudge?: boolean;
  /**
   * Judge function for model-as-judge tasks. Required when a run contains
   * `model_judge` tasks and `allowModelJudge` is set. Receives the task and
   * the final answer, returns the verdict. Kept injectable so tests never
   * make real model calls.
   */
  readonly judge?: (task: EvalTaskSpec, answer: string) => Promise<boolean>;
  /** Injectable clock for deterministic tests. Defaults to wall clock. */
  readonly now?: () => Date;
}

/** Deterministic JSON stringify with sorted object keys. */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  const parts = keys.map(
    (key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`,
  );
  return `{${parts.join(",")}}`;
}

/** Stable config hash (FNV-1a over the sorted-key JSON serialization). */
export function configHash(config: Record<string, unknown>): string {
  return fnv1aHash(stableStringify(config)).toString(16).padStart(8, "0");
}

/** Grade a final answer with a deterministic grader. */
export function gradeDeterministic(
  grader: EvalGrader,
  answer: string,
): boolean {
  switch (grader.kind) {
    case "exact_match":
      return answer.trim() === (grader.expected ?? "").trim();
    case "contains":
      return answer.includes(grader.expected ?? "");
    case "regex":
      return new RegExp(grader.expected ?? "", "m").test(answer);
    default:
      throw new Error(
        `grader kind "${grader.kind}" is not deterministic; ` +
          "model-as-judge requires allowModelJudge: true",
      );
  }
}

/**
 * Run all tasks against the backend and return one EvalRecord per task, in
 * task order. Throws when the seed is missing/invalid or a model_judge task
 * appears without `allowModelJudge: true`. No result is recorded silently:
 * either every task yields a complete record or the run fails.
 */
export async function runEvals(
  options: RunEvalsOptions,
): Promise<EvalRecord[]> {
  const {
    backend,
    tasks,
    seed,
    config = {},
    allowModelJudge = false,
    judge,
  } = options;
  const now = options.now ?? (() => new Date());
  if (!Number.isFinite(seed) || !Number.isInteger(seed)) {
    throw new Error(
      "runEvals requires a finite integer seed — eval results without a " +
        "recorded seed are not acceptable evidence",
    );
  }
  const hash = configHash(config);
  const records: EvalRecord[] = [];
  for (const task of tasks) {
    if (task.grader.kind === "model_judge") {
      if (!allowModelJudge || judge === undefined) {
        throw new Error(
          `task "${task.taskId}" uses model-as-judge but the run did not ` +
            "enable allowModelJudge with a judge function — deterministic " +
            "graders are the default",
        );
      }
    }
    const result = await backend.generate({
      prompt: task.prompt,
      maxTokens: task.maxTokens ?? 256,
      temperature: task.temperature ?? 0,
      seed,
      ...(task.stop !== undefined ? { stop: task.stop } : {}),
    });
    const pass =
      task.grader.kind === "model_judge"
        ? // judge is guaranteed present by the guard above.
          await (judge as NonNullable<typeof judge>)(task, result.text)
        : gradeDeterministic(task.grader, result.text);
    records.push({
      modelId: backend.modelId,
      backendKind: backend.kind,
      seed,
      configHash: hash,
      taskId: task.taskId,
      pass,
      latencyMs: result.latencyMs,
      createdAt: now().toISOString(),
      graderKind: task.grader.kind,
      modelJudged: task.grader.kind === "model_judge",
    });
  }
  return records;
}

/**
 * Validate parsed fixture JSON into task specs. Returns human-readable
 * errors (empty array = valid), mirroring the contract-validator style of
 * ai-lab/contracts. Keeps fixture loading honest: malformed tasks fail
 * before any backend call.
 */
export function validateTaskFixture(value: unknown): string[] {
  const errors: string[] = [];
  if (!Array.isArray(value)) {
    return ["task fixture must be an array of tasks"];
  }
  value.forEach((task, index) => {
    const label = `task[${index}]`;
    if (typeof task !== "object" || task === null || Array.isArray(task)) {
      errors.push(`${label} must be an object`);
      return;
    }
    const t = task as Record<string, unknown>;
    if (typeof t.taskId !== "string" || t.taskId.trim() === "") {
      errors.push(`${label}.taskId must be a non-empty string`);
    }
    if (typeof t.prompt !== "string") {
      errors.push(`${label}.prompt must be a string`);
    }
    if (typeof t.grader !== "object" || t.grader === null) {
      errors.push(`${label}.grader must be an object`);
    } else {
      const g = t.grader as Record<string, unknown>;
      if (
        g.kind !== "exact_match" &&
        g.kind !== "contains" &&
        g.kind !== "regex" &&
        g.kind !== "model_judge"
      ) {
        errors.push(`${label}.grader.kind must be a known grader kind`);
      }
      if (g.kind !== "model_judge" && typeof g.expected !== "string") {
        errors.push(
          `${label}.grader.expected must be a string for deterministic graders`,
        );
      }
    }
  });
  return errors;
}

/** Parse fixture JSON text into validated task specs; throws on invalid. */
export function parseTaskFixture(jsonText: string): EvalTaskSpec[] {
  const parsed: unknown = JSON.parse(jsonText);
  const errors = validateTaskFixture(parsed);
  if (errors.length > 0) {
    throw new Error(`invalid task fixture: ${errors.join("; ")}`);
  }
  return parsed as EvalTaskSpec[];
}
