import { rngOf } from "./m57-benchmark";

// Paired statistics for same-task comparisons (M57 capability gate).
//
// Every side answers the same tasks, so the comparison is paired: what
// matters is on how many tasks one side is right and the other wrong. The
// bootstrap resamples tasks (not answers) to put a confidence interval on
// the accuracy difference; McNemar's exact test asks whether the discordant
// tasks split more unevenly than chance would.

/** Two-sided exact McNemar test on the discordant counts b and c. */
export function mcnemarExact(b: number, c: number): number {
  const n = b + c;
  if (n === 0) return 1;
  const k = Math.min(b, c);
  // log C(n, i) - n log 2, summed in probability space.
  let logTerm = -n * Math.LN2; // i = 0
  let tail = Math.exp(logTerm);
  for (let i = 1; i <= k; i += 1) {
    logTerm += Math.log(n - i + 1) - Math.log(i);
    tail += Math.exp(logTerm);
  }
  return Math.min(1, 2 * tail);
}

export type PairedResult = {
  n: number;
  /** Tasks where A is right and B wrong, and the reverse. */
  aOnly: number;
  bOnly: number;
  /** Accuracy of A minus accuracy of B, in [-1, 1]. */
  diff: number;
  ci95: [number, number];
  pValue: number;
};

/** A vs B on the same tasks: difference, bootstrap 95% CI, McNemar p. */
export function paired(
  a: boolean[],
  b: boolean[],
  options: { iterations?: number; seed?: string } = {},
): PairedResult {
  if (a.length !== b.length) throw new Error("paired samples differ in length");
  const n = a.length;
  const deltas = a.map((value, i) => Number(value) - Number(b[i]));
  const aOnly = deltas.filter((d) => d === 1).length;
  const bOnly = deltas.filter((d) => d === -1).length;
  const diff = n ? (aOnly - bOnly) / n : 0;
  const iterations = options.iterations ?? 10_000;
  const random = rngOf(options.seed ?? "bootstrap");
  const means: number[] = [];
  for (let it = 0; it < iterations && n; it += 1) {
    let sum = 0;
    for (let i = 0; i < n; i += 1) sum += deltas[Math.floor(random() * n)]!;
    means.push(sum / n);
  }
  means.sort((x, y) => x - y);
  const at = (q: number) =>
    means.length
      ? means[Math.min(means.length - 1, Math.floor(q * means.length))]!
      : 0;
  return {
    n,
    aOnly,
    bOnly,
    diff,
    ci95: [at(0.025), at(0.975)],
    pValue: mcnemarExact(aOnly, bOnly),
  };
}
