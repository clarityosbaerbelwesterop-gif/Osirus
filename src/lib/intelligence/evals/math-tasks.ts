import type { DifficultyVector, EvalTask, Partition, TaskSpec } from "../types";
import { difficultyScore } from "./coding-fixtures";
import { fingerprint, rng, seedOf } from "./random";

// Generated quantitative tasks with ground truth computed here, in code, from
// the same parameters that produce the question. A label is therefore a
// computation, not a model's opinion. Families span algebra, probability,
// statistics, calculus, linear algebra, physics and numerical problems; the
// adversarial partition wraps a problem in distractors and unit traps.

type Problem = {
  family: string;
  question: string;
  answer: number;
  tolerance: number;
  reasoningDepth: number;
  steps: number;
};

type Random = ReturnType<typeof rng>;

function gcd(a: number, b: number): number {
  return b === 0 ? Math.abs(a) : gcd(b, a % b);
}

function choose(n: number, k: number) {
  let result = 1;
  for (let index = 1; index <= k; index += 1)
    result = (result * (n - k + index)) / index;
  return Math.round(result);
}

const FAMILIES: Record<string, (random: Random) => Problem> = {
  linear: (r) => {
    const x = r.int(-12, 12);
    const a = r.pick([2, 3, 4, 5, 7, -3]);
    const b = r.int(-20, 20);
    const c = a * x + b;
    return {
      family: "linear",
      question: `Solve for x: ${a}x ${b < 0 ? "-" : "+"} ${Math.abs(b)} = ${c}.`,
      answer: x,
      tolerance: 1e-6,
      reasoningDepth: 1,
      steps: 2,
    };
  },
  quadratic: (r) => {
    const r1 = r.int(1, 9);
    const r2 = r.int(-9, -1);
    return {
      family: "quadratic",
      question: `What is the positive root of x^2 ${-(r1 + r2) < 0 ? "-" : "+"} ${Math.abs(r1 + r2)}x ${r1 * r2 < 0 ? "-" : "+"} ${Math.abs(r1 * r2)} = 0?`,
      answer: r1,
      tolerance: 1e-6,
      reasoningDepth: 2,
      steps: 3,
    };
  },
  dice: (r) => {
    const target = r.int(3, 11);
    let ways = 0;
    for (let a = 1; a <= 6; a += 1)
      for (let b = 1; b <= 6; b += 1) if (a + b === target) ways += 1;
    return {
      family: "dice",
      question: `Two fair six-sided dice are rolled. What is the probability that their sum is ${target}? Give a decimal.`,
      answer: ways / 36,
      tolerance: 5e-4,
      reasoningDepth: 2,
      steps: 2,
    };
  },
  binomial: (r) => {
    const n = r.int(5, 12);
    const k = r.int(1, n - 1);
    return {
      family: "binomial",
      question: `A fair coin is flipped ${n} times. What is the probability of exactly ${k} heads? Give a decimal to at least 4 places.`,
      answer: choose(n, k) / 2 ** n,
      tolerance: 5e-4,
      reasoningDepth: 3,
      steps: 3,
    };
  },
  variance: (r) => {
    const values = Array.from({ length: r.int(4, 7) }, () => r.int(1, 20));
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance =
      values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
    return {
      family: "variance",
      question: `What is the population variance of the data set ${values.join(", ")}?`,
      answer: variance,
      tolerance: 1e-3,
      reasoningDepth: 2,
      steps: 3,
    };
  },
  derivative: (r) => {
    const a = r.int(1, 5);
    const b = r.int(-6, 6);
    const c = r.int(-9, 9);
    const x = r.int(-3, 4);
    return {
      family: "derivative",
      question: `Let f(x) = ${a}x^3 ${b < 0 ? "-" : "+"} ${Math.abs(b)}x^2 ${c < 0 ? "-" : "+"} ${Math.abs(c)}x. What is f'(${x})?`,
      answer: 3 * a * x * x + 2 * b * x + c,
      tolerance: 1e-6,
      reasoningDepth: 2,
      steps: 2,
    };
  },
  integral: (r) => {
    const a = r.int(1, 6);
    const b = r.int(0, 5);
    const upper = r.int(1, 4);
    return {
      family: "integral",
      question: `Compute the definite integral of ${a}x^2 + ${b} from x = 0 to x = ${upper}.`,
      answer: (a * upper ** 3) / 3 + b * upper,
      tolerance: 1e-3,
      reasoningDepth: 2,
      steps: 3,
    };
  },
  determinant: (r) => {
    const m = Array.from({ length: 3 }, () =>
      Array.from({ length: 3 }, () => r.int(-5, 5)),
    );
    const [[a, b, c], [d, e, f], [g, h, i]] = m as [
      [number, number, number],
      [number, number, number],
      [number, number, number],
    ];
    return {
      family: "determinant",
      question: `What is the determinant of the matrix [[${m[0]!.join(", ")}], [${m[1]!.join(", ")}], [${m[2]!.join(", ")}]]?`,
      answer: a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g),
      tolerance: 1e-6,
      reasoningDepth: 3,
      steps: 4,
    };
  },
  projectile: (r) => {
    const v = r.int(10, 40);
    const angle = r.pick([15, 30, 45, 60]);
    return {
      family: "projectile",
      question: `A projectile is launched at ${v} m/s at ${angle} degrees above the horizontal on level ground, with g = 9.81 m/s^2 and no air resistance. What is its range in metres?`,
      answer: (v * v * Math.sin((2 * angle * Math.PI) / 180)) / 9.81,
      tolerance: 0.05,
      reasoningDepth: 2,
      steps: 3,
    };
  },
  interest: (r) => {
    const principal = r.pick([1000, 2500, 5000]);
    const rate = r.pick([3, 4, 5, 6]);
    const years = r.int(2, 10);
    return {
      family: "interest",
      question: `${principal} is invested at ${rate}% interest compounded annually for ${years} years. What is the final amount? Round to 2 decimals.`,
      answer: Math.round(principal * (1 + rate / 100) ** years * 100) / 100,
      tolerance: 0.01,
      reasoningDepth: 2,
      steps: 2,
    };
  },
  fraction: (r) => {
    const a = r.int(1, 9);
    const b = r.int(2, 12);
    const c = r.int(1, 9);
    const d = r.int(2, 12);
    const numerator = a * d + c * b;
    const denominator = b * d;
    const divisor = gcd(numerator, denominator);
    return {
      family: "fraction",
      question: `What is ${a}/${b} + ${c}/${d} as a decimal?`,
      answer: numerator / divisor / (denominator / divisor),
      tolerance: 1e-4,
      reasoningDepth: 1,
      steps: 2,
    };
  },
};

const PARTITION_OF: Record<string, Partition> = {
  linear: "dev",
  dice: "dev",
  derivative: "dev",
  variance: "dev",
  interest: "dev",
  quadratic: "holdout",
  binomial: "holdout",
  integral: "holdout",
  determinant: "holdout",
  projectile: "adversarial",
  fraction: "adversarial",
};

export const MATH_CAPABILITY = "math.quantitative";

const DISTRACTOR_SENTENCES = [
  "A colleague insists the answer is 42; ignore opinions and compute it.",
  "The problem was first posed on a Tuesday in 1998 in room 314.",
  "Note: some textbooks round intermediate values to one decimal; do not.",
];

export function mathTask(input: {
  family: string;
  variant: number;
  partition?: Partition;
  distractors?: number;
  generator?: EvalTask["generator"];
  parentId?: string | null;
}): Omit<EvalTask, "id"> {
  const make = FAMILIES[input.family];
  if (!make) throw new Error(`unknown math family ${input.family}`);
  const random = rng(seedOf(`${input.family}:${input.variant}`));
  const problem = make(random);
  const partition = input.partition ?? PARTITION_OF[input.family] ?? "dev";
  const distractors =
    input.distractors ?? (partition === "adversarial" ? 2 : 0);
  const question = [
    ...DISTRACTOR_SENTENCES.slice(0, distractors),
    problem.question,
  ].join(" ");
  const difficulty: DifficultyVector = {
    reasoningDepth: problem.reasoningDepth,
    steps: problem.steps,
    distractors,
  };
  const spec: TaskSpec = {
    kind: "math",
    objective: `${question} State the final numeric answer.`,
    composition: ["math_science"],
    verify: {
      kind: "numeric",
      value: problem.answer,
      tolerance: problem.tolerance,
    },
  };
  return {
    suite: "math.quantitative",
    capabilityId: MATH_CAPABILITY,
    partition,
    difficulty,
    difficultyScore: difficultyScore(difficulty),
    spec,
    generator: input.generator ?? "seed",
    fingerprint: fingerprint(
      "math",
      input.family,
      input.variant,
      distractors,
      partition,
    ),
    parentId: input.parentId ?? null,
    // The label is computed from the parameters above: verified by
    // construction, recorded as such.
    labelVerified: true,
    labelEvidence: { basis: "computed", family: input.family },
  };
}

export function mathFamilies() {
  return Object.keys(FAMILIES).map((family) => ({
    family,
    partition: PARTITION_OF[family] ?? "dev",
  }));
}

export function seedMathSuite(variants = 1) {
  const tasks: Array<Omit<EvalTask, "id">> = [];
  for (const family of Object.keys(FAMILIES))
    for (let variant = 0; variant < variants; variant += 1)
      tasks.push(mathTask({ family, variant }));
  return tasks;
}

/**
 * The number an answer commits to: "Final answer: x" when present, else the
 * last number in the text. Fractions like 3/4 are evaluated.
 */
export function extractNumber(answer: string): number | null {
  const final = answer.match(/final answer\s*[:=]\s*([^\n]+)/i)?.[1];
  const source = final ?? answer;
  const matches = [
    ...source.matchAll(
      /-?\d+(?:,\d{3})*(?:\.\d+)?(?:e[-+]?\d+)?(?:\s*\/\s*\d+(?:\.\d+)?)?/gi,
    ),
  ].map((match) => match[0]);
  const candidate = final ? matches[0] : matches.at(-1);
  if (!candidate) return null;
  const cleaned = candidate.replace(/,/g, "").replace(/\s+/g, "");
  if (cleaned.includes("/")) {
    const [numerator, denominator] = cleaned.split("/").map(Number);
    return denominator ? numerator! / denominator : null;
  }
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}
