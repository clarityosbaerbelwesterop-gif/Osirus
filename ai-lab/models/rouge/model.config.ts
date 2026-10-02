/**
 * AI Lab — Rouge 1 model scaffold configuration (Phase I, Rouge 1 part).
 *
 * Rouge 1 is the general/reasoning model of the Rouge program. This module is
 * a scaffold: everything here is either (a) a PLANNED value recorded so the
 * training and evaluation phases have a written target to review, or (b) a
 * baseline backend configuration pointing at foreign models that are compared
 * against — never relabeled as ours.
 *
 * Hard rules honored by this file (docs/ROUGE_RESEARCH_HANDOFF.md,
 * docs/AI_LAB_DEEPSEEK_REUSE.md):
 * - TRAINING_READY=FALSE: no training, no GPU spend, no capability claims.
 * - No secrets: endpoint URLs are unroutable placeholders (".invalid" TLD)
 *   and API keys are referenced by environment-variable name only.
 * - `selfTrained` is `false` for every foreign baseline; it may only become
 *   `true` on a `native_checkpoint` config after a checkpoint was actually
 *   trained by the AI Lab under owner authorization.
 * - No chain-of-thought is stored anywhere; eval artifacts record final
 *   answers plus the model/seed/config triple only.
 *
 * No imports from `src/`, no external dependencies — the ai-lab tree stays
 * severable (ai-lab/ARCHITECTURE.md § 0).
 */

import type { Dataset } from "../../contracts/dataset";
import type { Experiment } from "../../contracts/experiment";
import type {
  ApiProviderConfig,
  BackendConfig,
  NativeCheckpointConfig,
  RemoteInferenceConfig,
} from "../../contracts/model-backend";

/**
 * Honest registry identifier for future AI-Lab-trained Rouge 1 checkpoints
 * (e.g. "osirus/rouge-1-step5000"). Nothing with this id exists yet.
 */
export const ROUGE1_MODEL_ID = "osirus/rouge-1" as const;

/** Rouge 1's role in the model family: general-purpose reasoning. */
export const ROUGE1_ROLE = "general/reasoning" as const;

/**
 * PLANNED target architecture parameters for Rouge 1.
 *
 * Every number in this structure is a plan value, not a measurement and not a
 * commitment. The seed scaffold is the SCP `model/` Llama-family transformer
 * stack (docs/ROUGE_RESEARCH_HANDOFF.md, asset table); the concrete shape is
 * fixed at the Stage D scale-decision point, after Stage B smoke results.
 */
export interface Rouge1PlannedArchitecture {
  /** Always "planned" — nothing here has been built or measured. */
  readonly status: "planned";
  /** Transformer family of the seed scaffold (SCP `model/` stack). */
  readonly family: "llama-like-decoder-transformer";
  /** PLANNED scale class for the first real run; decided at Stage D. */
  readonly targetParameterClass: string;
  /** PLANNED decoder layer count. */
  readonly layers: number;
  /** PLANNED hidden size. */
  readonly hiddenSize: number;
  /** PLANNED attention head count. */
  readonly attentionHeads: number;
  /** PLANNED BPE vocabulary size (SCP BPE tokenizer). */
  readonly vocabSize: number;
  /** PLANNED native context window in tokens. */
  readonly contextWindowTokens: number;
}

export const ROUGE1_PLANNED_ARCHITECTURE: Rouge1PlannedArchitecture = {
  status: "planned",
  family: "llama-like-decoder-transformer",
  targetParameterClass:
    "1B-class (PLANNED — fixed at Stage D after Stage B smoke)",
  layers: 24,
  hiddenSize: 2048,
  attentionHeads: 16,
  vocabSize: 32_000,
  contextWindowTokens: 16_384,
};

/**
 * Baseline: a third-party API provider serving a general/reasoning model.
 *
 * Placeholder configuration only: the endpoint is unroutable (".invalid") and
 * `apiKeyRef` names an environment variable, never a key. The concrete
 * provider/model is selected at Phase I execution time and re-measured on the
 * Osirus eval spine before any number is reported (reuse doc § 5).
 * Foreign weights/API: `selfTrained` is `false`, always.
 */
export const ROUGE1_API_PROVIDER_BASELINE: ApiProviderConfig = {
  kind: "api_provider",
  modelId: "example-provider/general-reasoning-model (PLACEHOLDER)",
  selfTrained: false,
  endpointUrl: "https://api.example.invalid/v1",
  apiKeyRef: "ROUGE1_BASELINE_API_KEY",
};

/**
 * Baseline: open weights served on remote/self-hosted infrastructure.
 *
 * Same placeholder rules as the API-provider baseline. The candidate landscape
 * (reuse doc § 5) is re-surveyed at Phase I time; whatever is chosen keeps its
 * honest upstream `modelId` and `selfTrained: false`.
 */
export const ROUGE1_REMOTE_INFERENCE_BASELINE: RemoteInferenceConfig = {
  kind: "remote_inference",
  modelId: "example-org/open-weights-general-reasoning-model (PLACEHOLDER)",
  selfTrained: false,
  endpointUrl: "https://inference.example.invalid/v1",
};

/**
 * The backends the Rouge 1 scaffold can actually program against today:
 * foreign baselines only. No `native_checkpoint` entry may appear here before
 * a real, AI-Lab-trained checkpoint exists.
 */
export const ROUGE1_ACTIVE_BACKENDS: readonly BackendConfig[] = [
  ROUGE1_API_PROVIDER_BASELINE,
  ROUGE1_REMOTE_INFERENCE_BASELINE,
];

/**
 * Reserved slot for a future AI-Lab-trained Rouge 1 checkpoint.
 *
 * This stays `null` — deliberately not a `NativeCheckpointConfig` — until ALL
 * of the following hold:
 * 1. TRAINING_READY=TRUE (Phase L 18-checkbox gate) and explicit owner
 *    authorization (handoff gate 2);
 * 2. a checkpoint was actually trained and registered via
 *    `contracts/checkpoint.ts` with measured `metricsRef`;
 * 3. only then may a config with `selfTrained: true` be constructed here.
 *
 * Until then, any `selfTrained: true` value would be a fabricated capability
 * claim (handoff gate 3).
 */
export const ROUGE1_NATIVE_CHECKPOINT_SLOT: NativeCheckpointConfig | null =
  null;

/**
 * PLANNED dataset entries for the Rouge 1 data recipe (see TRAINING.md).
 *
 * These are planning placeholders, NOT registry entries: no source has been
 * selected, licensed, or ingested. Phase J replaces each `planned:`/`pending:`
 * marker with real provenance, license evidence, dedup method id, and the
 * decontamination record before any byte is ingested. The DeepSeek 2T-token
 * corpus was never released and must never appear here (reuse doc § 2).
 */
export const ROUGE1_DATASET_PLAN: readonly Dataset[] = [
  {
    id: "ds_rouge1_general_corpus_PLANNED",
    source: "planned: license-clean general text corpus (Phase J selection)",
    license: "pending: license evidence recorded before ingestion (Phase J)",
    provenanceUri: "planned: resolvable provenance URI recorded at ingest",
    dedupMethod: "planned: minhash-lsh near-duplicate filtering",
    decontaminatedAgainst: ["rouge1-mmlu-like", "rouge1-gsm8k-like"],
    createdAt: "2026-10-02T00:00:00.000Z",
  },
  {
    id: "ds_rouge1_reasoning_traces_PLANNED",
    source: "planned: license-clean reasoning-trace corpus (Phase J selection)",
    license: "pending: license evidence recorded before ingestion (Phase J)",
    provenanceUri: "planned: resolvable provenance URI recorded at ingest",
    dedupMethod: "planned: minhash-lsh near-duplicate filtering",
    decontaminatedAgainst: ["rouge1-mmlu-like", "rouge1-gsm8k-like"],
    createdAt: "2026-10-02T00:00:00.000Z",
  },
];

/**
 * Draft experiment record: re-measure the foreign baselines on the Osirus
 * eval spine so Rouge 1 gets honest reference scores.
 *
 * Status is "draft" — it must not move to "running" before the eval suites in
 * EVALUATION.md exist and the owner authorizes the (API-cost-bearing) runs.
 * `configHash` is recorded at run time over the resolved backend configs,
 * seeds, and code revision.
 */
export const ROUGE1_BASELINE_EVAL_EXPERIMENT: Experiment = {
  id: "exp_rouge1_baseline_eval_PLANNED",
  hypothesis:
    "Re-measured on the Osirus eval spine, the configured general/reasoning baselines establish the reference pass@1 scores that any future Rouge 1 checkpoint must beat; third-party-reported numbers are not evidence.",
  configHash: "planned: sha256 over resolved configs recorded at run time",
  datasetIds: [],
  baselineIds: [
    ROUGE1_API_PROVIDER_BASELINE.modelId,
    ROUGE1_REMOTE_INFERENCE_BASELINE.modelId,
  ],
  status: "draft",
};
