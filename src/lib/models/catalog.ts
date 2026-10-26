import snapshot from "./unorouter-catalog.json";

/**
 * Public UNOROUTER catalog captured 2026-10-24 from
 * https://api.unorouter.com/api/pricing/catalog
 * Prices are USD per 1 million tokens in that snapshot. They are not a
 * live quote and they do not say which ids this deployment's key may call.
 */

export type CatalogModel = {
  id: string;
  vendor: string;
  online: boolean;
  chat: boolean;
  inputPerMillionUsd: number | null;
  outputPerMillionUsd: number | null;
};

export const CATALOG_CAPTURED_AT = snapshot.capturedAt;

export const NVIDIA_CATALOG_MODELS: readonly CatalogModel[] = [
  {
    id: "nvidia/llama-3.1-nemotron-ultra-253b-v1",
    vendor: "nvidia",
    online: true,
    chat: true,
    inputPerMillionUsd: 0.6,
    outputPerMillionUsd: 1.8,
  },
  {
    id: "deepseek-ai/deepseek-r1",
    vendor: "nvidia",
    online: true,
    chat: true,
    inputPerMillionUsd: 0.55,
    outputPerMillionUsd: 2.19,
  },
  {
    id: "meta/llama-3.3-70b-instruct",
    vendor: "nvidia",
    online: true,
    chat: true,
    inputPerMillionUsd: 0.2,
    outputPerMillionUsd: 0.4,
  },
  {
    id: "qwen/qwen2.5-coder-32b-instruct",
    vendor: "nvidia",
    online: true,
    chat: true,
    inputPerMillionUsd: 0.18,
    outputPerMillionUsd: 0.36,
  },
  {
    id: "mistralai/mistral-large-2-instruct",
    vendor: "nvidia",
    online: true,
    chat: true,
    inputPerMillionUsd: 0.8,
    outputPerMillionUsd: 2.4,
  },
  {
    id: "google/gemma-2-27b-it",
    vendor: "nvidia",
    online: true,
    chat: true,
    inputPerMillionUsd: 0.15,
    outputPerMillionUsd: 0.3,
  },
];

export const CATALOG_MODELS: readonly CatalogModel[] = [
  ...snapshot.models,
  ...NVIDIA_CATALOG_MODELS,
];

const BY_ID = new Map(CATALOG_MODELS.map((model) => [model.id, model]));

export function catalogModel(id: string): CatalogModel | null {
  return BY_ID.get(id) ?? null;
}

export function isCatalogModelId(id: string) {
  return BY_ID.has(id);
}

/** Product UI must not offer these names. They are not UNOROUTER models. */
const RETIRED = new Set(["rouge", "quasnir", "darus"]);

export function isRetiredProductModel(id: string) {
  return RETIRED.has(id.trim().toLowerCase());
}
