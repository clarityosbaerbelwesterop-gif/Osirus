import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { ArtifactState } from "../artifacts/states";
import {
  assertNotPickle,
  assertSafeCheckpointPath,
} from "../safety/boundaries";
import type { TinyState } from "../training/tiny-engine";

export const TINY_CHECKPOINT_FORMAT = "osirus-tiny-json-v1" as const;

export interface TinyCheckpoint {
  readonly format: typeof TINY_CHECKPOINT_FORMAT;
  readonly trackId: string;
  readonly checkpointId: string;
  readonly artifactState: Extract<
    ArtifactState,
    "checkpoint_created" | "checkpoint_validated" | "holdout_passed"
  >;
  readonly kind: "infrastructure_fixture";
  readonly selfTrained: false;
  readonly state: TinyState;
}

export function serializeCheckpoint(checkpoint: TinyCheckpoint): string {
  return JSON.stringify(checkpoint);
}

export function restoreCheckpoint(
  raw: string | Uint8Array,
  filePath?: string,
): TinyCheckpoint {
  const bytes = typeof raw === "string" ? new TextEncoder().encode(raw) : raw;
  assertNotPickle(bytes, filePath);
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new Error(
      "checkpoint is not JSON; pickle and unknown formats are refused",
    );
  }
  if (!parsed || typeof parsed !== "object")
    throw new Error("checkpoint must be an object");
  const record = parsed as Partial<TinyCheckpoint>;
  if (record.format !== TINY_CHECKPOINT_FORMAT)
    throw new Error("unknown checkpoint format");
  if (record.kind !== "infrastructure_fixture")
    throw new Error("checkpoint kind is not an infrastructure fixture");
  if (record.selfTrained !== false)
    throw new Error("checkpoint claims selfTrained; refused");
  if (!record.state || record.state.in <= 0 || record.state.out <= 0)
    throw new Error("checkpoint state is incomplete");
  return record as TinyCheckpoint;
}

export class CheckpointManager {
  constructor(private readonly directory: string) {}

  create(input: { trackId: string; checkpointId: string; state: TinyState }): {
    path: string;
    checkpoint: TinyCheckpoint;
  } {
    const checkpoint: TinyCheckpoint = {
      format: TINY_CHECKPOINT_FORMAT,
      trackId: input.trackId,
      checkpointId: input.checkpointId,
      artifactState: "checkpoint_created",
      kind: "infrastructure_fixture",
      selfTrained: false,
      state: input.state,
    };
    const path = `${this.directory}/${input.checkpointId}.created.json`;
    assertSafeCheckpointPath(path);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, serializeCheckpoint(checkpoint));
    return { path, checkpoint };
  }

  restore(path: string): TinyCheckpoint {
    return restoreCheckpoint(readFileSync(path), path);
  }

  /** Restore and confirm the saved tensors round-trip. Does not mean "trained". */
  validate(path: string): { path: string; checkpoint: TinyCheckpoint } {
    const restored = this.restore(path);
    const again = restoreCheckpoint(serializeCheckpoint(restored));
    if (JSON.stringify(again.state) !== JSON.stringify(restored.state)) {
      throw new Error("checkpoint restore did not reproduce the saved tensors");
    }
    const validated: TinyCheckpoint = {
      ...restored,
      artifactState: "checkpoint_validated",
    };
    const out = `${this.directory}/${restored.checkpointId}.validated.json`;
    writeFileSync(out, serializeCheckpoint(validated));
    return { path: out, checkpoint: validated };
  }
}
