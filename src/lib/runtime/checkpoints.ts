import { randomUUID } from "node:crypto";
import type { Checkpoint } from "./types";

export class InMemoryCheckpointStore {
  private readonly items = new Map<string, Checkpoint[]>();

  save(input: {
    runId: string;
    stageId?: string | null;
    label?: string;
    state: Record<string, unknown>;
  }) {
    const current = this.items.get(input.runId) ?? [];
    const checkpoint: Checkpoint = {
      id: randomUUID(),
      runId: input.runId,
      stageId: input.stageId ?? null,
      label: input.label ?? "test-checkpoint",
      state: input.state,
      version: current.length + 1,
      createdAt: new Date().toISOString(),
    };
    this.items.set(input.runId, [...current, checkpoint]);
    return checkpoint;
  }

  latest(runId: string) {
    return this.items.get(runId)?.at(-1);
  }
}

export const CheckpointStore = InMemoryCheckpointStore;
