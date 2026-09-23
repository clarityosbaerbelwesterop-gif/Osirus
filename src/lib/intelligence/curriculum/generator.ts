import {
  codingFamilies,
  codingTask,
  CODING_CAPABILITY,
} from "../evals/coding-fixtures";
import { MATH_CAPABILITY, mathFamilies, mathTask } from "../evals/math-tasks";
import type { IntelStore } from "../store/store";
import type { EvalTask, Partition } from "../types";

// The CurriculumGenerator. It keeps each capability's suite stocked with
// tasks at the edge of current competence: when the champion solves the dev
// partition, the next level adds distractors, planted instructions and more
// modules; when success collapses, it drops back a level. Difficulty means
// structure (modules, distractors, traps, reasoning depth), not prompt length.

export type SuiteSize = { dev: number; adversarial: number; holdout: number };

export const DEFAULT_SUITE: SuiteSize = { dev: 4, adversarial: 2, holdout: 3 };

type Stocked = Record<Exclude<Partition, "train" | "fresh">, EvalTask[]>;

function generate(
  capabilityId: string,
  partition: Partition,
  level: number,
  count: number,
  generator: EvalTask["generator"],
) {
  const out: Array<Omit<EvalTask, "id">> = [];
  if (capabilityId === CODING_CAPABILITY) {
    const families = codingFamilies().filter(
      (family) => family.partition === partition,
    );
    for (let index = 0; index < count && families.length; index += 1) {
      const family = families[index % families.length]!;
      out.push(
        codingTask({
          familyId: family.id,
          variant: level * 100 + index,
          partition,
          distractors: Math.min(3, level),
          trap:
            partition === "adversarial"
              ? level % 2 === 0
                ? "readme_injection"
                : "misleading_comment"
              : level >= 3
                ? "misleading_comment"
                : undefined,
          generator,
        }),
      );
    }
  } else if (capabilityId === MATH_CAPABILITY) {
    const families = mathFamilies().filter(
      (family) => family.partition === partition,
    );
    for (let index = 0; index < count && families.length; index += 1) {
      const family = families[index % families.length]!;
      out.push(
        mathTask({
          family: family.family,
          variant: level * 100 + index,
          partition,
          distractors:
            partition === "adversarial"
              ? 2 + Math.min(1, level)
              : Math.min(2, level),
          generator,
        }),
      );
    }
  }
  return out;
}

/** Make sure a capability has enough tasks in each partition at a level. */
export async function stockSuite(
  store: IntelStore,
  capabilityId: string,
  input: {
    size?: SuiteSize;
    level?: number;
    generator?: EvalTask["generator"];
  } = {},
): Promise<Stocked & { generated: number }> {
  const size = input.size ?? DEFAULT_SUITE;
  const level = input.level ?? 0;
  let generated = 0;
  const stocked = { dev: [], adversarial: [], holdout: [] } as Stocked;
  for (const partition of ["dev", "adversarial", "holdout"] as const) {
    const want = size[partition];
    const candidates = generate(
      capabilityId,
      partition,
      level,
      want,
      input.generator ?? (level === 0 ? "seed" : "curriculum"),
    );
    const stored = await store.insertTasks(candidates);
    generated += stored.length;
    stocked[partition] = stored.slice(0, want);
  }
  return { ...stocked, generated };
}

/**
 * The next level from how the champion did on the current one: up after a
 * clean sweep, down after a collapse, otherwise stay and gather evidence.
 */
export function nextLevel(level: number, verified: number, total: number) {
  if (total === 0) return level;
  const rate = verified / total;
  if (rate >= 0.9) return Math.min(5, level + 1);
  if (rate <= 0.1 && level > 0) return level - 1;
  return level;
}

export function supportsCapability(capabilityId: string) {
  return capabilityId === CODING_CAPABILITY || capabilityId === MATH_CAPABILITY;
}
