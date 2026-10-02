/**
 * AI Lab — Quesnir model configuration (Phase I scaffold, branch quesnir/scaffold).
 *
 * Quesnir is the coding + security specialist model of the Osirus research
 * program. Status: **scaffold, untrained** — TRAINING_READY=FALSE, no weights
 * exist, no training run has happened or is authorized.
 *
 * This file contains configuration data and a pure validation function only.
 * No runtime code, no network or GPU calls, no secrets (apiKeyRef is an
 * environment-variable NAME, never a value), no imports from `src/`, no
 * external dependencies — the ai-lab tree stays severable.
 *
 * Honesty invariants (docs/AI_LAB_DEEPSEEK_REUSE.md §§ 5–6):
 * - Foreign weights (Qwen, DeepSeek, …) appear as baselines only, with their
 *   honest upstream `modelId`, their upstream `license`, and
 *   `selfTrained: false`. They are never relabeled as self-trained Quesnir
 *   models.
 * - All architecture numbers below are PLANNED values (starting hypothesis),
 *   not measured properties of an existing artifact.
 */

import { isNonEmptyString, isRecord } from "../../contracts/common";
import type { BackendKind } from "../../contracts/model-backend";

/** Fill-in-the-middle formats per the DeepSeek-Coder methodology (reuse doc § 3). */
export type FimFormat = "PSM" | "SPM";

/**
 * Fill-in-the-middle (FIM) training-objective configuration.
 *
 * FIM lets the model infill code spans given a prefix and a suffix, which is
 * the objective behind IDE-style code completion. Recorded in the config per
 * reuse doc § 3 ("FIM objective (PSM/SPM modes) → Phase I config"). Requires
 * tokenizer-level support in the SCP BPE stack before any training run.
 */
export interface FimConfig {
  /** Whether the FIM objective is part of the training recipe. */
  readonly enabled: boolean;
  /** Token layout: "PSM" (prefix-suffix-middle) or "SPM" (suffix-prefix-middle). */
  readonly format: FimFormat;
  /**
   * Planned fraction of training samples converted to FIM layout, in (0, 1].
   * Starting hypothesis, to be validated by ablation — not a measured value.
   */
  readonly rate: number;
}

/**
 * PLANNED architecture values for the Quesnir native model. Every field here
 * is a design target, not a property of an existing checkpoint. The seed
 * scaffold is the SCP `model/` stack (Llama-family transformer, BPE
 * tokenizer, bf16 trainer with checkpoint + resume — verified real in
 * docs/ROUGE_RESEARCH_HANDOFF.md).
 */
export interface PlannedArchitecture {
  /** Model family the seed scaffold implements. */
  readonly family: "llama-family-transformer";
  /** Seed training stack (see docs/ROUGE_RESEARCH_HANDOFF.md, asset table). */
  readonly seedStack: "scp-model-stack";
  /** Tokenizer line; FIM special tokens must be added before training. */
  readonly tokenizer: "scp-bpe";
  /** Planned context window in tokens (DeepSeek-Coder v1 used 16K). */
  readonly contextWindowTokens: number;
  /** Initial scale target for the Stage B smoke path; scaling is gated. */
  readonly initialScaleTarget: "1B";
  /** Free-text note making the planned/untrained status explicit. */
  readonly statusNote: string;
}

/** Upstream licenses of the § 5 baseline landscape. */
export type BaselineLicense = "apache-2.0" | "deepseek-custom";

/** Backend kinds usable for baselines — everything except our own checkpoints. */
export type BaselineBackendKind = Exclude<BackendKind, "native_checkpoint">;

/**
 * A foreign-weights baseline entry (reuse doc § 5 landscape). Baselines exist
 * to be re-measured on our own eval spine; third-party-reported numbers are
 * never trusted (see EVALUATION.md, honesty policy).
 */
export interface BaselineSpec {
  readonly kind: BaselineBackendKind;
  /** Honest upstream identifier, e.g. "Qwen/Qwen2.5-Coder-7B-Instruct". */
  readonly modelId: string;
  /** Always false: foreign weights are never self-trained. */
  readonly selfTrained: false;
  /** Upstream license of the weights; verified again at integration time. */
  readonly license: BaselineLicense;
  /** Serving endpoint template; no live calls are made from this scaffold. */
  readonly endpointUrl: string;
  /**
   * Environment-variable NAME holding the API key for `api_provider`
   * baselines. Never the key itself.
   */
  readonly apiKeyRef?: string;
  /** Why this baseline is in the fallback set. */
  readonly role: string;
}

/**
 * Reserved slot for the future Quesnir native checkpoint. No artifact exists,
 * so `selfTrained` stays `false` and `status` stays "reserved"; the slot is
 * replaced by a real `NativeCheckpointConfig` (contracts/model-backend.ts)
 * only after a measured training run produces a registered checkpoint.
 */
export interface NativeCheckpointSlot {
  readonly kind: "native_checkpoint";
  /** Planned honest identifier for our own future checkpoint series. */
  readonly plannedModelId: string;
  readonly status: "reserved";
  /** False until an AI-Lab-trained checkpoint actually exists. */
  readonly selfTrained: false;
  readonly note: string;
}

/** Root configuration object for the Quesnir model line. */
export interface QuesnirModelConfig {
  readonly modelId: string;
  readonly role: "coding+security";
  readonly status: "scaffold-untrained";
  /** Hard gate: must stay false until the Phase L gate passes (see TRAINING.md). */
  readonly trainingReady: false;
  readonly architecture: PlannedArchitecture;
  readonly fim: FimConfig;
  readonly baselines: readonly BaselineSpec[];
  readonly nativeCheckpoint: NativeCheckpointSlot;
}

/**
 * The Quesnir Phase I scaffold configuration.
 *
 * Baselines are the § 5 landscape of docs/AI_LAB_DEEPSEEK_REUSE.md
 * (Qwen2.5-Coder-7B/32B, DeepSeek-Coder-V2-Lite, DeepSeek-Coder-V2) spread
 * across the three baseline backend kinds so every fallback path
 * (local / remote / API) is represented in config before Phase I wiring.
 */
export const QUESNIR_CONFIG: QuesnirModelConfig = {
  modelId: "osirus/quesnir",
  role: "coding+security",
  status: "scaffold-untrained",
  trainingReady: false,
  architecture: {
    family: "llama-family-transformer",
    seedStack: "scp-model-stack",
    tokenizer: "scp-bpe",
    contextWindowTokens: 16384,
    initialScaleTarget: "1B",
    statusNote:
      "PLANNED values only — no Quesnir weights exist; numbers are design " +
      "targets for the Stage B smoke path, not measured properties.",
  },
  fim: {
    enabled: true,
    format: "PSM",
    rate: 0.5,
  },
  baselines: [
    {
      kind: "local_inference",
      modelId: "Qwen/Qwen2.5-Coder-7B-Instruct",
      selfTrained: false,
      license: "apache-2.0",
      endpointUrl: "http://127.0.0.1:8000/v1",
      role: "Strong small open code model; default local baseline (reuse doc § 5).",
    },
    {
      kind: "remote_inference",
      modelId: "Qwen/Qwen2.5-Coder-32B-Instruct",
      selfTrained: false,
      license: "apache-2.0",
      endpointUrl: "http://127.0.0.1:8001/v1",
      role: "Best documented open code model; self-hosted remote baseline.",
    },
    {
      kind: "remote_inference",
      modelId: "deepseek-ai/DeepSeek-Coder-V2-Lite-Instruct",
      selfTrained: false,
      license: "deepseek-custom",
      endpointUrl: "http://127.0.0.1:8002/v1",
      role: "FIM-capable MoE baseline (16B, 2.4B active); license terms verified at integration.",
    },
    {
      kind: "api_provider",
      modelId: "deepseek-ai/DeepSeek-Coder-V2",
      selfTrained: false,
      license: "deepseek-custom",
      endpointUrl: "https://api.deepseek.com/v1",
      apiKeyRef: "DEEPSEEK_API_KEY",
      role: "Large MoE landscape check via provider API; serving cost noted in reuse doc § 5.",
    },
  ],
  nativeCheckpoint: {
    kind: "native_checkpoint",
    plannedModelId: "osirus/quesnir-1b",
    status: "reserved",
    selfTrained: false,
    note:
      "Slot only — replaced by a NativeCheckpointConfig with a registered " +
      "checkpointUri after a gated, measured training run (Phase L gate first).",
  },
};

const BASELINE_KINDS: readonly BaselineBackendKind[] = [
  "api_provider",
  "remote_inference",
  "local_inference",
];

const BASELINE_LICENSES: readonly BaselineLicense[] = [
  "apache-2.0",
  "deepseek-custom",
];

/**
 * Pure validator for Quesnir configs, following the contracts/ convention:
 * returns a `string[]` of human-readable errors; an empty array means valid.
 */
export function validateQuesnirConfig(config: unknown): string[] {
  const errors: string[] = [];
  if (!isRecord(config)) {
    return ["quesnir config must be an object"];
  }

  if (!isNonEmptyString(config.modelId)) {
    errors.push("modelId must be a non-empty string");
  }
  if (config.role !== "coding+security") {
    errors.push('role must be "coding+security"');
  }
  if (config.status !== "scaffold-untrained") {
    errors.push('status must be "scaffold-untrained" for the Phase I scaffold');
  }
  if (config.trainingReady !== false) {
    errors.push("trainingReady must be false (TRAINING_READY=FALSE gate)");
  }

  // Architecture block (planned values).
  if (!isRecord(config.architecture)) {
    errors.push("architecture must be an object");
  } else {
    const arch = config.architecture;
    const cw = arch.contextWindowTokens;
    if (
      typeof cw !== "number" ||
      !Number.isInteger(cw) ||
      cw <= 0 ||
      !Number.isFinite(cw)
    ) {
      errors.push(
        "architecture.contextWindowTokens must be a positive integer",
      );
    }
  }

  // FIM objective config.
  if (!isRecord(config.fim)) {
    errors.push("fim must be an object");
  } else {
    if (typeof config.fim.enabled !== "boolean") {
      errors.push("fim.enabled must be a boolean");
    }
    if (config.fim.format !== "PSM" && config.fim.format !== "SPM") {
      errors.push('fim.format must be "PSM" or "SPM"');
    }
    const rate = config.fim.rate;
    if (typeof rate !== "number" || !(rate > 0) || rate > 1) {
      errors.push("fim.rate must be a number in (0, 1]");
    }
  }

  // Baselines: foreign weights, selfTrained structurally false, license set.
  if (!Array.isArray(config.baselines) || config.baselines.length === 0) {
    errors.push("baselines must be a non-empty array");
  } else {
    config.baselines.forEach((baseline, index) => {
      const label = `baselines[${index}]`;
      if (!isRecord(baseline)) {
        errors.push(`${label} must be an object`);
        return;
      }
      if (!BASELINE_KINDS.includes(baseline.kind as BaselineBackendKind)) {
        errors.push(
          `${label}.kind must be one of: ${BASELINE_KINDS.join(", ")}`,
        );
      }
      if (!isNonEmptyString(baseline.modelId)) {
        errors.push(`${label}.modelId must be a non-empty string`);
      }
      if (baseline.selfTrained !== false) {
        errors.push(
          `${label}.selfTrained must be false — foreign weights are never self-trained`,
        );
      }
      if (!BASELINE_LICENSES.includes(baseline.license as BaselineLicense)) {
        errors.push(
          `${label}.license must be one of: ${BASELINE_LICENSES.join(", ")}`,
        );
      }
      if (!isNonEmptyString(baseline.endpointUrl)) {
        errors.push(`${label}.endpointUrl must be a non-empty string`);
      }
    });
  }

  // Reserved native-checkpoint slot: no artifact, selfTrained stays false.
  if (!isRecord(config.nativeCheckpoint)) {
    errors.push("nativeCheckpoint must be an object");
  } else {
    const slot = config.nativeCheckpoint;
    if (slot.kind !== "native_checkpoint") {
      errors.push('nativeCheckpoint.kind must be "native_checkpoint"');
    }
    if (slot.status !== "reserved") {
      errors.push(
        'nativeCheckpoint.status must be "reserved" until a real checkpoint exists',
      );
    }
    if (slot.selfTrained !== false) {
      errors.push(
        "nativeCheckpoint.selfTrained must be false while no AI-Lab-trained checkpoint exists",
      );
    }
    if (!isNonEmptyString(slot.plannedModelId)) {
      errors.push("nativeCheckpoint.plannedModelId must be a non-empty string");
    }
  }

  return errors;
}
