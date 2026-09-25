import { randomUUID } from "node:crypto";
import type { ArmId } from "../../arms/types";
import type {
  Experience,
  GapKind,
  Hypothesis,
  LearningArtifact,
} from "../types";
import type { CognitiveTelemetry } from "./telemetry";

// Meta-learning over improvement mechanisms (M42).
//
// Every hypothesis belongs to one mechanism class. Each concluded
// experiment updates a Beta posterior per (gap kind x mechanism): did it
// improve, by how much, at what cost. The hypothesize phase orders its
// candidates by Thompson sampling of expected gain per cost, instead of
// the library's fixed order -- so the Foundry spends its scarce trials on
// the kinds of change that have been paying off, and still explores.

export const MECHANISMS = [
  "reasoning_depth",
  "tool_use",
  "model",
  "specialist",
  "verifier",
  "memory_retrieval",
  "topology",
  "compute_tier",
  "skill",
  "generated_tool",
  // M46–M48: how Osirus is wired, how it spends compute, how it uses the model.
  "architecture",
  "adaptive_compute",
  "prompt",
] as const;
export type Mechanism = (typeof MECHANISMS)[number];

/** The mechanism a hypothesis changes, from its intervention. */
export function mechanismOf(
  hypothesis: Pick<Hypothesis, "intervention">,
): Mechanism {
  const change = hypothesis.intervention;
  if (change.architecture) return "architecture";
  if (change.compute) return "adaptive_compute";
  if (change.tools?.include?.length) return "generated_tool";
  if (change.team) return "topology";
  if (change.computeTier) return "compute_tier";
  if (change.skills?.include?.length || change.directives?.length)
    return "skill";
  if (change.memory) return "memory_retrieval";
  if (change.research?.citeEverySentence || change.math?.finalLine)
    return "verifier";
  if (
    change.math?.computeFirst ||
    change.coding?.repoContext ||
    change.coding?.worldModel
  )
    return "tool_use";
  if (change.coding || change.math || change.research) return "specialist";
  if (change.contextTokens) return "reasoning_depth";
  return "reasoning_depth";
}

export type MechanismStat = {
  gap: GapKind;
  mechanism: Mechanism;
  tried: number;
  improved: number;
  /** Mean effect on the verified rate where it improved. */
  meanEffect: number;
  /** Mean extra tokens per trial relative to the champion. */
  meanExtraTokens: number;
};

export type MetaPolicy = { version: 1; stats: MechanismStat[] };

export function emptyMetaPolicy(): MetaPolicy {
  return { version: 1, stats: [] };
}

/** Fold one concluded experiment into the meta-policy. */
export function updateMetaPolicy(
  policy: MetaPolicy,
  result: {
    gap: GapKind;
    mechanism: Mechanism;
    improved: boolean;
    effect: number;
    extraTokens: number;
  },
): MetaPolicy {
  const stats = policy.stats.map((stat) => ({ ...stat }));
  let stat = stats.find(
    (entry) => entry.gap === result.gap && entry.mechanism === result.mechanism,
  );
  if (!stat) {
    stat = {
      gap: result.gap,
      mechanism: result.mechanism,
      tried: 0,
      improved: 0,
      meanEffect: 0,
      meanExtraTokens: 0,
    };
    stats.push(stat);
  }
  stat.tried += 1;
  stat.meanExtraTokens +=
    (result.extraTokens - stat.meanExtraTokens) / stat.tried;
  if (result.improved) {
    stat.improved += 1;
    stat.meanEffect += (result.effect - stat.meanEffect) / stat.improved;
  }
  return { version: 1, stats };
}

/** A small seeded PRNG, so a cycle's ordering is reproducible. */
function rng(seed: string) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i += 1)
    h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
}

/** Beta(a, b) sample via two Gamma draws (Marsaglia-Tsang, a, b >= 1). */
function betaSample(a: number, b: number, random: () => number) {
  const gamma = (k: number) => {
    const d = k - 1 / 3;
    const c = 1 / Math.sqrt(9 * d);
    for (;;) {
      let x: number;
      let v: number;
      do {
        const u1 = random() || 1e-12;
        const u2 = random();
        x = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
        v = 1 + c * x;
      } while (v <= 0);
      v = v * v * v;
      const u = random() || 1e-12;
      if (Math.log(u) < 0.5 * x * x + d - d * v + d * Math.log(v)) return d * v;
    }
  };
  const x = gamma(a);
  const y = gamma(b);
  return x / (x + y);
}

/**
 * Order hypotheses by a Thompson sample of expected gain per cost for
 * their (gap, mechanism). A mechanism with no record yet gets its prior
 * mean instead of a random draw, and the sort is stable, so an empty
 * meta-policy keeps the library's own priority order; an unseen mechanism
 * still ranks above one that has kept failing.
 */
export function orderByMetaPolicy(
  hypotheses: Hypothesis[],
  policy: MetaPolicy,
  seed: string,
): Hypothesis[] {
  const random = rng(seed);
  const PRIOR = 0.5 * 0.1;
  const scored = hypotheses.map((hypothesis, index) => {
    const mechanism = mechanismOf(hypothesis);
    const stat = policy.stats.find(
      (entry) => entry.gap === hypothesis.gap && entry.mechanism === mechanism,
    );
    if (!stat?.tried) return { hypothesis, index, score: PRIOR };
    const p = betaSample(
      1 + stat.improved,
      1 + stat.tried - stat.improved,
      random,
    );
    const effect = stat.improved ? Math.max(0.01, stat.meanEffect) : 0.1;
    const cost = 1 + Math.max(0, stat.meanExtraTokens) / 10_000;
    return { hypothesis, index, score: (p * effect) / cost };
  });
  return scored
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((row) => row.hypothesis);
}

export function metaPolicyOf(artifacts: LearningArtifact[]): MetaPolicy {
  const current = artifacts.find(
    (artifact) =>
      artifact.kind === "meta_policy" && artifact.status === "active",
  );
  const content = current?.content as Partial<MetaPolicy> | undefined;
  return content?.version === 1 && Array.isArray(content.stats)
    ? { version: 1, stats: content.stats }
    : emptyMetaPolicy();
}

// ----- experience -> hypothesis --------------------------------------------

type Template = {
  signal: keyof CognitiveTelemetry;
  /** Below this mean, the signal names a weakness. */
  below: number;
  arms: ArmId[] | "any";
  gap: GapKind;
  statement: string;
  intervention: Hypothesis["intervention"];
};

/** Bounded interventions a telemetry weakness may propose, never more. */
const TEMPLATES: Template[] = [
  {
    signal: "verificationCoverage",
    below: 0.5,
    arms: "any",
    gap: "verification",
    statement: "Runs finish without checking their result",
    intervention: {
      directives: [
        "Before finishing, verify the result with a tool or an independent check.",
      ],
    },
  },
  {
    signal: "falseCompletionAvoided",
    below: 0.8,
    arms: ["coding", "building"],
    gap: "verification",
    statement: "Runs declare done against their own evidence",
    intervention: { team: { topology: "solver_adversary" } },
  },
  {
    signal: "falseCompletionAvoided",
    below: 0.8,
    arms: ["math_science"],
    gap: "verification",
    statement: "Wrong numbers are declared final",
    intervention: { team: { topology: "parallel_solvers_judge", solvers: 2 } },
  },
  {
    signal: "rejectionQuality",
    below: 0.5,
    arms: ["research"],
    gap: "verification",
    statement: "Claims are dropped or kept without counter-evidence",
    intervention: { research: { citeEverySentence: true } },
  },
  {
    signal: "toolChoiceQuality",
    below: 0.6,
    arms: "any",
    gap: "tool",
    statement: "Tool calls fail more often than they return",
    intervention: {
      directives: ["Request a tool's input schema before its first call."],
    },
  },
  {
    signal: "evidenceEfficiency",
    below: 0.2,
    arms: ["math_science"],
    gap: "tool",
    statement: "Numbers are stated without computing them",
    intervention: { math: { computeFirst: true } },
  },
];

/**
 * Experience to hypothesis: a weakness is proposed only when the same
 * failure pattern holds across at least `minTasks` distinct tasks, and the
 * telemetry signal behind it is below its threshold on those runs. The
 * result is a bounded hypothesis; it reaches the product only by winning
 * a Foundry experiment.
 */
export function hypothesesFromExperience(input: {
  arm: ArmId;
  experience: Experience[];
  minTasks?: number;
  limit?: number;
}): Hypothesis[] {
  const failing = input.experience.filter(
    (row) =>
      row.source !== "product" &&
      row.outcome !== "error" &&
      row.outcome !== "verified_success",
  );
  const out: Hypothesis[] = [];
  for (const template of TEMPLATES) {
    if (template.arms !== "any" && !template.arms.includes(input.arm)) continue;
    const weak = failing.filter((row) => {
      const telemetry = (row.trajectory as { telemetry?: CognitiveTelemetry })
        .telemetry;
      const value = telemetry?.[template.signal];
      return typeof value === "number" && value < template.below;
    });
    const tasks = new Set(weak.map((row) => row.taskRef ?? row.fingerprint));
    if (tasks.size < (input.minTasks ?? 3)) continue;
    out.push({
      id: randomUUID(),
      gap: template.gap,
      statement: `${template.statement} (${tasks.size} tasks; ${template.signal} < ${template.below}).`,
      intervention: template.intervention,
      expected: "The signal recovers and the verified rate does not drop.",
      origin: "experience",
    });
    if (out.length >= (input.limit ?? 2)) break;
  }
  return out;
}
