/**
 * Independent judge. It scores prediction/target pairs only.
 * It does not accept a training-loop self-score.
 */

export interface JudgedRow {
  readonly id: string;
  readonly prediction: readonly number[];
  readonly target: readonly number[];
}

export interface JudgeVerdict {
  readonly judge: "independent-mse-v1";
  readonly meanSquaredError: number;
  readonly passed: boolean;
  readonly rowIds: readonly string[];
  readonly note: string;
}

export function judgePredictions(
  rows: readonly JudgedRow[],
  maxMeanLoss: number,
): JudgeVerdict {
  if (rows.length === 0) throw new Error("judge refuses an empty holdout");
  if (!(maxMeanLoss >= 0)) throw new Error("maxMeanLoss must be non-negative");
  let total = 0;
  let cells = 0;
  for (const row of rows) {
    if (
      row.prediction.length !== row.target.length ||
      row.prediction.length === 0
    ) {
      throw new Error(`judge row ${row.id} has a shape mismatch`);
    }
    for (let i = 0; i < row.prediction.length; i += 1) {
      const diff = (row.prediction[i] ?? 0) - (row.target[i] ?? 0);
      total += diff * diff;
      cells += 1;
    }
  }
  const meanSquaredError = total / cells;
  return {
    judge: "independent-mse-v1",
    meanSquaredError,
    passed: meanSquaredError <= maxMeanLoss,
    rowIds: rows.map((row) => row.id),
    note: "Fixture holdout score only. Not a model benchmark and not a self-grade.",
  };
}
