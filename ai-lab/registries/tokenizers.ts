import { createHash } from "node:crypto";
import {
  isNonEmptyString,
  isNonNegativeInteger,
  isRecord,
} from "../contracts/common";
import { JsonlStore } from "./jsonl-store";

export interface TokenizerPinInput {
  readonly id: string;
  readonly trackId: string;
  readonly family: string;
  readonly version: string;
  readonly vocabSize: number;
}

export interface TokenizerRecord extends TokenizerPinInput {
  /** sha256 of the canonical pin payload. A moved vocab must change version. */
  readonly pin: string;
}

export function tokenizerPin(input: TokenizerPinInput): string {
  const payload = JSON.stringify([
    input.id,
    input.trackId,
    input.family,
    input.version,
    input.vocabSize,
  ]);
  return createHash("sha256").update(payload).digest("hex");
}

export function validateTokenizerRecord(value: unknown): string[] {
  if (!isRecord(value)) return ["tokenizer record must be an object"];
  const errors: string[] = [];
  if (!isNonEmptyString(value.id)) errors.push("id must be a non-empty string");
  if (!isNonEmptyString(value.trackId))
    errors.push("trackId must be a non-empty string");
  if (!isNonEmptyString(value.family))
    errors.push("family must be a non-empty string");
  if (!isNonEmptyString(value.version))
    errors.push("version must be a non-empty string");
  if (!isNonNegativeInteger(value.vocabSize) || value.vocabSize === 0) {
    errors.push("vocabSize must be a positive integer");
  }
  if (!isNonEmptyString(value.pin))
    errors.push("pin must be a non-empty string");
  if (errors.length === 0) {
    const expected = tokenizerPin({
      id: value.id as string,
      trackId: value.trackId as string,
      family: value.family as string,
      version: value.version as string,
      vocabSize: value.vocabSize as number,
    });
    if (value.pin !== expected)
      errors.push("tokenizer pin does not match id/family/version/vocabSize");
  }
  return errors;
}

export class TokenizerRegistry {
  private readonly store: JsonlStore<TokenizerRecord>;
  constructor(filePath: string) {
    this.store = new JsonlStore<TokenizerRecord>({
      filePath,
      kind: "tokenizer",
      validate: validateTokenizerRecord,
    });
  }
  register(record: TokenizerRecord): TokenizerRecord {
    const errors = validateTokenizerRecord(record);
    if (errors.length) throw new Error(errors.join("; "));
    return this.store.register(record);
  }
  get(id: string): TokenizerRecord | undefined {
    return this.store.get(id);
  }
  /** Refuse a training step whose requested pin is not the registered one. */
  assertPinned(id: string, pin: string): TokenizerRecord {
    const record = this.get(id);
    if (!record) throw new Error(`tokenizer ${id} is not registered`);
    if (record.pin !== pin) {
      throw new Error(`tokenizer version pin mismatch for ${id}`);
    }
    return record;
  }
}
