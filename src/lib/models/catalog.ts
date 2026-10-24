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

export const CATALOG_MODELS: readonly CatalogModel[] = snapshot.models;

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
