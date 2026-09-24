import { z } from "zod";

// M37 — Problem formalization for math/science tasks.
//
// Before computing, the arm names what is known, what is unknown, the
// constraints that relate them, and the plan steps that will resolve the
// unknowns. When the problem cannot be uniquely solved from what was stated,
// formalization records that honestly instead of inventing missing values.

export const formalizationStepSchema = z.object({
  step: z.number().int().min(1).max(20),
  action: z.string().min(3).max(400),
  tool: z.enum(["compute.run", "data.analyze", "none"]).optional(),
});

export const problemFormalizationSchema = z.object({
  objective: z.string().min(1).max(4000),
  knowns: z
    .array(
      z.object({
        name: z.string().min(1).max(80),
        description: z.string().min(1).max(300),
        unit: z.string().max(40).optional(),
      }),
    )
    .max(20)
    .default([]),
  unknowns: z
    .array(
      z.object({
        name: z.string().min(1).max(80),
        description: z.string().min(1).max(300),
        unit: z.string().max(40).optional(),
      }),
    )
    .max(12)
    .default([]),
  constraints: z.array(z.string().min(1).max(300)).max(20).default([]),
  assumptions: z.array(z.string().min(1).max(300)).max(12).default([]),
  planSteps: z.array(formalizationStepSchema).min(1).max(12),
  underdetermined: z.boolean(),
  underdeterminedReason: z.string().max(500).optional(),
  needsCounterexampleSearch: z.boolean().default(false),
});

export type ProblemFormalization = z.infer<typeof problemFormalizationSchema>;
export type FormalizationStep = z.infer<typeof formalizationStepSchema>;

const VARIABLE =
  /\b([a-z][a-z0-9_]*)\s*(?:=|is|equals?|was|are|were)\s*(-?\d+(?:\.\d+)?)\s*([a-z/%°]+)?/gi;
const ASK_FOR =
  /\b(find|compute|calculate|solve|determine|what is|how (?:many|much|long|far)|derive|prove)\b/i;
const UNIVERSAL =
  /\b(for all|forall|every|always|never|in general|universally|any\s+\w+\s+such that)\b/i;
const UNDERDETERMINED_SIGNALS = [
  /\bwithout (?:giving|stating|providing)\b/i,
  /\bunknown (?:mass|rate|constant|coefficient|value)\b/i,
  /\bnot enough (?:information|data|equations)\b/i,
  /\bunderdetermined\b/i,
  /\bmultiple solutions\b/i,
  /\binfinite (?:solutions|answers)\b/i,
  /\bunspecified\b/i,
];

function extractKnowns(objective: string) {
  const knowns: ProblemFormalization["knowns"] = [];
  for (const match of objective.matchAll(VARIABLE)) {
    const name = match[1]!;
    const value = match[2]!;
    const unit = match[3]?.trim();
    if (knowns.some((item) => item.name === name)) continue;
    knowns.push({
      name,
      description: `${name} = ${value}${unit ? ` ${unit}` : ""}`,
      unit: unit || undefined,
    });
  }
  const numeric = objective.match(
    /(-?\d+(?:\.\d+)?)\s*(m\/s|kg|mol|J|N|Pa|°C|K|%|m|s|g|L)\b/gi,
  );
  if (numeric) {
    for (const token of numeric.slice(0, 6)) {
      const parts = token.trim().split(/\s+/);
      if (parts.length < 2) continue;
      const label = `value-${knowns.length + 1}`;
      if (knowns.some((item) => item.description.includes(token))) continue;
      knowns.push({
        name: label,
        description: token.trim(),
        unit: parts[1],
      });
    }
  }
  return knowns;
}

function extractUnknowns(objective: string) {
  const unknowns: ProblemFormalization["unknowns"] = [];
  const solveFor = objective.match(
    /\bsolve for\s+([a-z][a-z0-9_]*(?:\s*(?:and|,)\s*[a-z][a-z0-9_]*)*)/i,
  );
  if (solveFor?.[1]) {
    for (const name of solveFor[1].split(/\s*(?:and|,)\s*/i)) {
      const trimmed = name.trim().toLowerCase();
      if (trimmed.length > 0) {
        unknowns.push({ name: trimmed, description: `Solve for ${trimmed}` });
      }
    }
  }
  const findVars = objective.match(
    /\bfind\s+([a-z][a-z0-9_]*(?:\s+and\s+[a-z][a-z0-9_]*)?)\b/i,
  );
  if (findVars?.[1] && unknowns.length === 0) {
    for (const name of findVars[1].split(/\s+and\s+/i)) {
      const trimmed = name.trim().toLowerCase();
      if (trimmed.length > 0 && !["only", "the", "a"].includes(trimmed)) {
        unknowns.push({ name: trimmed, description: `Find ${trimmed}` });
      }
    }
  }
  const symbols = objective.match(/\b([a-z])\s*\+\s*([a-z])\s*=/gi);
  if (symbols && unknowns.length === 0) {
    const match = objective.match(/\b([a-z])\s*\+\s*([a-z])\s*=/i);
    if (match?.[1] && match[2]) {
      unknowns.push(
        { name: match[1], description: `Solve for ${match[1]}` },
        { name: match[2], description: `Solve for ${match[2]}` },
      );
    }
  }
  if (unknowns.length === 0 && ASK_FOR.test(objective)) {
    unknowns.push({
      name: "result",
      description: "The quantity the objective asks for",
    });
  }
  return unknowns;
}

function defaultPlanSteps(
  objective: string,
  underdetermined: boolean,
): FormalizationStep[] {
  if (underdetermined) {
    return [
      {
        step: 1,
        action:
          "List knowns, unknowns and constraints; state what is missing to fix a unique solution.",
        tool: "none",
      },
      {
        step: 2,
        action:
          "Report the problem as underdetermined. Do not invent missing constants; name the extra datum needed.",
        tool: "none",
      },
    ];
  }
  const steps: FormalizationStep[] = [
    {
      step: 1,
      action: "State variables, units, domains and explicit assumptions.",
      tool: "none",
    },
    {
      step: 2,
      action: "Set up the governing relation or equation from the constraints.",
      tool: "none",
    },
    {
      step: 3,
      action: "Compute each intermediate and final numeric value with compute.run.",
      tool: "compute.run",
    },
  ];
  if (/\b(unit|dimension|metres?|m\/s|kg|mol|joule)\b/i.test(objective)) {
    steps.push({
      step: 4,
      action: "Check physical units with compute.run op dimension before stating the result.",
      tool: "compute.run",
    });
  }
  if (UNIVERSAL.test(objective)) {
    steps.push({
      step: steps.length + 1,
      action:
        "Before asserting a universal claim, search for a counterexample with compute.run or state the claim is conditional.",
      tool: "compute.run",
    });
  }
  steps.push({
    step: steps.length + 1,
    action:
      "Cross-check with an independent recomputation or substitution, then state Result: with units.",
    tool: "compute.run",
  });
  return steps;
}

/**
 * Deterministic formalization from the objective text. No model call: this is
 * the structure the arm must follow and the verifier can inspect.
 */
export function formalizeProblem(objective: string): ProblemFormalization {
  const knowns = extractKnowns(objective);
  const unknowns = extractUnknowns(objective);
  const constraints: string[] = [];
  if (/\bconstraint|must|given that|subject to\b/i.test(objective)) {
    constraints.push("Explicit constraints appear in the objective.");
  }
  if (/\bequation|=\s*[^=]/i.test(objective)) {
    constraints.push("An equation or relation is stated or implied.");
  }
  const assumptions: string[] = [];
  if (/\bg\s*=\s*9\.?81|gravity\b/i.test(objective)) {
    assumptions.push("Use g = 9.81 m/s² unless another value is given.");
  }
  if (/\bideal|neglect|ignore (?:air|friction|resistance)\b/i.test(objective)) {
    assumptions.push("Neglect effects named in the objective (e.g. friction).");
  }

  const equationCount = (objective.match(/=/g) ?? []).length;
  const namedUnknowns = unknowns.filter((item) => item.name !== "result");
  const underdetermined =
    UNDERDETERMINED_SIGNALS.some((pattern) => pattern.test(objective)) ||
    (namedUnknowns.length >= 2 && equationCount < namedUnknowns.length) ||
    (/\bdo not invent\b/i.test(objective) &&
      namedUnknowns.length >= 2 &&
      equationCount <= 1);

  const underdeterminedReason = underdetermined
    ? namedUnknowns.length >= 2 && equationCount < namedUnknowns.length
      ? `More unknowns (${namedUnknowns.length}) than independent equations (${equationCount}).`
      : UNDERDETERMINED_SIGNALS.find((pattern) => pattern.test(objective))
        ? "The objective signals missing information or multiple solutions."
        : "The stated relations do not fix a unique solution."
    : undefined;

  const needsCounterexampleSearch = UNIVERSAL.test(objective);

  const planSteps = defaultPlanSteps(objective, underdetermined);

  return problemFormalizationSchema.parse({
    objective,
    knowns,
    unknowns,
    constraints,
    assumptions,
    planSteps,
    underdetermined,
    underdeterminedReason,
    needsCounterexampleSearch,
  });
}

export function renderFormalizationPlan(
  formalization: ProblemFormalization,
): string {
  const lines = [
    "Problem formalization:",
    `Knowns: ${formalization.knowns.map((k) => k.description).join("; ") || "none stated"}`,
    `Unknowns: ${formalization.unknowns.map((u) => u.description).join("; ") || "none named"}`,
    `Constraints: ${formalization.constraints.join("; ") || "none"}`,
    `Assumptions: ${formalization.assumptions.join("; ") || "none beyond the objective"}`,
  ];
  if (formalization.underdetermined) {
    lines.push(
      `Underdetermined: ${formalization.underdeterminedReason ?? "cannot fix a unique solution"}`,
    );
  }
  lines.push(
    "Plan:",
    ...formalization.planSteps.map(
      (step) => `${step.step}. ${step.action}${step.tool && step.tool !== "none" ? ` (${step.tool})` : ""}`,
    ),
  );
  return lines.join("\n");
}

export function underdeterminedFailureDetail(
  formalization: ProblemFormalization,
  answer: string,
): string | null {
  if (!formalization.underdetermined) return null;
  const honest =
    /\bunderdetermined|not enough (?:information|data|equations)|cannot (?:be )?uniquely|missing (?:datum|value|constant|information)|need (?:another|more|an additional)\b/i.test(
      answer,
    );
  const invented =
    /^\s*result\s*:/im.test(answer) &&
    !honest &&
    !/\bcannot determine|insufficient|unspecified\b/i.test(answer);
  if (invented) {
    return "Problem is underdetermined but the answer states a definite Result: without naming what is missing.";
  }
  return null;
}
