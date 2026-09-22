import {
  UnconfiguredSandbox,
  type SandboxAvailability,
  type SandboxDriver,
} from "./driver";

export * from "./driver";

/**
 * Pick a sandbox driver.
 *
 * Vercel Sandbox is the configured provider. Outside a Vercel function there
 * is no OIDC token to exchange, so the unconfigured driver is returned and
 * says why -- there is deliberately no local fallback that runs generated code
 * in this process.
 */
export async function resolveSandbox(): Promise<SandboxDriver> {
  if (!process.env.VERCEL_OIDC_TOKEN) {
    return new UnconfiguredSandbox(
      "VERCEL_OIDC_TOKEN is not present; hosted execution is NOT_CONFIGURED in this environment.",
    );
  }
  const { VercelSandboxDriver } = await import("./vercel");
  return new VercelSandboxDriver();
}

export async function sandboxAvailability(): Promise<SandboxAvailability> {
  return (await resolveSandbox()).availability();
}
