/**
 * GitOps control plane — asynchronous agent swarm for verified synthetic data.
 *
 * Logical agents (role x count) work a shared task queue with bounded
 * concurrency. A candidate becomes a "golden" record only after it clears,
 * in order of cost: shape checks, decontamination against eval sets,
 * near-duplicate filtering, unit tests in the isolated sandbox, and the
 * process reward model threshold. Every rejection is counted by reason, so
 * the run report is the audit trail.
 */

import {
  decontaminate,
  jaccardSimilarity,
  tokenShingles,
} from "../../datasets/pipeline";
import { sha256 } from "./load";
import type { SwarmPipeline } from "./schema";

export interface SwarmTask {
  readonly id: string;
  readonly role: string;
  readonly topic: string;
  readonly instructions: string;
}

export interface Candidate {
  readonly prompt: string;
  readonly solution: string;
  readonly tests: string;
  readonly steps: readonly string[];
}

export interface GoldenRecord {
  readonly prompt: readonly [
    { readonly role: "user"; readonly content: string },
  ];
  readonly completion: readonly [
    { readonly role: "assistant"; readonly content: string },
  ];
  readonly meta: {
    readonly taskId: string;
    readonly role: string;
    readonly topic: string;
    readonly teacher: string;
    readonly prmScore: number | null;
    readonly testsPassed: true;
    readonly sha256: string;
  };
}

export type RejectReason =
  | "budget-exhausted"
  | "generation-error"
  | "malformed"
  | "contaminated"
  | "duplicate"
  | "tests-failed"
  | "vacuous-tests"
  | "prm-unavailable"
  | "prm-error"
  | "prm-below-threshold";

export interface SwarmDeps {
  /** Teacher call: returns raw model text for the task. */
  readonly generate: (task: SwarmTask) => Promise<string>;
  /** Runs the candidate's tests in the sandbox. */
  readonly verify: (candidate: Candidate) => Promise<{
    passed: boolean;
    detail: string;
    reason?: "tests-failed" | "vacuous-tests";
  }>;
  /** Process reward model: one score in [0, 1] per step. */
  readonly scoreSteps?: (candidate: Candidate) => Promise<number[]>;
}

export interface SwarmReport {
  readonly tasks: number;
  readonly teacherRequests: number;
  readonly accepted: number;
  readonly rejected: Readonly<Partial<Record<RejectReason, number>>>;
  readonly records: readonly GoldenRecord[];
}

export const TEACHER_SYSTEM_PROMPT = [
  "You write one self-contained, verifiable Python training example.",
  "Reply with exactly one JSON object and nothing else:",
  '{"prompt": "<task statement a user would send>",',
  ' "solution": "<complete module solution.py, standard library only>",',
  ' "tests": "<unittest module test_solution.py that imports from solution and checks behaviour and edge cases>",',
  ' "steps": ["<short ordered plan step>", "..."]}',
  "No network, no subprocess, no file writes. Tests must fail on a wrong solution.",
].join("\n");

export function teacherUserPrompt(task: SwarmTask): string {
  return `Role: ${task.role}\n${task.instructions}\nTopic: ${task.topic}\nVariant: ${task.id} (make it distinct from other variants).`;
}

/** Deterministic task list: every agent instance gets `tasksPerAgent` tasks, topics round-robin. */
export function swarmTasks(p: SwarmPipeline): SwarmTask[] {
  const tasks: SwarmTask[] = [];
  let n = 0;
  for (const agent of p.agents) {
    for (let instance = 0; instance < agent.count; instance++) {
      for (let k = 0; k < p.tasksPerAgent; k++) {
        tasks.push({
          id: `${agent.role}-${instance}-${k}`,
          role: agent.role,
          topic: p.topics[n++ % p.topics.length],
          instructions: agent.instructions,
        });
      }
    }
  }
  return tasks;
}

const LIMITS = { prompt: 8_000, solution: 32_000, tests: 32_000, steps: 32 };

/** Extracts the JSON object from a teacher reply (tolerates code fences and prose around it). */
export function parseCandidate(text: string): Candidate | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
  const o = raw as Record<string, unknown>;
  const ok = (v: unknown, max: number): v is string =>
    typeof v === "string" && v.trim() !== "" && v.length <= max;
  if (
    !ok(o.prompt, LIMITS.prompt) ||
    !ok(o.solution, LIMITS.solution) ||
    !ok(o.tests, LIMITS.tests)
  )
    return null;
  const steps = o.steps;
  if (
    !Array.isArray(steps) ||
    steps.length === 0 ||
    steps.length > LIMITS.steps ||
    !steps.every((s) => ok(s, 2_000))
  ) {
    return null;
  }
  if (!/\bimport\s+unittest\b/.test(o.tests) || !/\bsolution\b/.test(o.tests))
    return null;
  return {
    prompt: o.prompt,
    solution: o.solution,
    tests: o.tests,
    steps: steps as string[],
  };
}

export function aggregate(
  scores: readonly number[],
  how: "min" | "mean" | "last",
): number {
  if (scores.length === 0) return 0;
  if (how === "min") return Math.min(...scores);
  if (how === "last") return scores[scores.length - 1];
  return scores.reduce((a, b) => a + b, 0) / scores.length;
}

export async function runSwarm(opts: {
  readonly pipeline: SwarmPipeline;
  readonly teacherId: string;
  /** Texts of every eval item the trained models will be measured on. */
  readonly evalTexts: readonly string[];
  readonly deps: SwarmDeps;
  readonly tasks?: readonly SwarmTask[];
}): Promise<SwarmReport> {
  const p = opts.pipeline;
  const tasks = opts.tasks ?? swarmTasks(p);
  const queue = [...tasks];
  const rejected: Partial<Record<RejectReason, number>> = {};
  const reject = (r: RejectReason) =>
    void (rejected[r] = (rejected[r] ?? 0) + 1);
  const records: GoldenRecord[] = [];
  const accepted: Set<number>[] = [];
  let teacherRequests = 0;

  const isDuplicate = (shingles: Set<number>) =>
    accepted.some(
      (other) => jaccardSimilarity(shingles, other) >= p.dedup.jaccardThreshold,
    );

  async function work(task: SwarmTask): Promise<void> {
    if (teacherRequests >= p.maxTeacherRequests)
      return reject("budget-exhausted");
    teacherRequests++;
    let text: string;
    try {
      text = await opts.deps.generate(task);
    } catch {
      return reject("generation-error");
    }
    const c = parseCandidate(text);
    if (!c) return reject("malformed");
    const content = `${c.prompt}\n${c.solution}\n${c.tests}`;
    if (
      decontaminate([{ id: task.id, content }], opts.evalTexts, {
        ngramSize: p.decontamination.ngramSize,
      }).length === 0
    ) {
      return reject("contaminated");
    }
    const shingles = tokenShingles(`${c.prompt}\n${c.solution}`);
    if (isDuplicate(shingles)) return reject("duplicate");
    const verdict = await opts.deps.verify(c);
    if (!verdict.passed) return reject(verdict.reason ?? "tests-failed");
    let prmScore: number | null = null;
    if (opts.deps.scoreSteps) {
      try {
        prmScore = aggregate(
          await opts.deps.scoreSteps(c),
          p.verification.prm.aggregation,
        );
      } catch {
        return reject("prm-error");
      }
      if (prmScore < p.verification.prm.threshold)
        return reject("prm-below-threshold");
    } else if (p.verification.prm.required) {
      return reject("prm-unavailable");
    }
    // Other workers may have accepted a near-copy while this one awaited.
    if (isDuplicate(shingles)) return reject("duplicate");
    accepted.push(shingles);
    records.push({
      prompt: [{ role: "user", content: c.prompt }],
      completion: [{ role: "assistant", content: c.solution }],
      meta: {
        taskId: task.id,
        role: task.role,
        topic: task.topic,
        teacher: opts.teacherId,
        prmScore,
        testsPassed: true,
        sha256: sha256(content),
      },
    });
  }

  const workers = Array.from(
    { length: Math.min(p.concurrency, queue.length) },
    async () => {
      for (let task = queue.shift(); task; task = queue.shift())
        await work(task);
    },
  );
  await Promise.all(workers);
  records.sort((a, b) =>
    a.meta.taskId < b.meta.taskId ? -1 : a.meta.taskId > b.meta.taskId ? 1 : 0,
  );
  return {
    tasks: tasks.length,
    teacherRequests,
    accepted: records.length,
    rejected,
    records,
  };
}
