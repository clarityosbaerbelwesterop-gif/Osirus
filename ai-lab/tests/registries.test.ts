/**
 * AI Lab — registry tests (Phase H).
 *
 * Coverage for the file-backed append-only registries in ai-lab/registries/:
 * register/get/list, duplicate rejection, checkpoint lineage, contract
 * validation failures, integrity rules, and reload persistence. Each test
 * uses a fresh temporary JSONL file; nothing touches the network or a DB.
 * Picked up by the root vitest gate via the `ai-lab/tests/**` include.
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { Checkpoint } from "../contracts/checkpoint";
import type { Dataset } from "../contracts/dataset";
import type { Experiment } from "../contracts/experiment";
import { CheckpointRegistry } from "../registries/checkpoints";
import { DatasetRegistry } from "../registries/datasets";
import { ExperimentRegistry } from "../registries/experiments";
import { RegistryError } from "../registries/jsonl-store";

const validDataset: Dataset = {
  id: "ds_stackv2_20261002",
  source: "bigcode/the-stack-v2",
  license: "Apache-2.0",
  provenanceUri: "https://huggingface.co/datasets/bigcode/the-stack-v2",
  dedupMethod: "minhash-lsh-v1",
  decontaminatedAgainst: ["humaneval", "mbpp"],
  tokenCount: 1_000_000,
  createdAt: "2026-10-02T00:00:00.000Z",
};

const rootCheckpoint: Checkpoint = {
  id: "ckpt_quesnir1b_step0",
  modelId: "osirus/quesnir-1b",
  step: 0,
  storageUri: "file://ckpt/step0",
  createdAt: "2026-10-02T00:00:00.000Z",
};

const validExperiment: Experiment = {
  id: "exp_quesnir_mix_ablation_001",
  hypothesis: "87/13 code/NL mix outperforms 50/50 on humaneval pass@1 at 1B",
  configHash: "sha256:deadbeef",
  datasetIds: ["ds_stackv2_20261002"],
  baselineIds: ["qwen2.5-coder-7b"],
  status: "draft",
};

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ai-lab-registries-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function datasetFile(): string {
  return join(dir, "datasets.jsonl");
}

function checkpointFile(): string {
  return join(dir, "checkpoints.jsonl");
}

function experimentFile(): string {
  return join(dir, "experiments.jsonl");
}

describe("DatasetRegistry", () => {
  it("registers and retrieves a dataset", () => {
    const registry = new DatasetRegistry(datasetFile());
    registry.register(validDataset);
    expect(registry.get(validDataset.id)).toEqual(validDataset);
    expect(registry.size).toBe(1);
  });

  it("returns undefined for an unknown id", () => {
    const registry = new DatasetRegistry(datasetFile());
    expect(registry.get("nope")).toBeUndefined();
  });

  it("lists all datasets and applies filters", () => {
    const registry = new DatasetRegistry(datasetFile());
    registry.register(validDataset);
    registry.register({
      ...validDataset,
      id: "ds_starcoder2_20261002",
      source: "bigcode/starcoder2data",
    });
    expect(registry.list()).toHaveLength(2);
    const filtered = registry.list((d) => d.source.includes("starcoder"));
    expect(filtered.map((d) => d.id)).toEqual(["ds_starcoder2_20261002"]);
  });

  it("rejects a duplicate id", () => {
    const registry = new DatasetRegistry(datasetFile());
    registry.register(validDataset);
    expect(() => registry.register(validDataset)).toThrowError(RegistryError);
    expect(() => registry.register(validDataset)).toThrowError(/duplicate/);
  });

  it("rejects a dataset without license or provenanceUri", () => {
    const registry = new DatasetRegistry(datasetFile());
    expect(() =>
      registry.register({ ...validDataset, license: "" }),
    ).toThrowError(/license/);
    expect(() =>
      registry.register({ ...validDataset, provenanceUri: "  " }),
    ).toThrowError(/provenanceUri/);
    expect(registry.size).toBe(0);
  });

  it("persists records to JSONL and reloads them in a fresh instance", () => {
    const file = datasetFile();
    new DatasetRegistry(file).register(validDataset);
    const lines = readFileSync(file, "utf8").trim().split("\n");
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0])).toEqual(validDataset);
    const reloaded = new DatasetRegistry(file);
    expect(reloaded.get(validDataset.id)).toEqual(validDataset);
  });
});

describe("CheckpointRegistry", () => {
  it("registers a root checkpoint and a child chained via parentId", () => {
    const registry = new CheckpointRegistry(checkpointFile());
    registry.register(rootCheckpoint);
    const child: Checkpoint = {
      ...rootCheckpoint,
      id: "ckpt_quesnir1b_step1000",
      step: 1000,
      parentId: rootCheckpoint.id,
    };
    registry.register(child);
    expect(registry.get(child.id)?.parentId).toBe(rootCheckpoint.id);
  });

  it("resolves the full lineage from leaf to root", () => {
    const registry = new CheckpointRegistry(checkpointFile());
    registry.register(rootCheckpoint);
    const mid: Checkpoint = {
      ...rootCheckpoint,
      id: "ckpt_step1000",
      step: 1000,
      parentId: rootCheckpoint.id,
    };
    const leaf: Checkpoint = {
      ...rootCheckpoint,
      id: "ckpt_step2000",
      step: 2000,
      parentId: mid.id,
    };
    registry.register(mid);
    registry.register(leaf);
    const lineage = registry.resolveLineage(leaf.id);
    expect(lineage.map((c) => c.id)).toEqual([
      leaf.id,
      mid.id,
      rootCheckpoint.id,
    ]);
  });

  it("resolveLineage of a root checkpoint is a singleton chain", () => {
    const registry = new CheckpointRegistry(checkpointFile());
    registry.register(rootCheckpoint);
    expect(registry.resolveLineage(rootCheckpoint.id)).toEqual([
      rootCheckpoint,
    ]);
  });

  it("throws for resolveLineage of an unknown id", () => {
    const registry = new CheckpointRegistry(checkpointFile());
    expect(() => registry.resolveLineage("missing")).toThrowError(/unknown/);
  });

  it("rejects a checkpoint whose parentId is not registered", () => {
    const registry = new CheckpointRegistry(checkpointFile());
    expect(() =>
      registry.register({ ...rootCheckpoint, id: "ckpt_x", parentId: "ghost" }),
    ).toThrowError(/parentId/);
  });

  it("rejects a checkpoint without modelId or with a negative step", () => {
    const registry = new CheckpointRegistry(checkpointFile());
    expect(() =>
      registry.register({ ...rootCheckpoint, modelId: "" }),
    ).toThrowError(/modelId/);
    expect(() =>
      registry.register({ ...rootCheckpoint, step: -1 }),
    ).toThrowError(/step/);
  });

  it("rejects duplicate checkpoint ids", () => {
    const registry = new CheckpointRegistry(checkpointFile());
    registry.register(rootCheckpoint);
    expect(() => registry.register(rootCheckpoint)).toThrowError(/duplicate/);
  });
});

describe("ExperimentRegistry", () => {
  it("registers, gets and lists experiments with a status filter", () => {
    const registry = new ExperimentRegistry(experimentFile());
    registry.register(validExperiment);
    registry.register({
      ...validExperiment,
      id: "exp_quesnir_mix_ablation_002",
      status: "running",
      startedAt: "2026-10-02T01:00:00.000Z",
    });
    expect(registry.get(validExperiment.id)).toEqual(validExperiment);
    expect(
      registry.list((e) => e.status === "running").map((e) => e.id),
    ).toEqual(["exp_quesnir_mix_ablation_002"]);
  });

  it("rejects an experiment without configHash", () => {
    const registry = new ExperimentRegistry(experimentFile());
    expect(() =>
      registry.register({ ...validExperiment, configHash: "" }),
    ).toThrowError(/configHash/);
  });

  it("rejects an experiment with an empty datasetIds array", () => {
    const registry = new ExperimentRegistry(experimentFile());
    expect(() =>
      registry.register({ ...validExperiment, datasetIds: [] }),
    ).toThrowError(/datasetIds/);
  });

  it("rejects duplicate experiment ids", () => {
    const registry = new ExperimentRegistry(experimentFile());
    registry.register(validExperiment);
    expect(() => registry.register(validExperiment)).toThrowError(/duplicate/);
  });
});

describe("store robustness", () => {
  it("refuses to load a corrupt JSONL file", () => {
    const file = datasetFile();
    writeFileSync(file, `${JSON.stringify(validDataset)}\nnot-json\n`, "utf8");
    expect(() => new DatasetRegistry(file)).toThrowError(/corrupt/);
  });

  it("starts empty when the backing file does not exist", () => {
    const registry = new ExperimentRegistry(join(dir, "nested", "exp.jsonl"));
    expect(registry.list()).toEqual([]);
    registry.register(validExperiment);
    expect(registry.size).toBe(1);
  });
});
