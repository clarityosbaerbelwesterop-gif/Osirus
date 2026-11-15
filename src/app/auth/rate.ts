import "server-only";
import { createHash, createHmac } from "node:crypto";
import { headers } from "next/headers";
import { enforceRateLimit, RateLimitError } from "@/lib/security/rate-limit";

// Sign-in, sign-up and password reset are limited per address and per
// network: an attacker spraying many addresses from one IP is stopped too.
// Address and IP are stored only as keyed hashes: a plain SHA-256 of an
// IPv4 address is reversed by hashing all 2^32 of them, and a counter row
// must not keep anybody's e-mail address in clear text.

export function privacyHash(value: string) {
  const key = process.env.NEON_AUTH_COOKIE_SECRET;
  return (
    key
      ? createHmac("sha256", key).update(value)
      : createHash("sha256").update(value)
  )
    .digest("hex")
    .slice(0, 32);
}

async function clientNetwork() {
  const list = await headers();
  const forwarded = list.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ip = forwarded || list.get("x-real-ip")?.trim() || "unknown";
  return privacyHash(ip);
}

/** False when a limit is reached. A store outage does not lock people out. */
export async function authAttemptAllowed(input: {
  route: string;
  email: string;
  perAddress: number;
  perNetwork: number;
}) {
  if (!process.env.DATABASE_URL) return true;
  try {
    await enforceRateLimit({
      subject: `${input.route}:${privacyHash(input.email.trim().toLowerCase())}`,
      route: input.route,
      limit: input.perAddress,
    });
    await enforceRateLimit({
      subject: `${input.route}:ip:${await clientNetwork()}`,
      route: `${input.route}.ip`,
      limit: input.perNetwork,
    });
    return true;
  } catch (error) {
    return !(error instanceof RateLimitError);
  }
}
