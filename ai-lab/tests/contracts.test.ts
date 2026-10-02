/**
 * AI Lab — contract validation tests.
 *
 * Positive and negative coverage for the pure `validate*` functions in
 * ai-lab/contracts/. Picked up by the root vitest gate via the
 * `ai-lab/tests/**` entry in vitest.config.ts.
 */

import { describe, expect, it } from "vitest";

import { validateCheckpoint } from "../contracts/checkpoint";
import { validateDataset, type Dataset } from "../contracts/dataset";
import { validateExperiment, type Experiment } from "../contracts/experiment";

const validDataset: Dataset = {
  id: "ds_stackv2_20261002",
  source: "bigcode/the-stack-v2",
  license: "Apache-2.0",
  provenanceUri: "https://huggingface.co/datasets/bigcode/the-stack-v2",
  dedupMethod: "minhash-lsh-v1",
  decontaminatedAgainst: ["humaneval", "mbpp", "ds-1000", "multipl-e"],
  tokenCount: 1_000_000,
  createdAt: "2026-10-02T00:00:00.000Z",
};

describe("validateDataset", () => {
  it("accepts a fully populated dataset", () => {
    expect(validateDataset(validDataset)).toEqual([]);
  });

  it("accepts a dataset without optional tokenCount", () => {
    expect(validateDataset({ ...validDataset, tokenCount: undefined })).toEqual(
      [],
    );
  });

  it("rejects non-objects", () => {
    expect(validateDataset(null)).toEqual(["dataset must be an object"]);
    expect(validateDataset("nope")).toEqual(["dataset must be an object"]);
  });

  it("rejects missing provenance and license", () => {
    const errors = validateDataset({
      ...validDataset,
      provenanceUri: "",
      license: " ",
    });
    expect(errors).toContain("provenanceUri must be a non-empty string");
    expect(errors).toContain("license must be a non-empty string");
  });

  it("rejects a negative tokenCount and a bad createdAt", () => {
    const errors = validateDataset({
      ...validDataset,
      tokenCount: -5,
      createdAt: "not-a-date",
    });
    expect(errors).toContain(
      "tokenCount must be a non-negative integer when present",
    );
    expect(errors).toContain("createdAt must be an ISO 8601 date string");
  });

  it("rejects decontaminatedAgainst entries that are empty strings", () => {
    const errors = validateDataset({
      ...validDataset,
      decontaminatedAgainst: ["humaneval", ""],
    });
    expect(errors).toContain(
      "decontaminatedAgainst must be an array of non-empty strings",
    );
  });
});

describe("validateCheckpoint", () => {
  const validCheckpoint = {
    id: "ckpt_quesnir1b_step5000",
    modelId: "osirus/quesnir-1b",
    step: 5000,
    parentId: "ckpt_quesnir1b_step4000",
    metricsRef: "exp_quesnir_smoke_001",
    storageUri: "s3://ai-lab-checkpoints/quesnir-1b/step5000",
    createdAt: "2026-10-02T00:00:00.000Z",
  };

  it("accepts a fully populated checkpoint", () => {
    expect(validateCheckpoint(validCheckpoint)).toEqual([]);
  });

  it("accepts a root checkpoint without parentId or metricsRef", () => {
    expect(
      validateCheckpoint({
        ...validCheckpoint,
        parentId: undefined,
        metricsRef: undefined,
      }),
    ).toEqual([]);
  });

  it("rejects a negative or fractional step", () => {
    expect(validateCheckpoint({ ...validCheckpoint, step: -1 })).toContain(
      "step must be a non-negative integer",
    );
    expect(validateCheckpoint({ ...validCheckpoint, step: 1.5 })).toContain(
      "step must be a non-negative integer",
    );
  });

  it("rejects missing storageUri and empty parentId", () => {
    const errors = validateCheckpoint({
      ...validCheckpoint,
      storageUri: "",
      parentId: "  ",
    });
    expect(errors).toContain("storageUri must be a non-empty string");
    expect(errors).toContain(
      "parentId must be a non-empty string when present",
    );
  });
});

describe("validateExperiment", () => {
  const validExperiment: Experiment = {
    id: "exp_quesnir_mix_ablation_001",
    hypothesis: "87/13 code/NL mix outperforms 50/50 on humaneval pass@1 at 1B",
    configHash: "sha256:deadbeef",
    datasetIds: ["ds_stackv2_20261002"],
    baselineIds: ["qwen2.5-coder-7b-instruct"],
    status: "draft",
  };

  it("accepts a draft experiment without timestamps", () => {
    expect(validateExperiment(validExperiment)).toEqual([]);
  });

  it("accepts a completed experiment with both timestamps", () => {
    expect(
      validateExperiment({
        ...validExperiment,
        status: "completed",
        startedAt: "2026-10-02T00:00:00.000Z",
        completedAt: "2026-10-03T00:00:00.000Z",
      }),
    ).toEqual([]);
  });

  it("rejects an unknown status", () => {
    const errors = validateExperiment({ ...validExperiment, status: "done" });
    expect(errors).toContain(
      "status must be one of: draft, running, completed, aborted",
    );
  });

  it("rejects completedAt without startedAt", () => {
    const errors = validateExperiment({
      ...validExperiment,
      completedAt: "2026-10-03T00:00:00.000Z",
    });
    expect(errors).toContain("completedAt requires startedAt to be set");
  });

  it("rejects completed status without completedAt", () => {
    const errors = validateExperiment({
      ...validExperiment,
      status: "completed",
      startedAt: "2026-10-02T00:00:00.000Z",
    });
    expect(errors).toContain("completed status requires completedAt");
  });

  it("rejects empty datasetIds entries and missing configHash", () => {
    const errors = validateExperiment({
      ...validExperiment,
      configHash: "",
      datasetIds: [""],
    });
    expect(errors).toContain("configHash must be a non-empty string");
    expect(errors).toContain(
      "datasetIds must be an array of non-empty strings",
    );
  });
});
