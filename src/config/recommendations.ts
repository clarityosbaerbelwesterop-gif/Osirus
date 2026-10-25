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
 * Models the product UI may name. Every id is in the public UNOROUTER
 * catalog snapshot. This list is not a claim that the deployment key can
 * call them. AI Trainer and Kai replace the default and the list once the
 * key list is known. The recommendation table above stays on placeholders.
 */
export const PRODUCT_MODEL_ALLOWLIST = [
  "glm-5.3-flash",
  "gpt-6.1-sol",
  "gpt-6-astra",
  "claude-opus-5.5",
] as const;

export type ProductModelId = (typeof PRODUCT_MODEL_ALLOWLIST)[number];

export const DEFAULT_PRODUCT_MODEL_ID: ProductModelId = "glm-5.3-flash";
