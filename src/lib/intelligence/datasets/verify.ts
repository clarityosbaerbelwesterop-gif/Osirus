import { hamming, simhash } from "../evals/random";
import type { DatasetExample } from "../store/store";

// Dataset verification before a version is stored.
//
// Exact duplicates (same normalized fingerprint) are kept once, including a
// fingerprint already stored in this dataset's non-holdout rows. A train, dev
// or adversarial example whose fingerprint is a holdout example — in this
// batch or already stored, in any dataset — is dropped. Near-duplicate
// objectives are dropped the same way: simhash distance at or under
// NEAR_DUPLICATE_HAMMING.
//
// Holdout near-duplicates are leakage: the comparison is against holdout rows
// only, and a holdout row is not dropped for being near another holdout row.
// Train-set near-duplicates are redundancy inside the non-holdout corpus
// (train, dev, adversarial) of this dataset: the first copy is kept, a later
// copy in this batch or an already stored row of the same dataset is dropped.
// Another format of the same task is a different dataset and is not a
// train-set near-duplicate.
//
// The threshold sits between the near-duplicate pair and the unrelated pair
// in the simhash test (distances 14 and 32). Short objectives move the
// distance more than long documents do, so this is a leakage guard, not a
// general deduplicator of merely similar tasks.

export const NEAR_DUPLICATE_HAMMING = 18;

export type HoldoutSignal = {
  fingerprint: string;
  simhash: string;
};

export type ExampleSignal = HoldoutSignal & {
  partition: "train" | "dev" | "holdout" | "adversarial";
};

export type ContaminationReport = {
  checked: number;
  dropped: number;
  /** Same count as `dropped`. The lab reads this key. */
  rejected: number;
  duplicates: number;
  holdoutOverlap: number;
  /** Non-holdout objective near a holdout objective. */
  nearDuplicates: number;
  /** Non-holdout objective near another non-holdout objective in this dataset. */
  trainNearDuplicates: number;
};

type Verifiable = {
  partition: DatasetExample["partition"];
  fingerprint: string;
  text: string;
};

export function exampleText(input: Record<string, unknown>) {
  return typeof input.objective === "string" ? input.objective : "";
}

export function holdoutSignal(example: {
  fingerprint: string;
  input: Record<string, unknown>;
}): HoldoutSignal {
  const text = exampleText(example.input);
  return {
    fingerprint: example.fingerprint,
    simhash: text ? simhash(text) : "",
  };
}

function populatedHashes(signals: HoldoutSignal[]) {
  return signals
    .map((signal) => signal.simhash)
    .filter((hash) => hash.length > 0);
}

export function verifyExamples<T extends Verifiable>(
  examples: T[],
  storedHoldout: HoldoutSignal[],
  storedCorpus: HoldoutSignal[] = [],
): { kept: T[]; report: ContaminationReport } {
  const kept: T[] = [];
  const seen = new Set<string>();
  let duplicates = 0;
  for (const example of examples) {
    if (example.partition !== "holdout") continue;
    if (seen.has(example.fingerprint)) {
      duplicates += 1;
      continue;
    }
    seen.add(example.fingerprint);
    kept.push(example);
  }

  const holdoutFingerprints = new Set<string>([
    ...storedHoldout.map((signal) => signal.fingerprint),
    ...seen,
  ]);
  const holdoutHashes = [
    ...populatedHashes(storedHoldout),
    ...kept
      .filter((example) => example.text)
      .map((example) => simhash(example.text)),
  ];
  const corpusFingerprints = new Set(
    storedCorpus.map((signal) => signal.fingerprint),
  );
  const corpusHashes = populatedHashes(storedCorpus);

  let holdoutOverlap = 0;
  let nearDuplicates = 0;
  let trainNearDuplicates = 0;
  for (const example of examples) {
    if (example.partition === "holdout") continue;
    if (holdoutFingerprints.has(example.fingerprint)) {
      holdoutOverlap += 1;
      continue;
    }
    if (
      seen.has(example.fingerprint) ||
      corpusFingerprints.has(example.fingerprint)
    ) {
      duplicates += 1;
      continue;
    }
    if (example.text) {
      const hash = simhash(example.text);
      if (
        holdoutHashes.some(
          (other) => hamming(hash, other) <= NEAR_DUPLICATE_HAMMING,
        )
      ) {
        nearDuplicates += 1;
        continue;
      }
      if (
        corpusHashes.some(
          (other) => hamming(hash, other) <= NEAR_DUPLICATE_HAMMING,
        )
      ) {
        trainNearDuplicates += 1;
        continue;
      }
      corpusHashes.push(hash);
    }
    seen.add(example.fingerprint);
    kept.push(example);
  }

  const dropped =
    duplicates + holdoutOverlap + nearDuplicates + trainNearDuplicates;
  return {
    kept,
    report: {
      checked: examples.length,
      dropped,
      rejected: dropped,
      duplicates,
      holdoutOverlap,
      nearDuplicates,
      trainNearDuplicates,
    },
  };
}
