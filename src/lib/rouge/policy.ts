import { z } from "zod";
import type { ReasoningLevel } from "./foundation";
import type { RougeEffort, RougeVersion } from "./types";

// Rouge's policy (M56): the learnable part of Rouge's behaviour, as data.
//
// Everything later milestones evolve -- effort mapping (M58), context policy
// (M59/M60), response style (M62), verification depth (M63) -- lives in a
// versioned policy object, so a champion and a challenger are two values
// of this type, and a promotion or rollback is a version change rather than
// a code change.

export const ROUGE_NAME = "Rouge 1";
/** Bumped when Rouge's own code changes how answers are produced. */
export const ROUGE_RELEASE = "1.0.0-m56";

const effortLevel = z.enum(["low", "medium", "high", "xhigh"]);

export const rougePolicySchema = z.object({
  version: z.string().min(1).max(64),
  core: z.string().min(1).max(120),
  /** The effort used when a request says "auto" (until M58's controller). */
  defaultEffort: z.enum(["quick", "standard", "deep", "ultra"]),
  /**
   * Rouge effort to core reasoning level. "ultra" is the only road to
   * xhigh: the most expensive level is never a default.
   */
  effortMap: z.object({
    quick: effortLevel,
    standard: effortLevel,
    deep: effortLevel,
    ultra: effortLevel,
  }),
  /** Whether an interactive answer may come from a substitute model. */
  allowCoreSubstitute: z.boolean(),
});

export type RougePolicy = z.infer<typeof rougePolicySchema>;

export const DEFAULT_CORE = "grok-4.6";

/**
 * Substitute cores, in order, for when the requested core cannot answer
 * (Grok 4.6 without credit). Filled only from the core selection tournament
 * (evals/rouge-core-selection.eval.ts); never from a guess. Empty means no
 * substitute: a refused core is reported as refused.
 */
export const MEASURED_SUBSTITUTES: readonly string[] = [];

export function defaultPolicy(core = DEFAULT_CORE): RougePolicy {
  return rougePolicySchema.parse({
    version: "p0",
    core,
    defaultEffort: "standard",
    effortMap: {
      quick: "low",
      standard: "medium",
      deep: "high",
      ultra: "xhigh",
    },
    // A person waiting on an answer gets one -- labelled as coming from a
    // substitute -- rather than an error because the core has no credit.
    allowCoreSubstitute: true,
  });
}

export function reasoningFor(
  policy: RougePolicy,
  effort: RougeEffort,
  levels: readonly ReasoningLevel[],
): ReasoningLevel | undefined {
  if (!levels.length) return undefined;
  const wanted = policy.effortMap[effort];
  if (levels.includes(wanted)) return wanted;
  // The core lacks that level: take the closest one it has, never higher.
  const order: ReasoningLevel[] = ["low", "medium", "high", "xhigh"];
  for (let i = order.indexOf(wanted); i >= 0; i -= 1) {
    if (levels.includes(order[i]!)) return order[i];
  }
  return levels[0];
}

export function versionOf(policy: RougePolicy): RougeVersion {
  return {
    name: ROUGE_NAME,
    release: ROUGE_RELEASE,
    policy: policy.version,
    core: policy.core,
  };
}

/**
 * Who Rouge is, stated truthfully. Rouge may call itself "an AI model" --
 * it is a model system -- but never claims to have been trained from
 * scratch or to own its foundation's weights, and names the foundation when
 * asked. It never presents reasoning it did not do.
 */
export function identityInstruction(input: {
  version: RougeVersion;
  foundation: string;
  now?: Date;
}) {
  const date = (input.now ?? new Date()).toISOString().slice(0, 10);
  return [
    `You are ${input.version.name}, an AI model system built by the Osirus team.`,
    `${input.version.name} runs on the ${input.foundation} foundation model, with its own context, memory, verification and learned policies around it.`,
    "If asked what you are or which model you use, say this plainly. Do not claim to have been trained from scratch, to own the foundation model's weights, or to be a different model.",
    "Answer directly and precisely. Match the length to the question: short for simple questions, thorough for hard ones. Use Markdown only when it helps.",
    "Answer in the language the person writes in.",
    "If you are not sure, say so and say what would settle it. Never invent sources, results, or actions you did not take.",
    `Today's date is ${date}.`,
  ].join("\n");
}
