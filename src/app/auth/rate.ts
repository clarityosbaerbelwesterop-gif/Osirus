import "server-only";
import { createHash } from "node:crypto";
import { headers } from "next/headers";
import { enforceRateLimit, RateLimitError } from "@/lib/security/rate-limit";

// Sign-in, sign-up and password reset are limited per address and per
// network: an attacker spraying many addresses from one IP is stopped too.
// The IP is hashed before it is stored.

async function clientNetwork() {
  const list = await headers();
  const forwarded = list.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ip = forwarded || list.get("x-real-ip")?.trim() || "unknown";
  return createHash("sha256").update(ip).digest("hex").slice(0, 32);
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
      subject: `${input.route}:${input.email.toLowerCase().slice(0, 120)}`,
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
