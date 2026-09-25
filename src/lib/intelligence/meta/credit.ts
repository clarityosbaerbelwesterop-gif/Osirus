import { randomUUID } from "node:crypto";
import type { StrategyGenome } from "../../strategy/runtime";
import type { Experience, Hypothesis } from "../types";
import type { ConfigurationVector } from "./telemetry";

// Credit assignment and causal ablation (M42).
//
// An effect is attributed to a dimension only from pairs of configurations
// that differ in exactly that one dimension, on the same capability. A
// winner that changed several things at once is not a cause: it is split
// into single-change variants, and only the variant that carries the gain
// is named as the cause (causal memory), after it has been measured.

export type DimensionEffect = {
  dimension: string;
  from: string;
  to: string;
  capabilityId: string;
  nFrom: number;
  nTo: number;
  /** Posterior mean verified rate (Beta(1, 1)) on each side. */
  pFrom: number;
  pTo: number;
  effect: number;
  /** Rough 90% interval half-width on the difference. */
  halfWidth: number;
  significant: boolean;
};

type Cell = { n: number; verified: number };

function vectorOf(row: Experience): ConfigurationVector | null {
  const vector = (row.trajectory as { configuration?: ConfigurationVector })
    .configuration;
  return vector && typeof vector === "object" ? vector : null;
}

function key(vector: ConfigurationVector) {
  return Object.keys(vector)
    .sort()
    .map((name) => `${name}=${vector[name]}`)
    .join("|");
}

function posterior(cell: Cell) {
  const a = cell.verified + 1;
  const b = cell.n - cell.verified + 1;
  return {
    p: a / (a + b),
    variance: (a * b) / ((a + b) ** 2 * (a + b + 1)),
  };
}

/**
 * Effects of single dimensions, from paired configurations only. Rows
 * without a recorded configuration, product rows and provider errors say
 * nothing about a configuration and are left out.
 */
export function attributeCredit(
  experience: Experience[],
  minSamples = 3,
): DimensionEffect[] {
  const cells = new Map<
    string,
    { vector: ConfigurationVector; cap: string; cell: Cell }
  >();
  for (const row of experience) {
    if (row.source === "product" || row.outcome === "error") continue;
    const vector = vectorOf(row);
    if (!vector) continue;
    for (const cap of row.capabilityIds) {
      const id = `${cap}#${key(vector)}`;
      const entry = cells.get(id) ?? {
        vector,
        cap,
        cell: { n: 0, verified: 0 },
      };
      entry.cell.n += 1;
      if (row.outcome === "verified_success") entry.cell.verified += 1;
      cells.set(id, entry);
    }
  }
  const effects: DimensionEffect[] = [];
  const list = [...cells.values()].filter(
    (entry) => entry.cell.n >= minSamples,
  );
  for (let i = 0; i < list.length; i += 1)
    for (let j = i + 1; j < list.length; j += 1) {
      const a = list[i]!;
      const b = list[j]!;
      if (a.cap !== b.cap) continue;
      const names = new Set([
        ...Object.keys(a.vector),
        ...Object.keys(b.vector),
      ]);
      const differing = [...names].filter(
        (name) => a.vector[name] !== b.vector[name],
      );
      if (differing.length !== 1) continue;
      const dimension = differing[0]!;
      const pa = posterior(a.cell);
      const pb = posterior(b.cell);
      const halfWidth = 1.645 * Math.sqrt(pa.variance + pb.variance);
      const effect = pb.p - pa.p;
      effects.push({
        dimension,
        from: a.vector[dimension] ?? "",
        to: b.vector[dimension] ?? "",
        capabilityId: a.cap,
        nFrom: a.cell.n,
        nTo: b.cell.n,
        pFrom: Number(pa.p.toFixed(4)),
        pTo: Number(pb.p.toFixed(4)),
        effect: Number(effect.toFixed(4)),
        halfWidth: Number(halfWidth.toFixed(4)),
        significant: Math.abs(effect) > halfWidth,
      });
    }
  return effects.sort((x, y) => Math.abs(y.effect) - Math.abs(x.effect));
}

/** The top-level genome fields in which a challenger differs from a champion. */
export function changedFields(
  champion: StrategyGenome,
  winner: StrategyGenome,
) {
  const names = new Set([...Object.keys(champion), ...Object.keys(winner)]);
  return [...names].filter(
    (name) =>
      JSON.stringify((champion as Record<string, unknown>)[name] ?? null) !==
      JSON.stringify((winner as Record<string, unknown>)[name] ?? null),
  ) as Array<keyof StrategyGenome>;
}

/**
 * Split a multi-change winner into single-change variants: the champion
 * plus one of the winner's changes each. Run as an ablation experiment,
 * they say which change carried the gain.
 */
export function ablationHypotheses(
  champion: StrategyGenome,
  winner: StrategyGenome,
  limit = 3,
): Hypothesis[] {
  const fields = changedFields(champion, winner);
  if (fields.length < 2) return [];
  return fields.slice(0, limit).map((field) => ({
    id: randomUUID(),
    gap: "execution",
    statement: `Ablation: does the change to "${field}" alone carry the winner's gain? (the winner changed ${fields.join(", ")})`,
    intervention: {
      [field]: (winner as Record<string, unknown>)[field],
    } as StrategyGenome,
    expected:
      "Only the single change that reproduces the gain is named as the cause.",
    ablationOf: fields,
  }));
}

/**
 * Which change of a multi-change winner is the cause, from ablation
 * results: the single-change variant whose gain over the champion covers
 * most of the winner's own gain. Null until one does.
 */
export function ablationCause(input: {
  winnerGain: number;
  variants: Array<{ field: string; gain: number; n: number }>;
  minSamples?: number;
  share?: number;
}) {
  if (input.winnerGain <= 0) return null;
  const measured = input.variants.filter((v) => v.n >= (input.minSamples ?? 3));
  const best = measured.sort((a, b) => b.gain - a.gain)[0];
  if (!best || best.gain < (input.share ?? 0.7) * input.winnerGain) return null;
  return {
    field: best.field,
    gain: best.gain,
    share: best.gain / input.winnerGain,
  };
}
