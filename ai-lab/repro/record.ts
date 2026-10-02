import { createHash } from "node:crypto";

export function stableStringify(value: unknown): string {
  if (Array.isArray(value))
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(
      ([a], [b]) => (a < b ? -1 : a > b ? 1 : 0),
    );
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function configHash(value: unknown): string {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

export interface ReproducibilityRecord {
  readonly experimentId: string;
  readonly seed: number;
  readonly configHash: string;
  readonly datasetIds: readonly string[];
  readonly tokenizerPin: string;
  readonly codeRevision: string | null;
  readonly note: string;
}

export function reproducibilityRecord(input: {
  experimentId: string;
  seed: number;
  config: unknown;
  datasetIds: readonly string[];
  tokenizerPin: string;
  codeRevision?: string | null;
}): ReproducibilityRecord {
  return {
    experimentId: input.experimentId,
    seed: input.seed,
    configHash: configHash(input.config),
    datasetIds: [...input.datasetIds],
    tokenizerPin: input.tokenizerPin,
    codeRevision: input.codeRevision ?? null,
    note: "Infrastructure record only. Not a trained-model claim and not a benchmark.",
  };
}
