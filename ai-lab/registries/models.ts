import {
  isIsoDateString,
  isNonEmptyString,
  isRecord,
} from "../contracts/common";
import type { ArtifactState } from "../artifacts/states";
import { ARTIFACT_STATES } from "../artifacts/states";
import { JsonlStore } from "./jsonl-store";

export interface ModelRecord {
  readonly id: string;
  readonly trackId: string;
  readonly role: string;
  /** This milestone forbids a trained claim. The validator rejects true. */
  readonly selfTrained: false;
  readonly artifactState: ArtifactState;
  readonly createdAt: string;
}

export function validateModelRecord(value: unknown): string[] {
  if (!isRecord(value)) return ["model record must be an object"];
  const errors: string[] = [];
  if (!isNonEmptyString(value.id)) errors.push("id must be a non-empty string");
  if (!isNonEmptyString(value.trackId))
    errors.push("trackId must be a non-empty string");
  if (!isNonEmptyString(value.role))
    errors.push("role must be a non-empty string");
  if (value.selfTrained !== false) {
    errors.push(
      "selfTrained must be false; this milestone has not trained a model",
    );
  }
  if (!ARTIFACT_STATES.includes(value.artifactState as ArtifactState)) {
    errors.push("artifactState is not a known state");
  }
  if (
    value.artifactState === "production" ||
    value.artifactState === "production_candidate"
  ) {
    errors.push(
      "model registry cannot store a production state in this milestone",
    );
  }
  if (!isIsoDateString(value.createdAt))
    errors.push("createdAt must be an ISO 8601 date string");
  return errors;
}

export class ModelRegistry {
  private readonly store: JsonlStore<ModelRecord>;
  constructor(filePath: string) {
    this.store = new JsonlStore<ModelRecord>({
      filePath,
      kind: "model",
      validate: validateModelRecord,
    });
  }
  register(record: ModelRecord): ModelRecord {
    return this.store.register(record);
  }
  get(id: string): ModelRecord | undefined {
    return this.store.get(id);
  }
  list(): ModelRecord[] {
    return this.store.list();
  }
}
