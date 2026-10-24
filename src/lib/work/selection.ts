import {
  isPlaceholderModelId,
  RECOMMENDATION_TABLE,
  type DifficultyClass,
} from "@/config/recommendations";
import {
  catalogModel,
  isCatalogModelId,
  isRetiredProductModel,
} from "@/lib/models/catalog";
import { EXECUTION_SUBAGENT_CAP } from "./limits";
import {
  estimateSelectionCost,
  type CostEstimate,
  type WorkRecommendation,
} from "./recommend";

export type WorkSelection = {
  difficulty: DifficultyClass;
  executorModelId: string;
  reviewerModelId: string;
  subAgentCount: number;
  executorSource: "recommended" | "chosen";
  reviewerSource: "recommended" | "chosen";
  subAgentSource: "recommended" | "chosen";
  executorPlaceholder: boolean;
  reviewerPlaceholder: boolean;
  cost: CostEstimate;
};

export type SelectionResult =
  | { ok: true; selection: WorkSelection }
  | { ok: false; error: string; message: string };

/**
 * allowedModelIds null means the key list could not be checked.
 * A real catalog id is then refused. The placeholder recommendation
 * may still be shown, and execution stays unavailable.
 */
export function applyWorkSelection(input: {
  recommendation: WorkRecommendation;
  executorModelId?: string;
  reviewerModelId?: string;
  subAgentCount?: number;
  allowedModelIds: readonly string[] | null;
}): SelectionResult {
  const slot = RECOMMENDATION_TABLE[input.recommendation.difficulty];
  const executorModelId =
    input.executorModelId?.trim() || input.recommendation.executor.modelId;
  const reviewerModelId =
    input.reviewerModelId?.trim() || input.recommendation.reviewer.modelId;
  const subAgentCount =
    input.subAgentCount === undefined
      ? input.recommendation.subAgents.count
      : input.subAgentCount;

  if (executorModelId === reviewerModelId) {
    return {
      ok: false,
      error: "reviewer_same_as_executor",
      message:
        "Das Prüfermodell muss ein anderes Modell sein als das ausführende Modell.",
    };
  }

  const checked = checkModel(executorModelId, {
    role: "Ausführendes Modell",
    recommendedId: input.recommendation.executor.modelId,
    allowed: input.allowedModelIds,
  });
  if (!checked.ok) return checked;
  const reviewer = checkModel(reviewerModelId, {
    role: "Prüfermodell",
    recommendedId: input.recommendation.reviewer.modelId,
    allowed: input.allowedModelIds,
  });
  if (!reviewer.ok) return reviewer;

  if (!Number.isInteger(subAgentCount)) {
    return {
      ok: false,
      error: "invalid_subagent_count",
      message: "Die Anzahl der Subagents muss eine ganze Zahl sein.",
    };
  }
  if (
    subAgentCount < slot.subAgents.min ||
    subAgentCount > slot.subAgents.max
  ) {
    return {
      ok: false,
      error: "subagent_count_out_of_range",
      message: `Für Klasse ${input.recommendation.difficulty} sind ${slot.subAgents.min} bis ${slot.subAgents.max} Subagents vorgesehen.`,
    };
  }

  return {
    ok: true,
    selection: {
      difficulty: input.recommendation.difficulty,
      executorModelId,
      reviewerModelId,
      subAgentCount,
      executorSource:
        executorModelId === input.recommendation.executor.modelId
          ? "recommended"
          : "chosen",
      reviewerSource:
        reviewerModelId === input.recommendation.reviewer.modelId
          ? "recommended"
          : "chosen",
      subAgentSource:
        subAgentCount === input.recommendation.subAgents.count
          ? "recommended"
          : "chosen",
      executorPlaceholder: isPlaceholderModelId(executorModelId),
      reviewerPlaceholder: isPlaceholderModelId(reviewerModelId),
      cost: estimateSelectionCost({
        executorId: executorModelId,
        reviewerId: reviewerModelId,
        subAgents: subAgentCount,
      }),
    },
  };
}

function checkModel(
  modelId: string,
  input: {
    role: string;
    recommendedId: string;
    allowed: readonly string[] | null;
  },
): { ok: true } | { ok: false; error: string; message: string } {
  if (isRetiredProductModel(modelId)) {
    return {
      ok: false,
      error: "retired_model",
      message: `${input.role}: dieses Modell wird nicht angeboten.`,
    };
  }
  if (isPlaceholderModelId(modelId)) {
    if (modelId !== input.recommendedId) {
      return {
        ok: false,
        error: "unknown_placeholder",
        message: `${input.role}: unbekannter Platzhalter.`,
      };
    }
    return { ok: true };
  }
  if (!isCatalogModelId(modelId) || !catalogModel(modelId)?.online) {
    return {
      ok: false,
      error: "unknown_model",
      message: `${input.role}: die ID steht nicht im UNOROUTER-Katalog.`,
    };
  }
  if (input.allowed === null) {
    return {
      ok: false,
      error: "key_models_unknown",
      message:
        "Bald verfügbar. Welche Katalogmodelle der Key nutzen darf, ist noch nicht geprüft.",
    };
  }
  if (!input.allowed.includes(modelId)) {
    return {
      ok: false,
      error: "model_not_on_key",
      message: `${input.role}: der Key führt dieses Modell nicht.`,
    };
  }
  return { ok: true };
}

export function executionBlocker(selection: WorkSelection): string | null {
  if (selection.executorPlaceholder || selection.reviewerPlaceholder) {
    return "Bald verfügbar. Die Empfehlungstabelle hat noch Platzhalter statt Katalog-IDs, die der Key nutzen darf.";
  }
  if (selection.subAgentCount > EXECUTION_SUBAGENT_CAP) {
    return `Bald verfügbar. Mehr als ${EXECUTION_SUBAGENT_CAP} Subagents in einem Lauf sind noch nicht gebaut. Es wurde nichts gestartet.`;
  }
  return null;
}
