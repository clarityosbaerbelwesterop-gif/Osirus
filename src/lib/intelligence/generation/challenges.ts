import type { CapabilityLane } from "../../agent/pulse/lanes";
import { NEAR_DUPLICATE_HAMMING } from "../datasets/verify";
import { hamming, simhash } from "../evals/random";
import type { GapKind } from "../types";

// Generated challenges: Osirus attacking and testing its own machinery.
//
// An arena has three independent roles. A generator makes instances from a
// seed and a level, and keeps the ground truth in the instance's parameters.
// The solver is an Osirus mechanism -- the citation verifier, the
// disagreement engine, the mission gate, the fencing of tool results -- run
// exactly as production runs it. The verifier is an oracle computed from the
// generator's parameters, never from the solver's own output or claim: no
// part of Osirus grades itself.
//
// Every instance carries its lineage (parent, generation reason, operators),
// a content fingerprint and a surface text for novelty and contamination
// checks. Instances are deterministic in (arena, seed, level, index), so a
// failure found at 03:00 is reproduced exactly by the software-RSI pipeline.

export type ChallengeInstance = {
  id: string;
  generator: string;
  level: number;
  seed: string;
  params: Record<string, unknown>;
  lineage: { parent: string | null; reason: string; operators: string[] };
  fingerprint: string;
  /** What the instance says, for simhash novelty and contamination. */
  text: string;
};

export type ChallengeVerdict = {
  /** The mechanism did what the oracle says it must. */
  held: boolean;
  detail: string;
};

export type ChallengeArena = {
  id: string;
  kind: "self_play" | "red";
  capabilityId: string;
  family: CapabilityLane;
  /** Generator, solver, verifier. */
  roles: [string, string, string];
  verifier: string;
  gap: GapKind;
  /** The Osirus code under test, as path:symbol. */
  mechanism: string;
  /** The mechanism is part of the protected trust root (security, eval). */
  trustRoot?: boolean;
  maxLevel: number;
  generate(input: {
    seed: string;
    level: number;
    count: number;
  }): ChallengeInstance[];
  run(instance: ChallengeInstance): Promise<ChallengeVerdict>;
};

export type ArenaFailure = {
  id: string;
  level: number;
  detail: string;
  text: string;
  params: Record<string, unknown>;
};

export type ArenaRound = {
  arenaId: string;
  kind: ChallengeArena["kind"];
  level: number;
  instances: number;
  held: number;
  failed: number;
  /** Instances whose fingerprint no earlier round produced. */
  novel: number;
  duplicates: number;
  /** A generator error: the instance could not be judged. */
  invalid: number;
  failures: ArenaFailure[];
  /** Mean simhash distance to the nearest earlier instance, 0..1. */
  novelty: number;
};

/** Novelty of `text` against earlier instance texts: 1 is unrelated. */
export function noveltyOf(text: string, corpus: string[]) {
  if (!corpus.length) return 1;
  const hash = simhash(text);
  const nearest = Math.min(
    ...corpus.map((other) => hamming(hash, simhash(other))),
  );
  return Math.min(1, nearest / 32);
}

export type ContaminationCheck = {
  duplicate: boolean;
  /** Too close to a held-out item: must not be used for development. */
  contaminated: boolean;
  nearestHoldout: number | null;
  novelty: number;
};

/**
 * The anti-contamination rule for generated work: an exact fingerprint seen
 * before is a duplicate; a text within the dataset near-duplicate distance
 * of any held-out text is contaminated and never enters the dev side.
 */
export function contaminationCheck(input: {
  fingerprint: string;
  text: string;
  known: Set<string>;
  holdoutHashes: string[];
  devTexts?: string[];
}): ContaminationCheck {
  const hash = simhash(input.text);
  const distances = input.holdoutHashes.map((other) => hamming(hash, other));
  const nearestHoldout = distances.length ? Math.min(...distances) : null;
  return {
    duplicate: input.known.has(input.fingerprint),
    contaminated:
      nearestHoldout !== null && nearestHoldout <= NEAR_DUPLICATE_HAMMING,
    nearestHoldout,
    novelty: noveltyOf(input.text, input.devTexts ?? []),
  };
}

/** Run one round of an arena. A thrown instance is invalid, not a pass. */
export async function playArena(
  arena: ChallengeArena,
  input: {
    seed: string;
    level: number;
    count: number;
    /** Fingerprints earlier rounds produced. */
    known?: Set<string>;
    /** Texts of earlier instances, for novelty. */
    corpus?: string[];
  },
): Promise<ArenaRound> {
  const level = Math.max(1, Math.min(arena.maxLevel, input.level));
  const instances = arena.generate({
    seed: input.seed,
    level,
    count: input.count,
  });
  const known = input.known ?? new Set<string>();
  const corpus = input.corpus ?? [];
  const round: ArenaRound = {
    arenaId: arena.id,
    kind: arena.kind,
    level,
    instances: instances.length,
    held: 0,
    failed: 0,
    novel: 0,
    duplicates: 0,
    invalid: 0,
    failures: [],
    novelty: 0,
  };
  let novelty = 0;
  for (const instance of instances) {
    if (known.has(instance.fingerprint)) round.duplicates += 1;
    else round.novel += 1;
    novelty += noveltyOf(instance.text, corpus);
    let verdict: ChallengeVerdict;
    try {
      verdict = await arena.run(instance);
    } catch (error) {
      round.invalid += 1;
      round.failures.push({
        id: instance.id,
        level: instance.level,
        detail:
          `invalid: ${error instanceof Error ? error.message : String(error)}`.slice(
            0,
            300,
          ),
        text: instance.text.slice(0, 400),
        params: instance.params,
      });
      continue;
    }
    if (verdict.held) round.held += 1;
    else {
      round.failed += 1;
      round.failures.push({
        id: instance.id,
        level: instance.level,
        detail: verdict.detail.slice(0, 400),
        text: instance.text.slice(0, 400),
        params: instance.params,
      });
    }
  }
  round.novelty = instances.length
    ? Number((novelty / instances.length).toFixed(3))
    : 0;
  return round;
}

/**
 * How useful a generator was this round, 0..1. A generator earns its keep
 * by producing valid, new instances at a difficulty that separates working
 * from broken machinery: all-pass at its top level teaches nothing, a
 * generator that only produces invalid instances is broken.
 */
export function generatorScore(round: ArenaRound, maxLevel: number) {
  if (!round.instances) return 0;
  const validity = 1 - round.invalid / round.instances;
  const novelty = round.novel / round.instances;
  const found = round.failed > 0 ? 1 : 0;
  const headroom = round.level < maxLevel ? 0.5 : 0.1;
  const informativeness = found || headroom;
  return Number(
    (0.35 * validity + 0.3 * novelty + 0.35 * informativeness).toFixed(3),
  );
}

/**
 * The next level for an arena, from its recent rounds (newest first). A
 * level is judged on two rounds: every instance held twice means it is too
 * easy (move up: a harder version of a success); a failure seen twice is
 * confirmed and recorded, so the arena moves on to explore the next level
 * (wrapping round at the top). Anything else repeats the level.
 */
export function nextLevel(
  recent: Array<{ level: number; held: number; instances: number }>,
  maxLevel: number,
) {
  const [last, previous] = recent;
  if (!last) return 1;
  if (!previous || previous.level !== last.level) return last.level;
  const clean = (round: { held: number; instances: number }) =>
    round.instances > 0 && round.held === round.instances;
  if (clean(last) && clean(previous)) return Math.min(maxLevel, last.level + 1);
  if (!clean(last) && !clean(previous))
    return last.level < maxLevel ? last.level + 1 : 1;
  return last.level;
}
