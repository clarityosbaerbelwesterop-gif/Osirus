// Pure helpers for the Vercel runtime-configuration sync.
// Extracted so the coverage rules can be unit tested: a false negative here
// silently blocks every runtime secret from reaching production.

/**
 * Vercel returns `target` as an array on modern API versions and as a bare
 * string on older ones. Normalise both into an array.
 */
export function environmentTargets(environment) {
  if (Array.isArray(environment.target)) return environment.target;
  return environment.target ? [environment.target] : [];
}

/**
 * True when `environment` applies to `target` for the deployment we care about.
 *
 * Vercel stores one row per target, and a row may additionally be pinned to a
 * single git branch. A branch-pinned row only applies to preview deployments of
 * that branch, so it must not be counted as covering preview in general.
 */
export function environmentApplies(environment, key, target, gitBranch) {
  if (environment.key !== key) return false;
  if (!environmentTargets(environment).includes(target)) return false;
  if (!environment.gitBranch) return true;
  return target === "preview" && environment.gitBranch === gitBranch;
}

/**
 * Targets from `targets` that no row in `environments` covers for `key`.
 *
 * Coverage is evaluated per target across the union of rows. The previous
 * implementation asked whether a *single* row covered *every* target, which no
 * correctly-configured Vercel project can ever satisfy once more than one
 * target is requested.
 */
export function uncoveredTargets(environments, key, targets, gitBranch) {
  return targets.filter(
    (target) =>
      !environments.some((environment) =>
        environmentApplies(environment, key, target, gitBranch),
      ),
  );
}

/** True when every requested target is covered for `key`. */
export function coversTargets(environments, key, targets, gitBranch) {
  return uncoveredTargets(environments, key, targets, gitBranch).length === 0;
}

/** True when at least one row exists for `key`, on any target or branch. */
export function hasAnyValue(environments, key) {
  return environments.some((environment) => environment.key === key);
}

/**
 * The primary model must be Grok 4.6 or an explicitly configured Opus 5 model
 * ID. Model IDs are never invented; the caller separately verifies the ID is
 * actually offered by UnoRouter.
 */
export function isAllowedPrimaryModel(model) {
  if (model === "grok-4.6") return true;
  const normalized = model.toLowerCase();
  return (
    normalized.includes("opus") &&
    /(?:^|[-_.:/])5(?:$|[-_.:/])/.test(normalized)
  );
}

export function parseTargetList(value) {
  const target = value ?? "both";
  if (target === "preview") return ["preview"];
  if (target === "production") return ["production"];
  if (target === "both") return ["preview", "production"];
  throw new Error("OSIRUS_SYNC_TARGET must be preview, production, or both");
}
