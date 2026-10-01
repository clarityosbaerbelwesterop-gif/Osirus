import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

// Regression coverage for AUTH-1: the build-time cookie secret fallback must
// never be a publicly known deterministic string.
//
// createNeonAuth is mocked so the real module can be imported in a node test
// environment (the real package pulls in next/headers, which only resolves
// inside the Next.js bundler). The mock captures the options our module
// passes, which is exactly the behaviour under test.

const createNeonAuth = vi.hoisted(() =>
  vi.fn((options: unknown) => ({ __options: options })),
);

vi.mock("@neondatabase/auth/next/server", () => ({ createNeonAuth }));

const serverModulePath = join(
  __dirname,
  "..",
  "src",
  "lib",
  "auth",
  "server.ts",
);

type AuthOptions = { cookies: { secret: string }; baseUrl: string };

const lastAuthOptions = () =>
  createNeonAuth.mock.calls.at(-1)?.[0] as AuthOptions;

describe("auth configuration", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
    createNeonAuth.mockClear();
  });

  it("is not configured when the Neon Auth env vars are missing", async () => {
    vi.stubEnv("NEON_AUTH_BASE_URL", undefined);
    vi.stubEnv("NEON_AUTH_COOKIE_SECRET", undefined);
    vi.resetModules();
    const { authConfigured } = await import("@/lib/auth/server");
    expect(authConfigured).toBe(false);
  });

  it("never falls back to a publicly known cookie secret", async () => {
    vi.stubEnv("NEON_AUTH_BASE_URL", undefined);
    vi.stubEnv("NEON_AUTH_COOKIE_SECRET", undefined);
    vi.resetModules();
    const serverModule = await import("@/lib/auth/server");
    // The unconfigured module must still import cleanly (builds stay alive).
    expect(serverModule.authConfigured).toBe(false);

    // The fallback secret must not be the old public constant, and must be
    // high-entropy (32 random bytes, hex encoded).
    const firstSecret = lastAuthOptions().cookies.secret;
    expect(firstSecret).not.toContain("osirus-build-only-cookie-secret");
    expect(firstSecret).toMatch(/^[0-9a-f]{64}$/);

    // A fresh module instance gets a fresh secret — nothing deterministic.
    vi.resetModules();
    await import("@/lib/auth/server");
    expect(lastAuthOptions().cookies.secret).not.toBe(firstSecret);

    // And the public fallback string appears nowhere in the module source.
    const source = readFileSync(serverModulePath, "utf8");
    expect(source).not.toContain(
      "osirus-build-only-cookie-secret-not-for-production",
    );
  });

  it("is configured when both Neon Auth env vars are present", async () => {
    vi.stubEnv("NEON_AUTH_BASE_URL", "https://auth.example.test/auth");
    vi.stubEnv(
      "NEON_AUTH_COOKIE_SECRET",
      "a-real-secret-that-is-at-least-32-characters-long",
    );
    vi.resetModules();
    const { authConfigured } = await import("@/lib/auth/server");
    expect(authConfigured).toBe(true);
    // The configured secret is used verbatim, never replaced by a fallback.
    expect(lastAuthOptions().cookies.secret).toBe(
      "a-real-secret-that-is-at-least-32-characters-long",
    );
    expect(lastAuthOptions().baseUrl).toBe("https://auth.example.test/auth");
  });
});
