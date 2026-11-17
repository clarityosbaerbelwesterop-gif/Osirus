import "server-only";
import { createHash } from "node:crypto";

// NIST SP 800-63B 5.1.1.2: a new password is checked against passwords known
// from breaches. Have I Been Pwned's range API is queried with k-anonymity:
// only the first five hex characters of the SHA-1 leave this server, never
// the password or its full hash, and padded responses hide which suffix was
// looked up. An outage of the service never blocks a sign-up (fail open).

const RANGE_URL = "https://api.pwnedpasswords.com/range/";
const TIMEOUT_MS = 2_500;

/** How often the password appears in known breaches; null when unknown. */
export async function breachCount(
  password: string,
  fetchImpl: typeof fetch = fetch,
): Promise<number | null> {
  const hash = createHash("sha1").update(password, "utf8").digest("hex");
  const digest = hash.toUpperCase();
  const prefix = digest.slice(0, 5);
  const suffix = digest.slice(5);
  try {
    const response = await fetchImpl(`${RANGE_URL}${prefix}`, {
      headers: { "Add-Padding": "true", "user-agent": "osirus-password-check" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
    if (!response.ok) return null;
    const body = await response.text();
    for (const line of body.split("\n")) {
      const [candidate, count] = line.trim().split(":");
      if (candidate === suffix) return Number(count) || 0;
    }
    return 0;
  } catch {
    return null;
  }
}

export const BREACHED_PASSWORD_ERROR =
  "Dieses Passwort ist aus öffentlichen Datenlecks bekannt und wird bei Angriffen als Erstes ausprobiert. Bitte wähle ein anderes.";

/** True when the password is known from a breach (padding rows count 0). */
export async function passwordIsBreached(
  password: string,
  fetchImpl?: typeof fetch,
) {
  return ((await breachCount(password, fetchImpl)) ?? 0) > 0;
}
