/**
 * AI Lab — checkpoint registry (Phase H).
 *
 * File-backed, append-only store for Checkpoint records (contract:
 * ai-lab/contracts/checkpoint.ts). Integrity rules enforced here on top of
 * the contract validator:
 *
 * - `modelId` and `step` are mandatory (contract) — foreign weights are never
 *   registered as self-trained checkpoints.
 * - Parent chaining: a `parentId` must reference an already-registered
 *   checkpoint. Because the store is append-only and parents must exist
 *   first, cycles are impossible by construction.
 * - Duplicate ids are rejected; history is never rewritten.
 */

import { validateCheckpoint, type Checkpoint } from "../contracts/checkpoint";

import { JsonlStore, RegistryError } from "./jsonl-store";

export class CheckpointRegistry {
  private readonly store: JsonlStore<Checkpoint>;

  /** `filePath` is the append-only JSONL file backing this registry. */
  constructor(filePath: string) {
    this.store = new JsonlStore<Checkpoint>({
      filePath,
      kind: "checkpoint",
      validate: validateCheckpoint,
      checkIntegrity: (record, store) => {
        if (record.parentId !== undefined && !store.has(record.parentId)) {
          return [
            `parentId "${record.parentId}" is not registered: checkpoints chain onto existing parents only`,
          ];
        }
        return [];
      },
    });
  }

  /** Validate and append a checkpoint record; throws on violation/duplicate. */
  register(checkpoint: Checkpoint): Checkpoint {
    return this.store.register(checkpoint);
  }

  /** Fetch a checkpoint by id, or `undefined` when absent. */
  get(id: string): Checkpoint | undefined {
    return this.store.get(id);
  }

  /** All checkpoints in registration order, optionally narrowed by `filter`. */
  list(filter?: (checkpoint: Checkpoint) => boolean): Checkpoint[] {
    return this.store.list(filter);
  }

  /**
   * Resolve the resume lineage of a checkpoint: the chain from the requested
   * checkpoint back through `parentId` links to the root checkpoint (the one
   * without a parent). Returns the chain newest-first (requested checkpoint
   * at index 0, root last). Throws `RegistryError` for an unknown id; a
   * dangling `parentId` cannot occur in a store this registry wrote, because
   * registration enforces parent existence.
   */
  resolveLineage(id: string): Checkpoint[] {
    const lineage: Checkpoint[] = [];
    let current = this.store.get(id);
    if (current === undefined) {
      throw new RegistryError(`unknown checkpoint id "${id}"`);
    }
    while (current !== undefined) {
      lineage.push(current);
      if (current.parentId === undefined) {
        return lineage;
      }
      const parent = this.store.get(current.parentId);
      if (parent === undefined) {
        // Defensive: reachable only if the store file was edited by hand.
        throw new RegistryError(
          `checkpoint "${current.id}" has dangling parentId "${current.parentId}"`,
        );
      }
      current = parent;
    }
    return lineage;
  }

  /** Number of registered checkpoints. */
  get size(): number {
    return this.store.size;
  }
}
