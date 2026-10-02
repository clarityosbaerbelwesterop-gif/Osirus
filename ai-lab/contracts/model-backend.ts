/**
 * AI Lab — model-layer replaceability contract.
 *
 * All training, evaluation, and experiment code in the AI Lab programs against
 * the `ModelBackend` interface, so the underlying model can be swapped between
 * our own checkpoints, locally served open weights, remote serving, and
 * third-party APIs without touching experiment logic.
 *
 * Honesty invariants (hard gates, docs/AI_LAB_DEEPSEEK_REUSE.md §§ 5–6):
 * - `modelId` is always the honest upstream identifier (e.g.
 *   "Qwen/Qwen2.5-Coder-7B-Instruct"), never a rebrand.
 * - `selfTrained` is `false` for any foreign weights (DeepSeek, Qwen, …).
 *   Foreign weights serve as baselines only and are never labeled as
 *   self-trained Rouge/Quesnir/Darus models.
 *
 * This file is self-contained by design: no imports from `src/`, no external
 * dependencies, so the ai-lab tree stays severable.
 */

/** The four backend kinds, ordered roughly from "ours" to "theirs". */
export type BackendKind =
  /** A checkpoint trained by the AI Lab (SCP `model/` stack seed). */
  | "native_checkpoint"
  /** Open weights served on local hardware (baseline role). */
  | "local_inference"
  /** Open weights served on remote/self-hosted infrastructure (baseline role). */
  | "remote_inference"
  /** Third-party API provider (baseline role, e.g. for landscape checks). */
  | "api_provider";

/**
 * A single generation request.
 *
 * `seed` is mandatory (not optional) because every eval run must record a full
 * model/seed/config triple for reproducibility — pass@1 numbers without a seed
 * are not acceptable evidence in this program.
 */
export interface GenerateRequest {
  /** The prompt text. No chat template is applied at this layer. */
  readonly prompt: string;
  /** Hard cap on generated tokens. */
  readonly maxTokens: number;
  /** Sampling temperature. Use 0 for deterministic eval decoding. */
  readonly temperature: number;
  /** Mandatory RNG seed — eval reproducibility requires it. */
  readonly seed: number;
  /** Optional stop sequences; generation halts at the first match. */
  readonly stop?: readonly string[];
}

/** Token accounting for one generation, for cost and budget tracking. */
export interface TokenUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
}

/** The result of one generation call. */
export interface GenerateResult {
  /** The generated text (final answer only — no chain-of-thought is stored). */
  readonly text: string;
  readonly usage: TokenUsage;
  /** Wall-clock latency of the call in milliseconds. */
  readonly latencyMs: number;
  /**
   * Version string of the backend implementation (e.g. "scp-trainer/0.1.0",
   * "vllm/0.6.4"). Recorded in eval artifacts so results stay attributable
   * to an exact serving stack.
   */
  readonly backendVersion: string;
}

/**
 * A replaceable model backend.
 *
 * Implementations live outside this contract (Phase I scaffold). This file
 * defines the interface only.
 */
export interface ModelBackend {
  readonly kind: BackendKind;
  /**
   * Honest model identifier — e.g. "osirus/quesnir-1b-step5000" for our own
   * checkpoints, "deepseek-ai/DeepSeek-Coder-V2-Lite" for foreign weights.
   * Never label a foreign weight as a self-trained model.
   */
  readonly modelId: string;
  /**
   * `true` only for checkpoints actually trained by the AI Lab.
   * `false` for DeepSeek/Qwen/etc. baselines (APIProvider, RemoteInference,
   * LocalInference per docs/AI_LAB_DEEPSEEK_REUSE.md § 5).
   */
  readonly selfTrained: boolean;
  generate(req: GenerateRequest): Promise<GenerateResult>;
  /**
   * Optional and only meaningful for `native_checkpoint` backends whose
   * tokenizer we control (SCP BPE). Remote/API backends generally cannot
   * expose raw tokenization; callers must tolerate `undefined`.
   */
  tokenize?(text: string): number[];
}

/** Base fields shared by all backend configurations. */
interface BackendConfigBase {
  readonly kind: BackendKind;
  /** See `ModelBackend.modelId` — honest identifiers only. */
  readonly modelId: string;
  /** See `ModelBackend.selfTrained`. */
  readonly selfTrained: boolean;
}

/** Configuration for a backend serving an AI-Lab-trained checkpoint. */
export interface NativeCheckpointConfig extends BackendConfigBase {
  readonly kind: "native_checkpoint";
  readonly selfTrained: true;
  /** URI of the checkpoint artifact (matches Checkpoint.storageUri). */
  readonly checkpointUri: string;
}

/** Configuration for open weights served locally (baseline). */
export interface LocalInferenceConfig extends BackendConfigBase {
  readonly kind: "local_inference";
  readonly selfTrained: false;
  /** Local serving endpoint, e.g. "http://127.0.0.1:8000/v1". */
  readonly endpointUrl: string;
}

/** Configuration for open weights served remotely (baseline). */
export interface RemoteInferenceConfig extends BackendConfigBase {
  readonly kind: "remote_inference";
  readonly selfTrained: false;
  readonly endpointUrl: string;
}

/** Configuration for a third-party API provider (baseline). */
export interface ApiProviderConfig extends BackendConfigBase {
  readonly kind: "api_provider";
  readonly selfTrained: false;
  readonly endpointUrl: string;
  /**
   * Reference to a secret (env var name or vault path) — never the secret
   * itself. Secrets must not appear in experiment configs or artifacts.
   */
  readonly apiKeyRef?: string;
}

/** Discriminated union of all backend configurations. */
export type BackendConfig =
  | NativeCheckpointConfig
  | LocalInferenceConfig
  | RemoteInferenceConfig
  | ApiProviderConfig;

/**
 * Factory contract for constructing backends from configuration.
 *
 * Phase I provides the implementations (e.g. `createBackend(config)`); this
 * interface fixes the shape so experiment code can depend on it today.
 * APIProvider and RemoteInference implementations exist to run the baselines
 * from docs/AI_LAB_DEEPSEEK_REUSE.md § 5 (Qwen2.5-Coder, DeepSeek-Coder-V2)
 * on our own eval spine — re-measured, never trusted from third-party reports.
 */
export interface ModelBackendFactory {
  createBackend(config: BackendConfig): Promise<ModelBackend>;
}
