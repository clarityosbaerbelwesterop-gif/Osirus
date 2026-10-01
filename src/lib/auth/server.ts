import { randomBytes } from "node:crypto";
import { createNeonAuth } from "@neondatabase/auth/next/server";
import { env } from "../env";

export const authConfigured = Boolean(
  env.NEON_AUTH_BASE_URL && env.NEON_AUTH_COOKIE_SECRET,
);

const buildSafeBaseUrl =
  env.NEON_AUTH_BASE_URL ?? "https://osirus-auth-not-configured.invalid/auth";
// When NEON_AUTH_COOKIE_SECRET is unset (e.g. `next build` importing modules
// without env), fall back to a per-process random secret — never a static,
// publicly known one. This secret can never mint a valid production session:
// without the real provider config authConfigured is false, and every entry
// point that could issue or accept a session is gated on it (the proxy fails
// closed in src/proxy.ts, server code calls requireAuthConfiguration()).
const buildSafeCookieSecret =
  env.NEON_AUTH_COOKIE_SECRET ?? randomBytes(32).toString("hex");

export const auth = createNeonAuth({
  baseUrl: buildSafeBaseUrl,
  cookies: {
    secret: buildSafeCookieSecret,
  },
  logLevel: env.NODE_ENV === "test" ? "silent" : "warn",
});

export function requireAuthConfiguration() {
  if (!authConfigured) {
    throw new Error("Managed Neon Auth is not configured");
  }
}
