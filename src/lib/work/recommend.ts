import {
  isPlaceholderModelId,
  RECOMMENDATION_TABLE,
  type DifficultyClass,
} from "@/config/recommendations";
import { catalogModel, type CatalogModel } from "@/lib/models/catalog";
import { classifyWorkPrompt } from "./classify";

export type ChoiceSource = "recommended" | "chosen";

export type ModelChoice = {
  modelId: string;
  label: string;
  placeholder: boolean;
  source: ChoiceSource;
  vendor: string | null;
};

export type CostEstimate =
  | {
      status: "unavailable";
      reason: string;
    }
  | {
      status: "estimated";
      usd: number;
      note: string;
    };

export type WorkRecommendation = {
  difficulty: DifficultyClass;
  reason: string;
  executor: ModelChoice & { recommended: true };
  reviewer: ModelChoice & { recommended: true };
  subAgents: {
    count: number;
    min: number;
    max: number;
    recommended: true;
    source: "recommended";
  };
  cost: CostEstimate;
};

const ASSUMED_EXECUTOR = { input: 2_000, output: 800 };
const ASSUMED_SUBAGENT = { input: 1_500, output: 600 };
const ASSUMED_REVIEWER = { input: 2_000, output: 400 };

function usd(model: CatalogModel, tokens: { input: number; output: number }) {
  const input = model.inputPerMillionUsd;
  const output = model.outputPerMillionUsd;
  if (input === null || output === null) return null;
  return (tokens.input / 1e6) * input + (tokens.output / 1e6) * output;
}

export function estimateSelectionCost(input: {
  executorId: string;
  reviewerId: string;
  subAgents: number;
}): CostEstimate {
  if (
    isPlaceholderModelId(input.executorId) ||
    isPlaceholderModelId(input.reviewerId)
  ) {
    return {
      status: "unavailable",
      reason:
        "Bald verfügbar. Die Empfehlungstabelle enthält noch Platzhalter, keine Katalog-IDs.",
    };
  }
  const executor = catalogModel(input.executorId);
  const reviewer = catalogModel(input.reviewerId);
  if (!executor || !reviewer) {
    return {
      status: "unavailable",
      reason: "Bald verfügbar. Für diese IDs liegt kein Katalogpreis vor.",
    };
  }
  const executorUsd = usd(executor, ASSUMED_EXECUTOR);
  const subUsd = usd(executor, ASSUMED_SUBAGENT);
  const reviewerUsd = usd(reviewer, ASSUMED_REVIEWER);
  if (executorUsd === null || subUsd === null || reviewerUsd === null) {
    return {
      status: "unavailable",
      reason: "Bald verfügbar. Der Katalogeintrag hat keinen Tokenpreis.",
    };
  }
  const total = executorUsd + subUsd * input.subAgents + reviewerUsd;
  return {
    status: "estimated",
    usd: Math.round(total * 1e6) / 1e6,
    note: `Schätzung aus dem Katalog vom 2026-10-24 mit angenommenen Tokenmengen, kein Abrechnungswert und kein Kontingent.`,
  };
}

function choice(modelId: string): ModelChoice & { recommended: true } {
  const row = catalogModel(modelId);
  const placeholder = isPlaceholderModelId(modelId);
  return {
    modelId,
    label: placeholder
      ? "Platzhalter, noch nicht festgelegt"
      : (row?.id ?? modelId),
    placeholder,
    source: "recommended",
    recommended: true,
    vendor: row?.vendor ?? null,
  };
}

export function recommendWork(prompt: string): WorkRecommendation {
  const classified = classifyWorkPrompt(prompt);
  const slot = RECOMMENDATION_TABLE[classified.difficulty];
  return {
    difficulty: classified.difficulty,
    reason: classified.reason,
    executor: choice(slot.executorModelId),
    reviewer: choice(slot.reviewerModelId),
    subAgents: {
      count: slot.subAgents.recommended,
      min: slot.subAgents.min,
      max: slot.subAgents.max,
      recommended: true,
      source: "recommended",
    },
    cost: estimateSelectionCost({
      executorId: slot.executorModelId,
      reviewerId: slot.reviewerModelId,
      subAgents: slot.subAgents.recommended,
    }),
  };
}
