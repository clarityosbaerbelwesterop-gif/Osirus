import { z } from "zod";

// The runtime side of strategy evolution.
//
// A strategy is a versioned set of the knobs the agent used to hard-code:
// loop bounds, extra directives, context and memory budgets, skill limits,
// and per-domain choices such as whether the coding arm sees the repository
// map. The Intelligence Plane (src/lib/intelligence) creates and evaluates
// versions; the Product Plane only reads the one a run was planned with.
//
// An empty genome is the champion that shipped before the Foundry existed:
// every accessor below falls back to the constant the code used before, so a
// run without a policy behaves exactly as it always did.

export const COMPUTE_TIERS = ["FAST", "STANDARD", "DEEP", "EXTREME"] as const;
export type ComputeTier = (typeof COMPUTE_TIERS)[number];

const boundsSchema = z
  .object({
    maxSteps: z.number().int().min(1).max(60),
    maxModelCalls: z.number().int().min(1).max(64),
    maxToolCalls: z.number().int().min(0).max(60),
    maxConsecutiveFailures: z.number().int().min(1).max(8),
  })
  .partial();

export const genomeSchema = z
  .object({
    computeTier: z.enum(COMPUTE_TIERS).optional(),
    loopBounds: boundsSchema.optional(),
    /** Directives appended after the arm's own; versioned prompt evolution. */
    directives: z.array(z.string().min(1).max(600)).max(8).optional(),
    contextTokens: z.number().int().min(2000).max(24000).optional(),
    memory: z
      .object({
        limit: z.number().int().min(0).max(20),
        tokenBudget: z.number().int().min(0).max(6000),
      })
      .partial()
      .optional(),
    skills: z
      .object({
        maxActive: z.number().int().min(0).max(12),
        maxP0: z.number().int().min(0).max(8),
        maxTokens: z.number().int().min(0).max(8000),
      })
      .partial()
      .optional(),
    coding: z
      .object({
        /** What of the repository map the answering loop is given. */
        repoContext: z.enum(["none", "summary", "full"]),
        /** Ask for the failing check to be reproduced before any edit. */
        reproduceFirst: z.boolean(),
        /** Hand the loop the failure-class playbook up front. */
        failureHints: z.enum(["off", "structured"]),
      })
      .partial()
      .optional(),
    math: z
      .object({
        /** Compute with the tool before stating a number. */
        computeFirst: z.boolean(),
        /** State the final value on its own line for checking. */
        finalLine: z.boolean(),
      })
      .partial()
      .optional(),
    research: z
      .object({
        /** Require every factual sentence to carry a citation marker. */
        citeEverySentence: z.boolean(),
      })
      .partial()
      .optional(),
  })
  .strict();

export type StrategyGenome = z.infer<typeof genomeSchema>;

export type RuntimePolicy = {
  strategyVersionId: string | null;
  /** Human-readable, e.g. "coding.debug v3". */
  label: string;
  genome: StrategyGenome;
  /** "champion", "canary" or "trial" -- how this run got the version. */
  assignment: "champion" | "canary" | "trial";
  /**
   * One model for every role. Set only for Foundry trials, which run on the
   * model the operator allowed them; product runs use the configured roles.
   */
  model?: string;
};

export const CHAMPION_BASELINE: RuntimePolicy = {
  strategyVersionId: null,
  label: "baseline",
  genome: {},
  assignment: "champion",
};

/** Parse a stored policy; anything malformed degrades to the baseline. */
export function parsePolicy(raw: unknown): RuntimePolicy {
  if (!raw || typeof raw !== "object") return CHAMPION_BASELINE;
  const value = raw as Record<string, unknown>;
  const genome = genomeSchema.safeParse(value.genome ?? {});
  if (!genome.success) return CHAMPION_BASELINE;
  return {
    strategyVersionId:
      typeof value.strategyVersionId === "string"
        ? value.strategyVersionId
        : null,
    label: typeof value.label === "string" ? value.label : "baseline",
    genome: genome.data,
    assignment:
      value.assignment === "canary" || value.assignment === "trial"
        ? value.assignment
        : "champion",
    ...(typeof value.model === "string" &&
    /^[A-Za-z0-9._:/-]{1,120}$/.test(value.model)
      ? { model: value.model }
      : {}),
  };
}

/** Stamp a policy into every stage of a planned graph. */
export function stampPolicy<T extends { input: Record<string, unknown> }>(
  nodes: T[],
  policy: RuntimePolicy,
) {
  for (const node of nodes) node.input = { ...node.input, policy };
  return nodes;
}

/** The policy a stage runs under: stamped into every stage input at planning. */
export function policyOfStage(stageInput: Record<string, unknown> | undefined) {
  return parsePolicy(stageInput?.policy);
}

type Bounds = {
  maxSteps?: number;
  maxModelCalls?: number;
  maxToolCalls?: number;
  maxWallMs?: number;
  maxConsecutiveFailures?: number;
  yieldOnWallClock?: boolean;
};

const TIER_SCALE: Record<ComputeTier, number> = {
  FAST: 0.5,
  STANDARD: 1,
  DEEP: 1.5,
  EXTREME: 2,
};

/**
 * Loop bounds under a policy: the arm's own bounds, scaled by the compute
 * tier, then overridden by explicit genome bounds. Wall clock is never
 * raised: slices yield and resume instead.
 */
export function boundsUnder(
  policy: RuntimePolicy,
  armBounds: Bounds,
  defaults: Required<Omit<Bounds, "yieldOnWallClock">>,
): Bounds {
  const base = { ...defaults, ...armBounds };
  const scale = TIER_SCALE[policy.genome.computeTier ?? "STANDARD"];
  const scaled = (value: number) => Math.max(1, Math.round(value * scale));
  return {
    ...base,
    maxSteps: scaled(base.maxSteps),
    maxModelCalls: scaled(base.maxModelCalls),
    maxToolCalls: scaled(base.maxToolCalls),
    ...policy.genome.loopBounds,
  };
}

export function skillLimitsUnder(policy: RuntimePolicy) {
  return {
    maxActiveSkills: policy.genome.skills?.maxActive ?? 8,
    maxP0Skills: policy.genome.skills?.maxP0 ?? 4,
    maxContextTokens: policy.genome.skills?.maxTokens ?? 4000,
  };
}

export function memoryLimitsUnder(policy: RuntimePolicy) {
  return {
    limit: policy.genome.memory?.limit ?? 8,
    tokenBudget: policy.genome.memory?.tokenBudget ?? 1800,
  };
}

export function contextTokensUnder(policy: RuntimePolicy) {
  return policy.genome.contextTokens ?? 8000;
}

export const FAILURE_PLAYBOOK = [
  "Failure playbook: syntax or type error -> read the reported line, fix that line only.",
  "Assertion failure -> compare expected and actual values, find the code path that produced actual, fix the logic, not the test.",
  "Missing module or command -> an environment problem; report it instead of editing code.",
  "Timeout -> look for an unbounded loop or an unresolved promise in the code under test.",
].join(" ");

/** Directives a policy adds after the arm's own. */
export function directivesUnder(policy: RuntimePolicy, armId: string) {
  const out: string[] = [];
  const { coding, math, research } = policy.genome;
  if (armId === "coding" && coding?.reproduceFirst)
    out.push(
      "Before editing anything, run the failing test command once with workspace.run and read its analysis; base the first edit on that output.",
    );
  if (armId === "coding" && coding?.failureHints === "structured")
    out.push(FAILURE_PLAYBOOK);
  if (armId === "math_science" && math?.computeFirst)
    out.push(
      "Compute every numeric result with the compute tool before stating it; never state a number you did not compute.",
    );
  if (armId === "math_science" && math?.finalLine)
    out.push(
      "End with a single line of the form `Final answer: <value>` holding only the result.",
    );
  if (armId === "research" && research?.citeEverySentence)
    out.push(
      "Every factual sentence carries a citation marker to a retrieved source; drop any sentence you cannot cite.",
    );
  return [...out, ...(policy.genome.directives ?? [])];
}

/** Stable 0..99 bucket for canary assignment. */
export function bucketOf(key: string) {
  let hash = 2166136261;
  for (let index = 0; index < key.length; index += 1) {
    hash ^= key.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % 100;
}

/**
 * Memory an evaluation task plants (a red task's conflicting memory), in
 * place of workspace retrieval. Honoured only for Foundry trials, whose stage
 * input the server writes at planning; a product run never has it, and one
 * trial's memory never reaches another through the workspace.
 */
export function plantedMemoryOf(
  stageInput: Record<string, unknown> | undefined,
  policy: RuntimePolicy,
) {
  if (policy.assignment !== "trial") return null;
  const raw = stageInput?.plantedMemory;
  if (!Array.isArray(raw)) return null;
  return raw
    .filter((entry): entry is string => typeof entry === "string")
    .slice(0, 8)
    .map((content, index) => ({
      id: `planted-${index}`,
      tier: "second" as const,
      kind: "decision",
      content: content.slice(0, 2_000),
      source: "evaluation task",
      updatedAt: new Date(0).toISOString(),
      verificationStatus: "verified" as const,
    }));
}
