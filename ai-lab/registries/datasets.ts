/**
 * AI Lab — dataset registry (Phase H).
 *
 * File-backed, append-only store for Dataset records (contract:
 * ai-lab/contracts/dataset.ts). Integrity rules enforced here on top of the
 * contract validator:
 *
 * - `license` and `provenanceUri` are mandatory (contract) — a corpus without
 *   provenance and license evidence must not exist in the lab (handoff
 *   Stage A; reuse doc §§ 3–4).
 * - Duplicate ids are rejected; history is never rewritten.
 */

import { validateDataset, type Dataset } from "../contracts/dataset";

import { JsonlStore } from "./jsonl-store";

export class DatasetRegistry {
  private readonly store: JsonlStore<Dataset>;

  /** `filePath` is the append-only JSONL file backing this registry. */
  constructor(filePath: string) {
    this.store = new JsonlStore<Dataset>({
      filePath,
      kind: "dataset",
      validate: validateDataset,
    });
  }

  /** Validate and append a dataset record; throws on violation/duplicate. */
  register(dataset: Dataset): Dataset {
    return this.store.register(dataset);
  }

  /** Fetch a dataset by id, or `undefined` when absent. */
  get(id: string): Dataset | undefined {
    return this.store.get(id);
  }

  /** All datasets in registration order, optionally narrowed by `filter`. */
  list(filter?: (dataset: Dataset) => boolean): Dataset[] {
    return this.store.list(filter);
  }

  /** Number of registered datasets. */
  get size(): number {
    return this.store.size;
  }
}
