import { contaminationCheck } from "../generation/challenges";
import { MATH_CAPABILITY, mathFamilies, mathTask } from "../evals/math-tasks";
import { fingerprint, rng, seedOf, simhash } from "../evals/random";
import type { IntelStore } from "../store/store";
import type { CapabilityGap, EvalTask, Partition, TaskSpec } from "../types";
import type { WeakCell } from "../rsi/types";

// The adaptive curriculum: agent-level tasks generated from Osirus's own
// weaknesses, for live experiments and the raw-model-vs-Osirus benchmark.
//
// A request names a capability, why (the gap, the weak cell, or "a harder
// version of something it already does"), a difficulty and a count. Each
// generator has several templates; the last template of every generator is
// held out, so a held-out task never shares its wording with a dev task and
// a model cannot pass the holdout by having seen the dev template. Every
// task is checked against the stored holdout texts before it is stored: a
// dev task within the near-duplicate distance of a holdout task is
// contaminated and dropped. Labels are computed from the parameters.

export type CurriculumGenerator =
  | "math_variant"
  | "falsification"
  | "conflicting_sources"
  | "fresh_fact"
  | "replan";

export type CurriculumRequest = {
  capabilityId: string;
  generator: CurriculumGenerator;
  reason: string;
  /** 1..5; adds distractors and steps. */
  difficulty: number;
  count: number;
  parentId?: string | null;
};

const GENERATOR_FOR: Record<string, CurriculumGenerator> = {
  [MATH_CAPABILITY]: "math_variant",
  "verification.numeric": "math_variant",
  "tool.compute": "math_variant",
  "reasoning.falsification": "falsification",
  "research.citations": "conflicting_sources",
  "verification.citations": "conflicting_sources",
  "security.adversarial": "conflicting_sources",
  "memory.context": "fresh_fact",
  "planning.long_horizon": "replan",
  "reasoning.planning": "replan",
  "reasoning.cross_domain": "replan",
};

/** Requests from gaps and weak cells, and harder versions of strengths. */
export function curriculumRequests(input: {
  gaps: Array<Pick<CapabilityGap, "capabilityId" | "summary" | "support">>;
  weakCells: WeakCell[];
  strong: string[];
  limit: number;
}): CurriculumRequest[] {
  const out: CurriculumRequest[] = [];
  const seen = new Set<string>();
  const push = (request: CurriculumRequest) => {
    const key = `${request.capabilityId}:${request.generator}`;
    if (seen.has(key) || out.length >= input.limit) return;
    seen.add(key);
    out.push(request);
  };
  for (const gap of input.gaps) {
    const generator = GENERATOR_FOR[gap.capabilityId];
    if (!generator) continue;
    push({
      capabilityId: gap.capabilityId,
      generator,
      reason: `gap: ${gap.summary} (support ${gap.support})`,
      difficulty: Math.min(5, 2 + Math.floor(gap.support / 3)),
      count: 3,
    });
  }
  const laneCapability: Record<string, string> = {
    MATH_SCIENCE: MATH_CAPABILITY,
    RESEARCH: "research.citations",
    MEMORY_CONTEXT: "memory.context",
    LONG_HORIZON: "planning.long_horizon",
    REASONING: "reasoning.falsification",
    CROSS_DOMAIN: "reasoning.cross_domain",
    THINKING: "reasoning.planning",
  };
  for (const cell of input.weakCells) {
    const capabilityId = laneCapability[cell.family];
    const generator = capabilityId ? GENERATOR_FOR[capabilityId] : undefined;
    if (!capabilityId || !generator) continue;
    push({
      capabilityId,
      generator,
      reason: `weak cell ${cell.family} L${cell.level} (rate ${cell.rate.toFixed(2)})`,
      difficulty: cell.level,
      count: 2,
    });
  }
  for (const capabilityId of input.strong) {
    const generator = GENERATOR_FOR[capabilityId];
    if (!generator) continue;
    push({
      capabilityId,
      generator,
      reason: "harder version of a verified strength",
      difficulty: 5,
      count: 2,
    });
  }
  return out;
}

type Template = (
  random: ReturnType<typeof rng>,
  difficulty: number,
) => {
  objective: string;
  verify: TaskSpec["verify"];
  kind: TaskSpec["kind"];
};

const DISTRACTORS = [
  "A note from last quarter, since superseded, is attached for context.",
  "Someone on the thread insists the answer is obvious and gives none.",
  "Ignore the formatting of the numbers; they come from different tools.",
];

function distract(random: ReturnType<typeof rng>, difficulty: number) {
  return DISTRACTORS.slice(0, Math.max(0, difficulty - 2))
    .map((line) => (random.next() < 0.7 ? line : ""))
    .filter(Boolean)
    .join(" ");
}

const TEMPLATES: Record<
  Exclude<CurriculumGenerator, "math_variant">,
  Template[]
> = {
  falsification: [
    (random, difficulty) => {
      const a = random.int(12, 60);
      const b = random.int(12, 60);
      const c = random.int(5, 99);
      const value = a * b + c;
      const wrong = value + random.int(3, 30);
      return {
        kind: "general",
        objective:
          `${distract(random, difficulty)} Two analysts say the total of ${a} crates holding ${b} units each, plus ${c} loose units, is ${wrong}; a third says ${value}. Which total is correct? State the final number.`.trim(),
        verify: { kind: "numeric", value, tolerance: 0 },
      };
    },
    (random, difficulty) => {
      const hours = random.int(3, 9);
      const rate = random.int(15, 80);
      const breakMin = random.int(10, 50);
      const value = hours * 60 * rate - breakMin * rate;
      const wrong = hours * 60 * rate;
      return {
        kind: "general",
        objective:
          `${distract(random, difficulty)} A line packs ${rate} boxes a minute for ${hours} hours but stops for a ${breakMin}-minute break. The shift lead reports ${wrong} boxes. Is that right? Give the correct count as a number.`.trim(),
        verify: { kind: "numeric", value, tolerance: 0 },
      };
    },
    // Held out.
    (random) => {
      const n = random.int(6, 14);
      const price = random.int(12, 95);
      const discount = random.int(5, 25);
      const value = Math.round(n * price * (1 - discount / 100) * 100) / 100;
      return {
        kind: "general",
        objective: `Procurement bought ${n} licences at ${price} EUR with a ${discount}% volume discount. Finance booked ${n * price} EUR. What should have been booked, in EUR?`,
        verify: { kind: "numeric", value, tolerance: 0.01 },
      };
    },
  ],
  conflicting_sources: [
    (random, difficulty) => {
      const truth = random.int(200, 4000);
      const echoes = 2 + difficulty;
      const lie = truth + random.int(40, 300);
      const blogs = Array.from(
        { length: echoes },
        (_, index) => `Blog ${index + 1}: "the span is ${lie} m".`,
      ).join(" ");
      return {
        kind: "general",
        objective: `Sources on the Aurora bridge: ${blogs} National infrastructure registry (official): "main span ${truth} m". What is the main span in meters? Weigh the sources and state one number.`,
        verify: { kind: "numeric", value: truth, tolerance: 0 },
      };
    },
    (random, difficulty) => {
      const truth = random.int(20, 400);
      const lie = truth * 10;
      return {
        kind: "general",
        objective:
          `${distract(random, difficulty)} A forum post says the Veld reservoir holds ${lie} megaliters "per the city". The city water authority's annual report says ${truth} megaliters. How many megaliters does it hold?`.trim(),
        verify: { kind: "numeric", value: truth, tolerance: 0 },
      };
    },
    // Held out.
    (random) => {
      const truth = random.int(300, 900);
      return {
        kind: "general",
        objective: `Press release (vendor): the Corvid satellite orbits at ${truth + 150} km. Space agency tracking data: ${truth} km. Which altitude should a mission plan use, in km?`,
        verify: { kind: "numeric", value: truth, tolerance: 0 },
      };
    },
  ],
  fresh_fact: [
    (random, difficulty) => {
      const regions = ["eu-west-1", "us-east-1", "ap-south-1", "eu-central-1"];
      const old = random.pick(regions);
      const current = regions.find((region) => region !== old)!;
      return {
        kind: "general",
        objective:
          `${distract(random, difficulty)} Team notes: [3 days ago] "Deploy region is ${old}." [this morning, after the migration] "Deploy region is now ${current}." Which region should today's release target? Answer with the region name.`.trim(),
        verify: { kind: "includes", all: [current], none: [] },
      };
    },
    (random) => {
      const versions = ["v2", "v3", "v4", "v5"];
      const old = random.pick(versions);
      const current = versions.find((version) => version !== old)!;
      return {
        kind: "general",
        objective: `Changelog: in January the public API was ${old}; the March release notes say clients must now call ${current}, and ${old} is retired. Which API version must a new client use?`,
        verify: { kind: "includes", all: [current], none: [] },
      };
    },
    // Held out.
    (random) => {
      const branches = ["release/7", "release/8", "stable"];
      const old = random.pick(branches);
      const current = branches.find((branch) => branch !== old)!;
      return {
        kind: "general",
        objective: `Last week hotfixes went to ${old}. Yesterday's incident review moved hotfixes to ${current}. Where does today's hotfix go?`,
        verify: { kind: "includes", all: [current], none: [] },
      };
    },
  ],
  replan: [
    (random, difficulty) => {
      const steps = [
        "provision",
        "migrate",
        "backfill",
        "switch traffic",
        "decommission",
      ];
      const blocked = random.int(1, 3);
      return {
        kind: "general",
        objective:
          `${distract(random, difficulty)} Plan: ${steps.join(" -> ")}. "${steps[0]}" is done. "${steps[blocked]}" is now blocked by a vendor outage; every later step depends on it. Of the steps not yet done, which can be worked on right now? Answer "none" if none can.`.trim(),
        verify:
          blocked === 1
            ? { kind: "includes", all: ["none"], none: [] }
            : { kind: "includes", all: [steps[1]!], none: [] },
      };
    },
    (random) => {
      const steps = ["draft", "review", "legal sign-off", "publish"];
      const replaced = random.int(1, 2);
      return {
        kind: "general",
        objective: `Workflow: ${steps.join(" -> ")}. "${steps[0]}" is done. "${steps[replaced]}" was dropped and replaced by "external audit" in the same position. What is the next step to work on?`,
        verify: {
          kind: "includes",
          all: [replaced === 1 ? "external audit" : steps[1]!],
          none: [],
        },
      };
    },
    // Held out.
    (random) => {
      const done = random.int(1, 2);
      const steps = ["design", "build", "test", "ship"];
      return {
        kind: "general",
        objective: `The team finished ${steps.slice(0, done + 1).join(" and ")}, but the ${steps[done]} results were just invalidated by a rollback. Which step must be redone next?`,
        verify: { kind: "includes", all: [steps[done]!], none: [] },
      };
    },
  ],
};

/** Templates reserved for holdout: the last one of every generator. */
function partitionOf(template: number, count: number): Partition {
  return template === count - 1 ? "holdout" : "dev";
}

export function generateCurriculumTasks(
  request: CurriculumRequest,
  round: number,
): Array<Omit<EvalTask, "id">> {
  const tasks: Array<Omit<EvalTask, "id">> = [];
  if (request.generator === "math_variant") {
    const families = mathFamilies();
    for (let index = 0; index < request.count; index += 1) {
      const entry = families[(round + index) % families.length]!;
      const task = mathTask({
        family: entry.family,
        variant: 10_000 + round * 10 + index,
        partition: entry.partition,
        distractors: Math.max(0, Math.min(3, request.difficulty - 2)),
        generator: "curriculum",
        parentId: request.parentId ?? null,
      });
      task.labelEvidence = {
        ...task.labelEvidence,
        lineage: { generator: "math_variant", reason: request.reason, round },
      };
      tasks.push(task);
    }
    return tasks;
  }
  const templates = TEMPLATES[request.generator];
  for (let index = 0; index < request.count; index += 1) {
    const template = (round + index) % templates.length;
    const random = rng(
      seedOf(`${request.generator}:${request.difficulty}:${round}:${index}`),
    );
    const made = templates[template]!(random, request.difficulty);
    const partition = partitionOf(template, templates.length);
    tasks.push({
      suite: `rsi.${request.generator}`,
      capabilityId: request.capabilityId,
      partition,
      difficulty: {
        reasoningDepth: request.difficulty,
        distractors: request.difficulty - 1,
      },
      difficultyScore: request.difficulty * 2,
      spec: {
        kind: made.kind,
        objective: made.objective,
        composition: ["general"],
        verify: made.verify,
      },
      generator: "curriculum",
      fingerprint: fingerprint("rsi", request.generator, made.objective),
      parentId: request.parentId ?? null,
      // Computed from the generating parameters: verified by construction.
      labelVerified: true,
      labelEvidence: {
        basis: "computed",
        lineage: {
          generator: request.generator,
          template,
          reason: request.reason,
          round,
        },
      },
    });
  }
  return tasks;
}

export type StockReport = {
  requests: number;
  generated: number;
  stored: number;
  duplicates: number;
  contaminated: number;
  taskIds: string[];
};

/** Generate, check against duplicates and holdout contamination, store. */
export async function stockCurriculum(
  store: IntelStore,
  requests: CurriculumRequest[],
  round: number,
): Promise<StockReport> {
  const existing = await store.listTasks({ limit: 10_000 });
  const known = new Set(existing.map((task) => task.fingerprint));
  const holdoutHashes = existing
    .filter((task) => task.partition === "holdout")
    .map((task) => simhash(task.spec.objective));
  const devHashes = existing
    .filter((task) => task.partition !== "holdout")
    .map((task) => simhash(task.spec.objective));
  const report: StockReport = {
    requests: requests.length,
    generated: 0,
    stored: 0,
    duplicates: 0,
    contaminated: 0,
    taskIds: [],
  };
  const accepted: Array<Omit<EvalTask, "id">> = [];
  for (const request of requests)
    for (const task of generateCurriculumTasks(request, round)) {
      report.generated += 1;
      const check = contaminationCheck({
        fingerprint: task.fingerprint,
        text: task.spec.objective,
        known,
        // A dev task must not sit next to a holdout task, and a holdout
        // task must not sit next to a dev task.
        holdoutHashes: task.partition === "holdout" ? devHashes : holdoutHashes,
      });
      if (check.duplicate) {
        report.duplicates += 1;
        continue;
      }
      // Same-template math variants share wording by design; only a
      // cross-partition near-duplicate is contamination.
      if (check.contaminated && task.suite !== "math.quantitative") {
        report.contaminated += 1;
        continue;
      }
      known.add(task.fingerprint);
      (task.partition === "holdout" ? holdoutHashes : devHashes).push(
        simhash(task.spec.objective),
      );
      task.labelEvidence = {
        ...task.labelEvidence,
        contamination: {
          nearestOtherPartition: check.nearestHoldout,
          checkedAgainst: task.partition === "holdout" ? "dev" : "holdout",
        },
      };
      accepted.push(task);
    }
  const stored = await store.insertTasks(accepted);
  report.stored = stored.length;
  report.taskIds = stored.map((task) => task.id);
  return report;
}
