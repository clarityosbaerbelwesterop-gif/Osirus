/**
 * Empfehlungstabelle für Osirus Work.
 *
 * PLACEHOLDER — AI Trainer und Kai ersetzen die Modell-IDs.
 * Die IDs beginnen absichtlich mit PLACEHOLDER_ und sind keine
 * UNOROUTER-Katalog-IDs. Solange das so ist, darf keine Ausführung
 * sie als echtes Modell behandeln.
 *
 * Die Subagent-Spannen folgen der Produktspezifikation §3.2 (Entwurf,
 * 24.10.2026). Die empfohlenen Zahlen darin sind ebenfalls Platzhalter,
 * bis AI Trainer und Kai sie festlegen.
 *
 * Nicht hier: Abo-Obergrenzen. Die baut Tung. Nicht hier: Preise.
 */

export const DIFFICULTY_CLASSES = ["S", "M", "L", "XL"] as const;

export type DifficultyClass = (typeof DIFFICULTY_CLASSES)[number];

export const PLACEHOLDER_MODEL_PREFIX = "PLACEHOLDER_";

export type RecommendationSlot = {
  /** Platzhalter oder später eine Katalog-ID, die der Key nutzen darf. */
  executorModelId: string;
  /** Muss sich von executorModelId unterscheiden. */
  reviewerModelId: string;
  subAgents: {
    recommended: number;
    min: number;
    max: number;
  };
};

export const RECOMMENDATION_TABLE: Record<DifficultyClass, RecommendationSlot> =
  {
    S: {
      executorModelId: "PLACEHOLDER_EXECUTOR_S",
      reviewerModelId: "PLACEHOLDER_REVIEWER_S",
      subAgents: { recommended: 0, min: 0, max: 2 },
    },
    M: {
      executorModelId: "PLACEHOLDER_EXECUTOR_M",
      reviewerModelId: "PLACEHOLDER_REVIEWER_M",
      subAgents: { recommended: 2, min: 2, max: 5 },
    },
    L: {
      executorModelId: "PLACEHOLDER_EXECUTOR_L",
      reviewerModelId: "PLACEHOLDER_REVIEWER_L",
      subAgents: { recommended: 5, min: 5, max: 15 },
    },
    XL: {
      executorModelId: "PLACEHOLDER_EXECUTOR_XL",
      reviewerModelId: "PLACEHOLDER_REVIEWER_XL",
      subAgents: { recommended: 15, min: 15, max: 50 },
    },
  };

export function isPlaceholderModelId(id: string) {
  return id.startsWith(PLACEHOLDER_MODEL_PREFIX);
}

/**
 * Curated Top NVIDIA NIM models exposed in user-facing model selectors
 * when NVIDIA_API_KEY is configured (independent of UNOROUTER_API_KEY).
 */
export const NVIDIA_TOP_MODELS = [
  "nvidia/llama-3.1-nemotron-ultra-253b-v1",
  "deepseek-ai/deepseek-r1",
  "meta/llama-3.3-70b-instruct",
  "qwen/qwen2.5-coder-32b-instruct",
  "mistralai/mistral-large-2-instruct",
  "google/gemma-2-27b-it",
] as const;

export type NvidiaTopModelId = (typeof NVIDIA_TOP_MODELS)[number];

/** Dedicated default models for Rouge Agent & internal verification roles. */
export const ROUGE_AGENT_DEFAULT_MODEL: NvidiaTopModelId =
  "nvidia/llama-3.1-nemotron-ultra-253b-v1";
export const ROUGE_AGENT_REVIEWER_MODEL: NvidiaTopModelId =
  "deepseek-ai/deepseek-r1";

export function isNvidiaTopModelId(id: string): id is NvidiaTopModelId {
  return (NVIDIA_TOP_MODELS as readonly string[]).includes(id);
}

/**
 * Models the product UI and runtime allowlist accept. Includes the curated
 * Top NVIDIA NIM models as well as the baseline catalog IDs.
 */
export const PRODUCT_MODEL_ALLOWLIST = [
  "glm-5.3-flash",
  "gpt-6.1-sol",
  "gpt-6-astra",
  "claude-opus-5.5",
  ...NVIDIA_TOP_MODELS,
] as const;

export type ProductModelId = (typeof PRODUCT_MODEL_ALLOWLIST)[number];

export const DEFAULT_PRODUCT_MODEL_ID: ProductModelId = "glm-5.3-flash";
