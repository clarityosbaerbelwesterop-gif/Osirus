/**
 * AI Lab — Darus model scaffold configuration (Phase I, Darus part).
 *
 * Darus is the broad-expert model of the Rouge/Quesnir/Darus research
 * program: wide domain knowledge across many fields, and the planned
 * distillation target that narrower specialist lines can later be distilled
 * from. This module is a scaffold: everything here is either (a) a PLANNED
 * value recorded so the training and evaluation phases have a written target
 * to review, or (b) a baseline backend configuration pointing at foreign
 * models that are compared against — never relabeled as ours.
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
 * Honest registry identifier for future AI-Lab-trained Darus checkpoints
 * (e.g. "osirus/darus-1-step5000"). Nothing with this id exists yet.
 */
export const DARUS_MODEL_ID = "osirus/darus-1" as const;

/**
 * Darus's role in the model family: broad expert — wide domain knowledge
 * across many fields, and the planned distillation target for specialist
 * lines. This is a role label, not a capability claim.
 */
export const DARUS_ROLE =
  "broad expert (wide domain knowledge; planned distillation target)" as const;

/**
 * PLANNED target architecture parameters for Darus.
 *
 * Every number in this structure is a plan value, not a measurement and not a
 * commitment. The seed scaffold is the SCP `model/` Llama-family transformer
 * stack (docs/ROUGE_RESEARCH_HANDOFF.md, asset table); the concrete shape is
 * fixed at the Stage D scale-decision point, after Stage B smoke results.
 *
 * MoE option (comment-only, per scaffold rules): a mixture-of-experts
 * variant — sparse expert layers with a small active-parameter budget, in
 * the style documented for DeepSeek-Coder-V2 (arXiv:2406.11931) — is a
 * candidate for Darus because a broad expert benefits from high total
 * capacity at bounded serving cost. It is deliberately NOT encoded as a
 * config value: the dense-vs-MoE decision is made at Stage D with Stage B/C
 * evidence, a written proposal, and owner sign-off. Until then the PLANNED
 * baseline below is a dense decoder.
 */
export interface DarusPlannedArchitecture {
  /** Always "planned" — nothing here has been built or measured. */
  readonly status: "planned";
  /** Transformer family of the seed scaffold (SCP `model/` stack). */
  readonly family: "llama-like-decoder-transformer";
  /** PLANNED scale class for the first real run; decided at Stage D. */
  readonly targetParameterClass: string;
  /** PLANNED decoder layer count (dense baseline; MoE is a Stage D option). */
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

export const DARUS_PLANNED_ARCHITECTURE: DarusPlannedArchitecture = {
  status: "planned",
  family: "llama-like-decoder-transformer",
  targetParameterClass:
    "3B-class dense (PLANNED — fixed at Stage D after Stage B smoke; MoE variant is a documented option, see interface comment)",
  layers: 32,
  hiddenSize: 2560,
  attentionHeads: 32,
  vocabSize: 32_000,
  contextWindowTokens: 16_384,
};

/**
 * Baseline: a third-party API provider serving a broad-knowledge model.
 *
 * Placeholder configuration only: the endpoint is unroutable (".invalid") and
 * `apiKeyRef` names an environment variable, never a key. The concrete
 * provider/model is selected at Phase I execution time and re-measured on the
 * Osirus eval spine before any number is reported (reuse doc § 5).
 * Foreign weights/API: `selfTrained` is `false`, always.
 */
export const DARUS_API_PROVIDER_BASELINE: ApiProviderConfig = {
  kind: "api_provider",
  modelId: "example-provider/broad-knowledge-model (PLACEHOLDER)",
  selfTrained: false,
  endpointUrl: "https://api.example.invalid/v1",
  apiKeyRef: "DARUS_BASELINE_API_KEY",
};

/**
 * Baseline: open weights served on remote/self-hosted infrastructure.
 *
 * Same placeholder rules as the API-provider baseline. The candidate
 * landscape (reuse doc § 5) is re-surveyed at Phase I time; whatever is
 * chosen keeps its honest upstream `modelId` and `selfTrained: false`.
 */
export const DARUS_REMOTE_INFERENCE_BASELINE: RemoteInferenceConfig = {
  kind: "remote_inference",
  modelId: "example-org/open-weights-broad-knowledge-model (PLACEHOLDER)",
  selfTrained: false,
  endpointUrl: "https://inference.example.invalid/v1",
};

/**
 * License review record for one foreign baseline.
 *
 * Foreign model weights/APIs carry their own license terms (e.g. Apache-2.0
 * for Qwen2.5-Coder, the DeepSeek custom license for DeepSeek weights —
 * reuse doc §§ 1, 5). No baseline is run, and no teacher output is used as
 * training data, before its license terms are verified and recorded here.
 */
export interface DarusBaselineLicenseRecord {
  /** Matches the honest `modelId` of the baseline config. */
  readonly modelId: string;
  /** License identifier or a "pending:" marker; evidence retained at review. */
  readonly license: string;
  /** Review state — nothing is "verified" in a scaffold. */
  readonly reviewStatus: "pending";
}

/**
 * License review slots for the configured baselines. All pending: license
 * terms are verified at Phase I execution time, before any run and before
 * any teacher output is considered as distillation data (see TRAINING.md).
 */
export const DARUS_BASELINE_LICENSES: readonly DarusBaselineLicenseRecord[] = [
  {
    modelId: DARUS_API_PROVIDER_BASELINE.modelId,
    license: "pending: provider terms verified before any run (Phase I)",
    reviewStatus: "pending",
  },
  {
    modelId: DARUS_REMOTE_INFERENCE_BASELINE.modelId,
    license:
      "pending: upstream weight license verified before any run (Phase I)",
    reviewStatus: "pending",
  },
];

/**
 * The backends the Darus scaffold can actually program against today:
 * foreign baselines only. No `native_checkpoint` entry may appear here before
 * a real, AI-Lab-trained checkpoint exists.
 */
export const DARUS_ACTIVE_BACKENDS: readonly BackendConfig[] = [
  DARUS_API_PROVIDER_BASELINE,
  DARUS_REMOTE_INFERENCE_BASELINE,
];

/**
 * Reserved slot for a future AI-Lab-trained Darus checkpoint.
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
export const DARUS_NATIVE_CHECKPOINT_SLOT: NativeCheckpointConfig | null = null;

/**
 * PLANNED dataset entries for the Darus data recipe (see TRAINING.md).
 *
 * These are planning placeholders, NOT registry entries: no source has been
 * selected, licensed, or ingested. Phase J replaces each `planned:`/`pending:`
 * marker with real provenance, license evidence, dedup method id, and the
 * decontamination record before any byte is ingested. The DeepSeek 2T-token
 * corpus was never released and must never appear here (reuse doc § 2).
 *
 * The distillation entry records the honesty rule up front: teacher outputs
 * used as training data are a data source with provenance duties — teacher
 * model id, teacher license terms, and generation config are recorded, and
 * the teacher's license must permit this use (see TRAINING.md § 2).
 */
export const DARUS_DATASET_PLAN: readonly Dataset[] = [
  {
    id: "ds_darus1_broad_knowledge_corpus_PLANNED",
    source:
      "planned: license-clean broad domain-knowledge corpora (Phase J selection)",
    license: "pending: license evidence recorded before ingestion (Phase J)",
    provenanceUri: "planned: resolvable provenance URI recorded at ingest",
    dedupMethod: "planned: minhash-lsh near-duplicate filtering",
    decontaminatedAgainst: [
      "darus-mmlu-like",
      "darus-arc-like",
      "darus-domain-suites",
    ],
    createdAt: "2026-10-02T00:00:00.000Z",
  },
  {
    id: "ds_darus1_domain_reference_corpus_PLANNED",
    source:
      "planned: license-clean encyclopedic/reference and technical-documentation corpora (Phase J selection)",
    license: "pending: license evidence recorded before ingestion (Phase J)",
    provenanceUri: "planned: resolvable provenance URI recorded at ingest",
    dedupMethod: "planned: minhash-lsh near-duplicate filtering",
    decontaminatedAgainst: [
      "darus-mmlu-like",
      "darus-arc-like",
      "darus-domain-suites",
    ],
    createdAt: "2026-10-02T00:00:00.000Z",
  },
  {
    id: "ds_darus1_distillation_teacher_outputs_PLANNED",
    source:
      "planned: teacher-model outputs, only if teacher license permits training use; teacher modelId + generation config recorded as provenance (Stage F option)",
    license:
      "pending: teacher license must explicitly permit distillation/training use; evidence recorded before generation",
    provenanceUri:
      "planned: teacher model id + generation config recorded at generation time",
    dedupMethod: "planned: minhash-lsh near-duplicate filtering",
    decontaminatedAgainst: [
      "darus-mmlu-like",
      "darus-arc-like",
      "darus-domain-suites",
    ],
    createdAt: "2026-10-02T00:00:00.000Z",
  },
];

/**
 * Draft experiment record: re-measure the foreign baselines on the Osirus
 * eval spine so Darus gets honest reference scores.
 *
 * Status is "draft" — it must not move to "running" before the eval suites in
 * EVALUATION.md exist and the owner authorizes the (API-cost-bearing) runs.
 * `configHash` is recorded at run time over the resolved backend configs,
 * seeds, and code revision.
 */
export const DARUS_BASELINE_EVAL_EXPERIMENT: Experiment = {
  id: "exp_darus1_baseline_eval_PLANNED",
  hypothesis:
    "Re-measured on the Osirus eval spine, the configured broad-knowledge baselines establish the reference pass@1 scores that any future Darus checkpoint must beat; third-party-reported numbers are not evidence.",
  configHash: "planned: sha256 over resolved configs recorded at run time",
  datasetIds: [],
  baselineIds: [
    DARUS_API_PROVIDER_BASELINE.modelId,
    DARUS_REMOTE_INFERENCE_BASELINE.modelId,
  ],
  status: "draft",
};

/**
 * Draft experiment record for the later distillation evaluation (Stage F
 * option, honest as a plan only): compare a distilled Darus student against
 * its teacher on identical tasks and seeds.
 *
 * Nothing here asserts that distillation will happen, which teacher would be
 * used, or what the outcome would be. Preconditions recorded in the
 * hypothesis itself: teacher license permits distillation use, teacher
 * outputs carry full provenance, and both sides are graded by the
 * verification engine on the same suites.
 */
export const DARUS_DISTILLATION_EVAL_EXPERIMENT: Experiment = {
  id: "exp_darus1_distillation_eval_PLANNED",
  hypothesis:
    "If distillation is authorized at Stage F, a Darus student distilled from a license-cleared teacher is compared against that teacher on identical eval suites, tasks, and seeds (pass@1, model/seed/config recorded); the goal is measured parity-per-parameter evidence, not an assumed win.",
  configHash: "planned: sha256 over resolved configs recorded at run time",
  datasetIds: [],
  baselineIds: [],
  status: "draft",
};
