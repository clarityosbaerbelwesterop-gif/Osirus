import { z } from "zod";

// Task modelling (M57): before solving, Rouge builds an explicit model of
// the task -- what kind of problem it is, what is given, what must hold,
// where it is easy to go wrong, how hard it is, and which distinct ways of
// attacking it exist. The model steers everything after it: how many
// independent approaches run, which ones, what the adjudicator checks, and
// whether the answer needs deliberation at all.

export const TASK_KINDS = [
  "computation",
  "logic",
  "code",
  "knowledge",
  "analysis",
  "writing",
  "conversation",
] as const;

const approach = z.object({
  name: z.string().min(1).max(60),
  how: z.string().min(1).max(300),
});

export const taskModelSchema = z.object({
  kind: z.enum(TASK_KINDS),
  goal: z.string().min(1).max(400),
  givens: z.array(z.string().max(300)).max(12).default([]),
  constraints: z.array(z.string().max(300)).max(10).default([]),
  pitfalls: z.array(z.string().max(300)).max(6).default([]),
  difficulty: z.number().int().min(1).max(5),
  needsReasoning: z.boolean(),
  approaches: z.array(approach).max(4).default([]),
});

export type TaskModel = z.infer<typeof taskModelSchema>;

export const TASK_MODEL_INSTRUCTION = [
  "You analyse a task before anyone solves it. Do not solve it.",
  "Return one JSON object with exactly these keys:",
  '- "kind": one of computation, logic, code, knowledge, analysis, writing, conversation',
  '- "goal": what exactly must be produced, in one sentence',
  '- "givens": the facts and numbers the task provides',
  '- "constraints": conditions the answer must satisfy, including any required answer format',
  '- "pitfalls": the specific mistakes a careful solver could still make on THIS task (e.g. off-by-one in dates, miscounting repeated letters, order of operations)',
  '- "difficulty": 1 (trivial) to 5 (hard, multi-step, easy to get wrong)',
  '- "needsReasoning": true unless the answer is immediate',
  '- "approaches": 2 or 3 genuinely different ways to solve it, each {"name", "how"}; different methods, not rephrasings (e.g. direct computation vs. decomposition vs. working backwards and checking)',
  "Output only the JSON object.",
].join("\n");

/** Kinds a model tends to write instead of ours. */
const KIND_ALIASES: Record<string, (typeof TASK_KINDS)[number]> = {
  math: "computation",
  mathematics: "computation",
  arithmetic: "computation",
  calculation: "computation",
  quantitative: "computation",
  reasoning: "logic",
  puzzle: "logic",
  deduction: "logic",
  programming: "code",
  coding: "code",
  factual: "knowledge",
  creative: "writing",
  chat: "conversation",
  "small talk": "conversation",
};

function kindOf(value: unknown): (typeof TASK_KINDS)[number] {
  const kind = String(value ?? "")
    .trim()
    .toLowerCase();
  if ((TASK_KINDS as readonly string[]).includes(kind))
    return kind as (typeof TASK_KINDS)[number];
  return KIND_ALIASES[kind] ?? "analysis";
}

function jsonIn(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const source = fenced ?? text;
  const start = source.indexOf("{");
  const end = source.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("no JSON object");
  return JSON.parse(source.slice(start, end + 1));
}

/** Parse a model-written task model; tolerant of fences and prose around it. */
export function parseTaskModel(text: string): TaskModel | null {
  try {
    const raw = jsonIn(text) as Record<string, unknown>;
    const difficulty = Math.round(Number(raw.difficulty));
    return taskModelSchema.parse({
      ...raw,
      kind: kindOf(raw.kind),
      goal: String(raw.goal ?? "").slice(0, 400) || "answer the request",
      difficulty: Number.isFinite(difficulty)
        ? Math.min(5, Math.max(1, difficulty))
        : 3,
      needsReasoning:
        typeof raw.needsReasoning === "boolean" ? raw.needsReasoning : true,
      approaches: Array.isArray(raw.approaches)
        ? raw.approaches
            .filter(
              (a): a is Record<string, unknown> =>
                typeof a === "object" && a !== null,
            )
            .map((a) => ({
              name: String(a.name ?? "approach").slice(0, 60),
              how:
                String(a.how ?? a.description ?? "").slice(0, 300) ||
                "solve it",
            }))
            .slice(0, 4)
        : [],
      givens: Array.isArray(raw.givens)
        ? raw.givens.map(String).slice(0, 12)
        : [],
      constraints: Array.isArray(raw.constraints)
        ? raw.constraints.map(String).slice(0, 10)
        : [],
      pitfalls: Array.isArray(raw.pitfalls)
        ? raw.pitfalls.map(String).slice(0, 6)
        : [],
    });
  } catch {
    return null;
  }
}

/** Used when the task model cannot be built: assume it is worth thinking about. */
export function fallbackTaskModel(goal: string): TaskModel {
  return {
    kind: "analysis",
    goal: goal.slice(0, 400),
    givens: [],
    constraints: [],
    pitfalls: [],
    difficulty: 3,
    needsReasoning: true,
    approaches: [],
  };
}

/** Distinct approaches to run, padded with general-purpose ones. */
export function approachesFor(model: TaskModel, count: number) {
  const general = [
    {
      name: "careful step-by-step",
      how: "Work forward step by step, writing down every intermediate result.",
    },
    {
      name: "decompose and verify",
      how: "Split the task into independent parts, solve each, then check the combined result against every constraint.",
    },
    {
      name: "estimate then check",
      how: "First estimate or bound the answer, then compute it exactly and confirm it is consistent with the estimate and the givens.",
    },
  ];
  const chosen = [...model.approaches];
  for (const candidate of general) {
    if (chosen.length >= count) break;
    if (!chosen.some((a) => a.name.toLowerCase() === candidate.name))
      chosen.push(candidate);
  }
  return chosen.slice(0, count);
}

/** The task model as briefing text for solvers and the adjudicator. */
export function briefing(model: TaskModel) {
  const lines = [`Goal: ${model.goal}`];
  if (model.givens.length) lines.push(`Givens: ${model.givens.join("; ")}`);
  if (model.constraints.length)
    lines.push(`Constraints: ${model.constraints.join("; ")}`);
  if (model.pitfalls.length)
    lines.push(`Known pitfalls to avoid: ${model.pitfalls.join("; ")}`);
  return lines.join("\n");
}
