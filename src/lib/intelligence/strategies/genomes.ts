import { randomUUID } from "node:crypto";
import type { ArmId } from "../../arms/types";
import {
  COMPUTE_TIERS,
  genomeSchema,
  type StrategyGenome,
} from "../../strategy/runtime";
import type { IntelStore } from "../store/store";
import { rng, seedOf } from "../evals/random";
import type {
  CapabilityGap,
  GapKind,
  Hypothesis,
  StrategyVersion,
} from "../types";

// Strategy seeds, the hypothesis library and mutation operators.
//
// A hypothesis links a detected gap to an intervention on the genome and to
// what should change if it is right. The library is where the Foundry starts;
// exploratory mutations cover what the library does not. Every candidate is
// validated against the same schema the runtime parses, so a candidate the
// runtime would reject is never evaluated.

export const STRATEGY_SEEDS: Array<{
  id: string;
  kind: ArmId;
  capabilityId: string;
  description: string;
}> = [
  {
    id: "coding.debug",
    kind: "coding",
    capabilityId: "coding.debug",
    description: "How the coding arm debugs a failing test in a repository.",
  },
  {
    id: "math.quantitative",
    kind: "math_science",
    capabilityId: "math.quantitative",
    description: "How the math arm solves problems with one checkable answer.",
  },
  {
    id: "research.citations",
    kind: "research",
    capabilityId: "research.citations",
    description: "How the research arm answers with cited sources.",
  },
];

export function strategyForCapability(capabilityId: string) {
  return (
    STRATEGY_SEEDS.find((seed) => seed.capabilityId === capabilityId) ??
    STRATEGY_SEEDS.find((seed) =>
      capabilityId.startsWith(seed.id.split(".")[0]!),
    ) ??
    null
  );
}

/** Make sure each strategy has a champion; v1 is the empty (baseline) genome. */
export async function seedStrategies(store: IntelStore, model: string) {
  for (const seed of STRATEGY_SEEDS) {
    await store.ensureStrategy(seed.id, seed.kind, seed.description);
    const versions = await store.listVersions(seed.id);
    if (versions.some((version) => version.status === "champion")) continue;
    if (versions.length === 0)
      await store.insertVersion({
        strategyId: seed.id,
        kind: seed.kind,
        genome: {},
        parentId: null,
        mutation: {
          operator: "baseline",
          rationale: "The strategy the agent shipped with, before the Foundry.",
        },
        status: "champion",
        riskClass: "low",
        model,
        canaryPercent: 0,
        metrics: {},
      });
  }
}

type LibraryEntry = {
  gap: GapKind;
  arm: ArmId;
  statement: string;
  intervention: StrategyGenome;
  expected: string;
};

const LIBRARY: LibraryEntry[] = [
  {
    gap: "context",
    arm: "coding",
    statement:
      "The loop spends its steps locating code because it never sees the repository map.",
    intervention: { coding: { repoContext: "summary" } },
    expected:
      "Fewer exploration calls and more verified fixes on the same tasks.",
  },
  {
    gap: "context",
    arm: "coding",
    statement:
      "A summary is not enough: the loop needs the file list to pick the right module.",
    intervention: { coding: { repoContext: "full" } },
    expected: "Higher verified rate on multi-module tasks.",
  },
  {
    gap: "planning",
    arm: "coding",
    statement:
      "Edits made before reproducing the failure target the wrong code.",
    intervention: { coding: { reproduceFirst: true } },
    expected: "More first edits in the failing module; higher verified rate.",
  },
  {
    gap: "knowledge",
    arm: "coding",
    statement:
      "Fixes special-case the visible test because the loop is not told hidden cases exist.",
    intervention: {
      coding: { failureHints: "structured" },
      directives: [
        "Fix the general defect, not the visible example: other inputs are tested too.",
      ],
    },
    expected: "Hidden tests pass more often; visible-only fixes drop.",
  },
  {
    gap: "verification",
    arm: "coding",
    statement:
      "The agent reports success without re-running the full test command.",
    intervention: {
      directives: [
        "Before the final answer, run the full test command once more and quote its exit code; report failure if it is not 0.",
      ],
      computeTier: "DEEP",
    },
    expected: "Fewer false completions.",
  },
  {
    gap: "execution",
    arm: "coding",
    statement: "The loop runs out of steps before making a change.",
    intervention: { computeTier: "DEEP", coding: { reproduceFirst: true } },
    expected: "Fewer runs ending without a code change.",
  },
  {
    gap: "tool",
    arm: "math_science",
    statement: "Numbers stated without the compute tool are often wrong.",
    intervention: { math: { computeFirst: true } },
    expected: "Higher verified rate at the cost of more tool calls.",
  },
  {
    gap: "verification",
    arm: "math_science",
    statement:
      "Correct work is lost because the final value is not stated unambiguously.",
    intervention: { math: { finalLine: true } },
    expected: "Fewer no-answer and wrong-number extractions.",
  },
  {
    gap: "planning",
    arm: "math_science",
    statement:
      "The wrong quantity is computed because the question is not restated.",
    intervention: {
      directives: [
        "Start by restating exactly which quantity is asked for and in which unit, then compute it.",
      ],
      math: { finalLine: true },
    },
    expected: "Fewer wrong-quantity answers, especially with distractors.",
  },
  {
    gap: "verification",
    arm: "research",
    statement: "Uncited sentences slip into answers.",
    intervention: { research: { citeEverySentence: true } },
    expected: "Higher citation validity.",
  },
];

function merge(base: StrategyGenome, patch: StrategyGenome): StrategyGenome {
  return genomeSchema.parse({
    ...base,
    ...patch,
    ...(base.coding || patch.coding
      ? { coding: { ...base.coding, ...patch.coding } }
      : {}),
    ...(base.math || patch.math
      ? { math: { ...base.math, ...patch.math } }
      : {}),
    ...(base.research || patch.research
      ? { research: { ...base.research, ...patch.research } }
      : {}),
    ...(base.directives || patch.directives
      ? {
          directives: [
            ...new Set([
              ...(base.directives ?? []),
              ...(patch.directives ?? []),
            ]),
          ].slice(0, 8),
        }
      : {}),
  });
}

const sameGenome = (a: StrategyGenome, b: StrategyGenome) =>
  JSON.stringify(genomeSchema.parse(a)) ===
  JSON.stringify(genomeSchema.parse(b));

/** Hypotheses for the strongest gaps, most-supported first. */
export function hypothesesFor(
  arm: ArmId,
  gaps: CapabilityGap[],
  champion: StrategyGenome,
  limit: number,
): Hypothesis[] {
  const out: Hypothesis[] = [];
  const open = gaps.filter((gap) => gap.status !== "dismissed");
  for (const gap of open) {
    for (const entry of LIBRARY.filter(
      (item) => item.gap === gap.kind && item.arm === arm,
    )) {
      const genome = merge(champion, entry.intervention);
      if (sameGenome(genome, champion)) continue;
      if (
        out.some((hypothesis) =>
          sameGenome(merge(champion, hypothesis.intervention), genome),
        )
      )
        continue;
      out.push({
        id: randomUUID(),
        gap: gap.kind,
        statement: `${entry.statement} (gap: ${gap.summary}, support ${gap.support})`,
        intervention: entry.intervention,
        expected: entry.expected,
      });
      if (out.length >= limit) return out;
    }
  }
  return out;
}

/** One random single-parameter mutation of the champion, for exploration. */
export function exploratoryMutation(
  arm: ArmId,
  champion: StrategyGenome,
  seed: string,
): Hypothesis | null {
  const random = rng(seedOf(seed));
  const options: Array<{ statement: string; intervention: StrategyGenome }> = [
    {
      statement: "A different compute tier changes the quality/cost balance.",
      intervention: {
        computeTier: random.pick(
          COMPUTE_TIERS.filter(
            (tier) => tier !== (champion.computeTier ?? "STANDARD"),
          ),
        ),
      },
    },
    {
      statement: "A smaller context lets the loop focus.",
      intervention: { contextTokens: random.pick([4000, 6000]) },
    },
    {
      statement: "Fewer skills in context reduce noise.",
      intervention: { skills: { maxActive: random.pick([2, 4]) } },
    },
    {
      statement: "Less retrieved memory reduces distraction.",
      intervention: { memory: { limit: random.pick([2, 4]) } },
    },
  ];
  if (arm === "coding")
    options.push({
      statement: "Structured failure hints speed up repair.",
      intervention: { coding: { failureHints: "structured" } },
    });
  if (arm === "math_science")
    options.push({
      statement: "An explicit final line avoids extraction errors.",
      intervention: { math: { finalLine: true } },
    });
  for (let attempt = 0; attempt < options.length; attempt += 1) {
    const choice =
      options[(attempt + random.int(0, options.length - 1)) % options.length]!;
    const genome = merge(champion, choice.intervention);
    if (sameGenome(genome, champion)) continue;
    return {
      id: randomUUID(),
      gap: "planning",
      statement: `Exploration: ${choice.statement}`,
      intervention: choice.intervention,
      expected: "Unknown; explored to cover what the library does not.",
    };
  }
  return null;
}

/** Create challenger versions for hypotheses, all derived from the champion. */
export async function buildChallengers(
  store: IntelStore,
  input: {
    champion: StrategyVersion;
    hypotheses: Hypothesis[];
    model: string;
  },
) {
  const out: StrategyVersion[] = [];
  for (const hypothesis of input.hypotheses) {
    const genome = merge(input.champion.genome, hypothesis.intervention);
    out.push(
      await store.insertVersion({
        strategyId: input.champion.strategyId,
        kind: input.champion.kind,
        genome,
        parentId: input.champion.id,
        mutation: {
          operator: hypothesis.statement.startsWith("Exploration")
            ? "explore"
            : "hypothesis",
          rationale: hypothesis.statement,
          hypothesis: hypothesis.id,
        },
        status: "experimental",
        riskClass: "low",
        model: input.model,
        canaryPercent: 0,
        metrics: {},
      }),
    );
  }
  return out;
}

export function describeGenome(genome: StrategyGenome) {
  const parts: string[] = [];
  if (genome.computeTier) parts.push(`tier ${genome.computeTier}`);
  if (genome.coding?.repoContext)
    parts.push(`repo map ${genome.coding.repoContext}`);
  if (genome.coding?.reproduceFirst) parts.push("reproduce first");
  if (genome.coding?.failureHints)
    parts.push(`failure hints ${genome.coding.failureHints}`);
  if (genome.math?.computeFirst) parts.push("compute first");
  if (genome.math?.finalLine) parts.push("final line");
  if (genome.research?.citeEverySentence) parts.push("cite every sentence");
  if (genome.contextTokens) parts.push(`context ${genome.contextTokens}`);
  if (genome.skills?.maxActive !== undefined)
    parts.push(`skills ${genome.skills.maxActive}`);
  if (genome.memory?.limit !== undefined)
    parts.push(`memory ${genome.memory.limit}`);
  if (genome.directives?.length)
    parts.push(`${genome.directives.length} extra directive(s)`);
  return parts.length ? parts.join(", ") : "baseline";
}
