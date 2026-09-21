import { createNeonAuth } from "@neondatabase/auth/next/server";
import { env } from "../env";

export const authConfigured = Boolean(
  env.NEON_AUTH_BASE_URL && env.NEON_AUTH_COOKIE_SECRET,
);

const buildSafeBaseUrl =
  env.NEON_AUTH_BASE_URL ?? "https://osirus-auth-not-configured.invalid/auth";
const buildSafeCookieSecret =
  env.NEON_AUTH_COOKIE_SECRET ??
  "osirus-build-only-cookie-secret-not-for-production-000000";

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
