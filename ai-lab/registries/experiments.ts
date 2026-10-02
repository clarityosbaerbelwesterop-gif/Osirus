/**
 * AI Lab — experiment registry (Phase H).
 *
 * File-backed, append-only store for Experiment records (contract:
 * ai-lab/contracts/experiment.ts). Integrity rules enforced here on top of
 * the contract validator:
 *
 * - `configHash` is mandatory (contract) — the reproducibility anchor.
 * - `datasetIds` must be a non-empty array: an experiment without recorded
 *   training data must not exist (hypothesis + config + data before any run).
 * - Duplicate ids are rejected; history is never rewritten.
 */

import { validateExperiment, type Experiment } from "../contracts/experiment";

import { JsonlStore } from "./jsonl-store";

export class ExperimentRegistry {
  private readonly store: JsonlStore<Experiment>;

  /** `filePath` is the append-only JSONL file backing this registry. */
  constructor(filePath: string) {
    this.store = new JsonlStore<Experiment>({
      filePath,
      kind: "experiment",
      validate: validateExperiment,
      checkIntegrity: (record) =>
        record.datasetIds.length > 0
          ? []
          : ["datasetIds must reference at least one registered dataset id"],
    });
  }

  /** Validate and append an experiment record; throws on violation/duplicate. */
  register(experiment: Experiment): Experiment {
    return this.store.register(experiment);
  }

  /** Fetch an experiment by id, or `undefined` when absent. */
  get(id: string): Experiment | undefined {
    return this.store.get(id);
  }

  /** All experiments in registration order, optionally narrowed by `filter`. */
  list(filter?: (experiment: Experiment) => boolean): Experiment[] {
    return this.store.list(filter);
  }

  /** Number of registered experiments. */
  get size(): number {
    return this.store.size;
  }
}
