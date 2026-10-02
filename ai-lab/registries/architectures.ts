import {
  isIsoDateString,
  isNonEmptyString,
  isNonNegativeInteger,
  isRecord,
} from "../contracts/common";
import { JsonlStore } from "./jsonl-store";

export interface ArchitectureRecord {
  readonly id: string;
  readonly trackId: string;
  readonly family: string;
  readonly layers: number;
  readonly hiddenSize: number;
  readonly attentionHeads: number;
  readonly status: "planned" | "fixture";
  readonly createdAt: string;
}

export function validateArchitectureRecord(value: unknown): string[] {
  if (!isRecord(value)) return ["architecture record must be an object"];
  const errors: string[] = [];
  if (!isNonEmptyString(value.id)) errors.push("id must be a non-empty string");
  if (!isNonEmptyString(value.trackId))
    errors.push("trackId must be a non-empty string");
  if (!isNonEmptyString(value.family))
    errors.push("family must be a non-empty string");
  if (!isNonNegativeInteger(value.layers) || value.layers === 0)
    errors.push("layers must be a positive integer");
  if (!isNonNegativeInteger(value.hiddenSize) || value.hiddenSize === 0) {
    errors.push("hiddenSize must be a positive integer");
  }
  if (
    !isNonNegativeInteger(value.attentionHeads) ||
    value.attentionHeads === 0
  ) {
    errors.push("attentionHeads must be a positive integer");
  }
  if (value.status !== "planned" && value.status !== "fixture") {
    errors.push('status must be "planned" or "fixture"');
  }
  if (!isIsoDateString(value.createdAt))
    errors.push("createdAt must be an ISO 8601 date string");
  return errors;
}

export class ArchitectureRegistry {
  private readonly store: JsonlStore<ArchitectureRecord>;
  constructor(filePath: string) {
    this.store = new JsonlStore<ArchitectureRecord>({
      filePath,
      kind: "architecture",
      validate: validateArchitectureRecord,
    });
  }
  register(record: ArchitectureRecord): ArchitectureRecord {
    return this.store.register(record);
  }
  get(id: string): ArchitectureRecord | undefined {
    return this.store.get(id);
  }
}
