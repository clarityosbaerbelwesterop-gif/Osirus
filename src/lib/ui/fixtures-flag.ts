/**
 * The UI fixture surfaces exist for automated visual, accessibility and
 * journey tests. They render components with fixed data and never touch the
 * database, but they are still switched off unless explicitly enabled, and
 * never in a production deployment.
 */
export function fixturesEnabled(
  env: Record<string, string | undefined> = process.env,
) {
  return env.OSIRUS_UI_FIXTURES === "1" && env.VERCEL_ENV !== "production";
}
