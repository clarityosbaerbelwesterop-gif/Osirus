/**
 * Server-side UnoRouter key pool.
 *
 * GitHub Actions secret names and process env vars are the same strings:
 * UNOROUTER_API_KEY, UNOROUTER_API_KEY_1, UNOROUTER_API_KEY_2, UNOROUTER_API_KEY_3.
 * Values are read from the environment at call time. This module never logs them
 * and never chooses a process-wide "current key". Each request gets its own copy.
 * A deployment that sets only UNOROUTER_API_KEY still works.
 */

export const LAB_KEY_ENV_NAMES = [
  "UNOROUTER_API_KEY",
  "UNOROUTER_API_KEY_1",
  "UNOROUTER_API_KEY_2",
  "UNOROUTER_API_KEY_3",
] as const;

export function labKeyPool(
  env: Readonly<Record<string, string | undefined>>,
): readonly string[] {
  const seen = new Set<string>();
  const keys: string[] = [];
  for (const name of LAB_KEY_ENV_NAMES) {
    const value = env[name];
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    keys.push(trimmed);
  }
  return keys;
}
