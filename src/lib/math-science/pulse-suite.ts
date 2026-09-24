// M37 — Math/Science pulse suite levels L1–L5.
//
// Offline tasks with increasing complexity. Each level adds distractors,
// unit checks, multi-step computation, or proof-sketch requirements.
// Used by runMathSciencePulse and hooked from the capability baseline path.

export type PulseLevel = 1 | 2 | 3 | 4 | 5;

export type PulseTask = {
  id: string;
  level: PulseLevel;
  domain: "MATH" | "SCIENCE";
  objective: string;
  /** Substrings a honest successful answer should contain. */
  expectIncludes: string[];
  /** When set, a definite Result: line should not appear. */
  expectUnderdetermined?: boolean;
  notes: string;
};

export const MATH_SCIENCE_PULSE_TASKS: PulseTask[] = [
  {
    id: "pulse-l1-discount",
    level: 1,
    domain: "MATH",
    objective:
      "A price is 50. Apply a 10% discount. What is paid? State Result: with no units.",
    expectIncludes: ["45", "Result:"],
    notes: "L1: single compute.run, arithmetic sanity.",
  },
  {
    id: "pulse-l1-unit-sum",
    level: 1,
    domain: "SCIENCE",
    objective:
      "Two masses are 2.0 kg and 3.5 kg. What is their total mass in kg? End with Result:.",
    expectIncludes: ["5.5", "kg", "Result:"],
    notes: "L1: unit-bearing addition.",
  },
  {
    id: "pulse-l2-linear",
    level: 2,
    domain: "MATH",
    objective: "Solve 3x + 7 = 22 for x. Show the steps and end with Result:.",
    expectIncludes: ["5", "Result:"],
    notes: "L2: single unknown, one equation.",
  },
  {
    id: "pulse-l2-moles",
    level: 2,
    domain: "SCIENCE",
    objective:
      "How many moles are in 18 g of water (molar mass 18 g/mol)? End with Result: including mol.",
    expectIncludes: ["1", "mol", "Result:"],
    notes: "L2: stoichiometry with units.",
  },
  {
    id: "pulse-l3-discount-tax",
    level: 3,
    domain: "MATH",
    objective:
      "A price is 80. Apply a 15% discount, then a 10% tax on the discounted price. What is paid?",
    expectIncludes: ["74.8", "Result:"],
    notes: "L3: multi-step percent chain (M30 MATH baseline).",
  },
  {
    id: "pulse-l3-projectile",
    level: 3,
    domain: "SCIENCE",
    objective:
      "A ball is thrown straight up at 20 m/s from ground level. Using g = 9.81 m/s^2, compute the maximum height in metres. Check units.",
    expectIncludes: ["20.387359", "m", "Result:"],
    notes: "L3: kinematics + dimension check.",
  },
  {
    id: "pulse-l4-pump-leak",
    level: 4,
    domain: "SCIENCE",
    objective:
      "A pump fills a tank in 6 hours. A leak empties it in 12 hours. Starting empty, both run. How many hours to fill? Revise if an estimate ignores the leak.",
    expectIncludes: ["12", "leak", "Result:"],
    notes: "L4: net-rate reasoning (M30 REASONING baseline).",
  },
  {
    id: "pulse-l4-integral",
    level: 4,
    domain: "MATH",
    objective:
      "Compute the definite integral of x^2 * e^x from 0 to 1 exactly and numerically.",
    expectIncludes: ["0.718281", "Result:"],
    notes: "L4: calculus with numeric cross-check.",
  },
  {
    id: "pulse-l5-underdetermined",
    level: 5,
    domain: "MATH",
    objective:
      "Find x and y given only that x + y = 10. Do not invent a second equation.",
    expectIncludes: ["underdetermined", "not enough"],
    expectUnderdetermined: true,
    notes: "L5: honest failure when underdetermined.",
  },
  {
    id: "pulse-l5-universal",
    level: 5,
    domain: "MATH",
    objective:
      "Is n^2 + n + 41 prime for every positive integer n? Search for a counterexample before answering.",
    expectIncludes: ["counterexample", "40"],
    notes: "L5: counterexample search at n=40.",
  },
];

export function pulseTasksForLevel(level: PulseLevel): PulseTask[] {
  return MATH_SCIENCE_PULSE_TASKS.filter((task) => task.level === level);
}

export function pulseTasksUpToLevel(level: PulseLevel): PulseTask[] {
  return MATH_SCIENCE_PULSE_TASKS.filter((task) => task.level <= level);
}
