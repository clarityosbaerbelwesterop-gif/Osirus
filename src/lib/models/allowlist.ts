import {
  DEFAULT_PRODUCT_MODEL_ID,
  PRODUCT_MODEL_ALLOWLIST,
  type ProductModelId,
} from "@/config/recommendations";
import { catalogModel } from "./catalog";

const ALLOWED = new Set<string>(PRODUCT_MODEL_ALLOWLIST);

/** True only for an allowlisted id that is also an online chat model in the catalog. */
export function isAllowedProductModel(id: string): id is ProductModelId {
  if (!ALLOWED.has(id)) return false;
  const row = catalogModel(id);
  return Boolean(row?.online && row.chat);
}

/** Unknown, retired, and off-list ids fall back to the configured default. */
export function productModelOrDefault(id: string | null | undefined) {
  const trimmed = id?.trim() ?? "";
  return isAllowedProductModel(trimmed) ? trimmed : DEFAULT_PRODUCT_MODEL_ID;
}
