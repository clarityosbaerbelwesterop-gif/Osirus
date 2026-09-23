// Statistics for champion/challenger comparisons.
//
// Samples are small (a free model allows about one call a minute), so the
// evidence is weighed, not thresholded on a raw score: a Beta posterior per
// arm of the comparison, the probability that the challenger's verified rate
// is higher, the paired discordance on identical tasks, and an exact sign
// test on the discordant pairs. Everything is deterministic: no sampling.

function logGamma(x: number): number {
  // Lanczos approximation, g = 7, n = 9.
  const coefficients = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028,
    771.32342877765313, -176.61502916214059, 12.507343278686905,
    -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
  ];
  if (x < 0.5)
    return Math.log(Math.PI / Math.sin(Math.PI * x)) - logGamma(1 - x);
  const shifted = x - 1;
  let sum = coefficients[0]!;
  for (let index = 1; index < 9; index += 1)
    sum += coefficients[index]! / (shifted + index);
  const t = shifted + 7.5;
  return (
    0.5 * Math.log(2 * Math.PI) +
    (shifted + 0.5) * Math.log(t) -
    t +
    Math.log(sum)
  );
}

function logBeta(a: number, b: number) {
  return logGamma(a) + logGamma(b) - logGamma(a + b);
}

export function betaPdf(x: number, a: number, b: number) {
  if (x <= 0 || x >= 1) return 0;
  return Math.exp(
    (a - 1) * Math.log(x) + (b - 1) * Math.log(1 - x) - logBeta(a, b),
  );
}

const GRID = 4000;

/**
 * P(p_challenger > p_champion) with independent Beta(1+s, 1+f) posteriors,
 * integrated on a fine grid. Uniform priors: no assumption either way.
 */
export function probabilityBetter(
  challenger: { successes: number; trials: number },
  champion: { successes: number; trials: number },
) {
  const a1 = 1 + challenger.successes;
  const b1 = 1 + challenger.trials - challenger.successes;
  const a2 = 1 + champion.successes;
  const b2 = 1 + champion.trials - champion.successes;
  const step = 1 / GRID;
  let championCdf = 0;
  let probability = 0;
  let previousChampionPdf = 0;
  for (let index = 1; index < GRID; index += 1) {
    const x = index * step;
    const championPdf = betaPdf(x, a2, b2);
    championCdf += ((previousChampionPdf + championPdf) / 2) * step;
    previousChampionPdf = championPdf;
    probability += betaPdf(x, a1, b1) * Math.min(1, championCdf) * step;
  }
  return Math.max(0, Math.min(1, probability));
}

function logChoose(n: number, k: number) {
  return logGamma(n + 1) - logGamma(k + 1) - logGamma(n - k + 1);
}

/**
 * One-sided exact sign test on discordant pairs: the probability of at least
 * `wins` challenger-only successes out of `wins + losses` if both were equal.
 */
export function signTestP(wins: number, losses: number) {
  const n = wins + losses;
  if (n === 0) return 1;
  let p = 0;
  for (let k = wins; k <= n; k += 1)
    p += Math.exp(logChoose(n, k) - n * Math.LN2);
  return Math.min(1, p);
}

/** Posterior mean and a normal-approximation 90% interval of p_c - p_h. */
export function differenceInterval(
  challenger: { successes: number; trials: number },
  champion: { successes: number; trials: number },
) {
  const moments = (s: number, n: number) => {
    const a = 1 + s;
    const b = 1 + n - s;
    const mean = a / (a + b);
    const variance = (a * b) / ((a + b) ** 2 * (a + b + 1));
    return { mean, variance };
  };
  const c = moments(challenger.successes, challenger.trials);
  const h = moments(champion.successes, champion.trials);
  const mean = c.mean - h.mean;
  const sd = Math.sqrt(c.variance + h.variance);
  return { mean, low: mean - 1.645 * sd, high: mean + 1.645 * sd };
}

export type PairedOutcome = {
  taskId: string;
  champion: boolean;
  challenger: boolean;
};

export function discordance(pairs: PairedOutcome[]) {
  let challengerOnly = 0;
  let championOnly = 0;
  for (const pair of pairs) {
    if (pair.challenger && !pair.champion) challengerOnly += 1;
    if (pair.champion && !pair.challenger) championOnly += 1;
  }
  return { challengerOnly, championOnly };
}

/**
 * Minimum paired tasks before a decision is allowed at all. A comparison on
 * fewer tasks is reported as inconclusive, never as an improvement.
 */
export const MIN_PAIRED = 3;
