import type { ModelRole } from "./provider";

// The free UnoRouter models Osirus may put on a role (M48). Only model IDs
// Osirus has actually run are listed -- never an invented one. With a single
// entry, per-role model assignment is inert and every strategy optimises
// around that one model; the RSI live runner lists what the key can reach
// (scripts/list-unorouter-models.mjs) so a second free model is added here
// only once it is known to exist.
export const FREE_MODELS = ["deepseek-v4-pro-0813:free"] as const;

export function isFreeModel(id: string) {
  return (FREE_MODELS as readonly string[]).includes(id);
}

/** A role map with every non-allowlisted model dropped. */
export function freeRoleModels(
  roles: Partial<Record<ModelRole, string>> | undefined,
): Partial<Record<ModelRole, string>> | undefined {
  if (!roles) return undefined;
  const kept = Object.fromEntries(
    Object.entries(roles).filter(
      ([, model]) => typeof model === "string" && isFreeModel(model),
    ),
  ) as Partial<Record<ModelRole, string>>;
  return Object.keys(kept).length ? kept : undefined;
}
