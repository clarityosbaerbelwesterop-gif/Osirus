import { createHash } from "node:crypto";

export interface SplitRow {
  readonly id: string;
}

export interface HoldoutSplit<T extends SplitRow> {
  readonly train: readonly T[];
  readonly holdout: readonly T[];
}

/**
 * Deterministic train/holdout split. A row id is in at most one side.
 * The holdout is never derived from the training loss.
 */
export function splitHoldout<T extends SplitRow>(
  rows: readonly T[],
  holdoutFraction: number,
  seed: string,
): HoldoutSplit<T> {
  if (!(holdoutFraction > 0 && holdoutFraction < 1)) {
    throw new Error("holdoutFraction must be between 0 and 1");
  }
  const seen = new Set<string>();
  const train: T[] = [];
  const holdout: T[] = [];
  for (const row of rows) {
    if (seen.has(row.id)) throw new Error(`duplicate row id ${row.id}`);
    seen.add(row.id);
    const digest = createHash("sha256").update(`${seed}\n${row.id}`).digest();
    const unit = digest.readUInt32BE(0) / 0xffff_ffff;
    if (unit < holdoutFraction) holdout.push(row);
    else train.push(row);
  }
  const trainIds = new Set(train.map((row) => row.id));
  for (const row of holdout) {
    if (trainIds.has(row.id)) throw new Error("holdout isolation failed");
  }
  return { train, holdout };
}
