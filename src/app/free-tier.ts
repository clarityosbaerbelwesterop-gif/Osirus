/**
 * TODO: wird durch Tungs config-Funktion aus #84 ersetzt.
 * The UI does not read the environment variable itself.
 * On by default. Off only when the value is exactly "false".
 */
export function isFreeTierEnabled() {
  return process.env.OSIRUS_FREE_TIER_ENABLED !== "false";
}

export function startAccountLabel() {
  return isFreeTierEnabled() ? "Kostenlos starten" : "Konto erstellen";
}
