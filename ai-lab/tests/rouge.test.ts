/**
 * AI Lab — Rouge 1 scaffold tests.
 *
 * Verifies that ai-lab/models/rouge/model.config.ts loads, that its records
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
  ROUGE1_ACTIVE_BACKENDS,
  ROUGE1_API_PROVIDER_BASELINE,
  ROUGE1_BASELINE_EVAL_EXPERIMENT,
  ROUGE1_DATASET_PLAN,
  ROUGE1_MODEL_ID,
  ROUGE1_NATIVE_CHECKPOINT_SLOT,
  ROUGE1_PLANNED_ARCHITECTURE,
  ROUGE1_REMOTE_INFERENCE_BASELINE,
  ROUGE1_ROLE,
} from "../models/rouge/model.config";

describe("rouge model.config module", () => {
  it("loads and exposes the scaffold exports", () => {
    expect(ROUGE1_MODEL_ID).toBe("osirus/rouge-1");
    expect(ROUGE1_ROLE).toBe("general/reasoning");
    expect(ROUGE1_PLANNED_ARCHITECTURE.status).toBe("planned");
    expect(ROUGE1_ACTIVE_BACKENDS.length).toBe(2);
  });

  it("marks every architecture parameter set as planned, never measured", () => {
    expect(ROUGE1_PLANNED_ARCHITECTURE.status).toBe("planned");
    expect(ROUGE1_PLANNED_ARCHITECTURE.targetParameterClass).toContain(
      "PLANNED",
    );
  });
});

describe("backend honesty invariants", () => {
  it("configures api_provider and remote_inference baselines only", () => {
    const kinds = ROUGE1_ACTIVE_BACKENDS.map((config) => config.kind).sort();
    expect(kinds).toEqual(["api_provider", "remote_inference"]);
  });

  it("forces selfTrained=false on every foreign baseline", () => {
    for (const config of ROUGE1_ACTIVE_BACKENDS) {
      expect(config.selfTrained).toBe(false);
    }
    expect(ROUGE1_API_PROVIDER_BASELINE.selfTrained).toBe(false);
    expect(ROUGE1_REMOTE_INFERENCE_BASELINE.selfTrained).toBe(false);
  });

  it("contains no native_checkpoint backend before real training", () => {
    expect(
      ROUGE1_ACTIVE_BACKENDS.some(
        (config) => config.kind === "native_checkpoint",
      ),
    ).toBe(false);
  });

  it("keeps the native checkpoint slot empty (no self-trained claim)", () => {
    // The slot may only become a NativeCheckpointConfig (selfTrained: true)
    // after an actual AI-Lab training run under owner authorization.
    expect(ROUGE1_NATIVE_CHECKPOINT_SLOT).toBeNull();
  });

  it("uses placeholder endpoints and env-var key references, never secrets", () => {
    for (const config of [
      ROUGE1_API_PROVIDER_BASELINE,
      ROUGE1_REMOTE_INFERENCE_BASELINE,
    ]) {
      expect(config.endpointUrl).toContain(".invalid");
    }
    // apiKeyRef names an environment variable; it must not look like a key.
    expect(ROUGE1_API_PROVIDER_BASELINE.apiKeyRef).toMatch(/^[A-Z0-9_]+$/);
  });
});

describe("contract validation of the scaffold records", () => {
  it("validates the draft baseline-eval experiment", () => {
    expect(validateExperiment(ROUGE1_BASELINE_EVAL_EXPERIMENT)).toEqual([]);
    expect(ROUGE1_BASELINE_EVAL_EXPERIMENT.status).toBe("draft");
  });

  it("validates every planned dataset entry", () => {
    expect(ROUGE1_DATASET_PLAN.length).toBeGreaterThan(0);
    for (const dataset of ROUGE1_DATASET_PLAN) {
      expect(validateDataset(dataset)).toEqual([]);
      // Planned entries are placeholders, not registry records.
      expect(dataset.id).toContain("PLANNED");
    }
  });

  it("planned datasets record decontamination against the rouge1 suites", () => {
    for (const dataset of ROUGE1_DATASET_PLAN) {
      expect(dataset.decontaminatedAgainst).toContain("rouge1-mmlu-like");
      expect(dataset.decontaminatedAgainst).toContain("rouge1-gsm8k-like");
    }
  });

  it("a future real checkpoint would validate against the checkpoint contract", () => {
    // Shape check only: this fixture describes what Stage E must register —
    // no such checkpoint exists today.
    const futureCheckpoint: Checkpoint = {
      id: "ckpt_rouge1_step0_PLANNED",
      modelId: ROUGE1_MODEL_ID,
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
      prompt: "What is 2 + 2?",
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
      prompt: "What is 2 + 2?",
      maxTokens: 16,
      temperature: 0,
    };
    expect("seed" in missingSeed).toBe(false);
  });
});
