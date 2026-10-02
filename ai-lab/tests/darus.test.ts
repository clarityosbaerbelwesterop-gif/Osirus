/**
 * AI Lab — Darus scaffold tests.
 *
 * Verifies that ai-lab/models/darus/model.config.ts loads, that its records
 * satisfy the registry contract validators, and that the honesty invariants
 * hold structurally: foreign baselines are selfTrained=false, the
 * native_checkpoint slot is empty until real training happens, and
 * GenerateRequest.seed stays mandatory for eval reproducibility.
 *
 * Picked up by the root vitest gate via `ai-lab/tests/**` in vitest.config.ts.
 */

import { describe, expect, it } from "vitest";

import { validateCheckpoint, type Checkpoint } from "../contracts/checkpoint";
import { validateDataset } from "../contracts/dataset";
import { validateExperiment } from "../contracts/experiment";
import type { GenerateRequest } from "../contracts/model-backend";
import {
  DARUS_ACTIVE_BACKENDS,
  DARUS_API_PROVIDER_BASELINE,
  DARUS_BASELINE_EVAL_EXPERIMENT,
  DARUS_BASELINE_LICENSES,
  DARUS_DATASET_PLAN,
  DARUS_DISTILLATION_EVAL_EXPERIMENT,
  DARUS_MODEL_ID,
  DARUS_NATIVE_CHECKPOINT_SLOT,
  DARUS_PLANNED_ARCHITECTURE,
  DARUS_REMOTE_INFERENCE_BASELINE,
  DARUS_ROLE,
} from "../models/darus/model.config";

describe("darus model.config module", () => {
  it("loads and exposes the scaffold exports", () => {
    expect(DARUS_MODEL_ID).toBe("osirus/darus-1");
    expect(DARUS_ROLE).toContain("broad expert");
    expect(DARUS_PLANNED_ARCHITECTURE.status).toBe("planned");
    expect(DARUS_ACTIVE_BACKENDS.length).toBe(2);
  });

  it("marks every architecture parameter set as planned, never measured", () => {
    expect(DARUS_PLANNED_ARCHITECTURE.status).toBe("planned");
    expect(DARUS_PLANNED_ARCHITECTURE.targetParameterClass).toContain(
      "PLANNED",
    );
  });
});

describe("backend honesty invariants", () => {
  it("configures api_provider and remote_inference baselines only", () => {
    const kinds = DARUS_ACTIVE_BACKENDS.map((config) => config.kind).sort();
    expect(kinds).toEqual(["api_provider", "remote_inference"]);
  });

  it("forces selfTrained=false on every foreign baseline", () => {
    for (const config of DARUS_ACTIVE_BACKENDS) {
      expect(config.selfTrained).toBe(false);
    }
    expect(DARUS_API_PROVIDER_BASELINE.selfTrained).toBe(false);
    expect(DARUS_REMOTE_INFERENCE_BASELINE.selfTrained).toBe(false);
  });

  it("contains no native_checkpoint backend before real training", () => {
    expect(
      DARUS_ACTIVE_BACKENDS.some(
        (config) => config.kind === "native_checkpoint",
      ),
    ).toBe(false);
  });

  it("keeps the native checkpoint slot empty (no self-trained claim)", () => {
    // The slot may only become a NativeCheckpointConfig (selfTrained: true)
    // after an actual AI-Lab training run under owner authorization.
    expect(DARUS_NATIVE_CHECKPOINT_SLOT).toBeNull();
  });

  it("uses placeholder endpoints and env-var key references, never secrets", () => {
    for (const config of [
      DARUS_API_PROVIDER_BASELINE,
      DARUS_REMOTE_INFERENCE_BASELINE,
    ]) {
      expect(config.endpointUrl).toContain(".invalid");
    }
    // apiKeyRef names an environment variable; it must not look like a key.
    expect(DARUS_API_PROVIDER_BASELINE.apiKeyRef).toMatch(/^[A-Z0-9_]+$/);
  });
});

describe("baseline license review slots", () => {
  it("covers every active baseline with a pending license record", () => {
    expect(DARUS_BASELINE_LICENSES.length).toBe(DARUS_ACTIVE_BACKENDS.length);
    for (const record of DARUS_BASELINE_LICENSES) {
      expect(record.reviewStatus).toBe("pending");
      expect(record.license).toContain("pending");
    }
  });

  it("links each license record to a configured baseline modelId", () => {
    const baselineIds = DARUS_ACTIVE_BACKENDS.map((config) => config.modelId);
    for (const record of DARUS_BASELINE_LICENSES) {
      expect(baselineIds).toContain(record.modelId);
    }
  });
});

describe("contract validation of the scaffold records", () => {
  it("validates the draft baseline-eval experiment", () => {
    expect(validateExperiment(DARUS_BASELINE_EVAL_EXPERIMENT)).toEqual([]);
    expect(DARUS_BASELINE_EVAL_EXPERIMENT.status).toBe("draft");
  });

  it("validates the draft distillation-eval experiment as a plan only", () => {
    expect(validateExperiment(DARUS_DISTILLATION_EVAL_EXPERIMENT)).toEqual([]);
    expect(DARUS_DISTILLATION_EVAL_EXPERIMENT.status).toBe("draft");
    // Honest as a plan: the hypothesis records preconditions, not outcomes.
    expect(DARUS_DISTILLATION_EVAL_EXPERIMENT.hypothesis).toContain("license");
  });

  it("validates every planned dataset entry", () => {
    expect(DARUS_DATASET_PLAN.length).toBeGreaterThan(0);
    for (const dataset of DARUS_DATASET_PLAN) {
      expect(validateDataset(dataset)).toEqual([]);
      // Planned entries are placeholders, not registry records.
      expect(dataset.id).toContain("PLANNED");
    }
  });

  it("planned datasets record decontamination against the darus suites", () => {
    for (const dataset of DARUS_DATASET_PLAN) {
      expect(dataset.decontaminatedAgainst).toContain("darus-mmlu-like");
      expect(dataset.decontaminatedAgainst).toContain("darus-arc-like");
      expect(dataset.decontaminatedAgainst).toContain("darus-domain-suites");
    }
  });

  it("records teacher outputs as a provenance-bearing data source", () => {
    const distillation = DARUS_DATASET_PLAN.find((dataset) =>
      dataset.id.includes("distillation"),
    );
    expect(distillation).toBeDefined();
    // Teacher outputs as data = provenance duty: teacher id, license, and
    // generation config must be recorded before any use.
    expect(distillation?.source).toContain("teacher");
    expect(distillation?.license).toContain("pending");
    expect(distillation?.provenanceUri).toContain("teacher");
  });

  it("a future real checkpoint would validate against the checkpoint contract", () => {
    // Shape check only: this fixture describes what Stage E must register —
    // no such checkpoint exists today.
    const futureCheckpoint: Checkpoint = {
      id: "ckpt_darus1_step0_PLANNED",
      modelId: DARUS_MODEL_ID,
      step: 0,
      storageUri: "planned: registered at training time",
      createdAt: "2026-10-02T00:00:00.000Z",
    };
    expect(validateCheckpoint(futureCheckpoint)).toEqual([]);
  });
});

describe("GenerateRequest seed obligation", () => {
  it("accepts a request with a mandatory seed", () => {
    const request: GenerateRequest = {
      prompt: "What is the capital of France?",
      maxTokens: 16,
      temperature: 0,
      seed: 42,
    };
    expect(request.seed).toBe(42);
  });

  it("rejects a request without a seed at the type level", () => {
    // @ts-expect-error seed is mandatory: pass@1 numbers without a recorded
    // seed are not acceptable evidence in this program.
    const missingSeed: GenerateRequest = {
      prompt: "What is the capital of France?",
      maxTokens: 16,
      temperature: 0,
    };
    expect("seed" in missingSeed).toBe(false);
  });
});
