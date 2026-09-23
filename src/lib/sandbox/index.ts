import {
  UnconfiguredSandbox,
  type SandboxAvailability,
  type SandboxDriver,
} from "./driver";

export * from "./driver";

/**
 * Whether this request carries a Vercel OIDC token.
 *
 * Inside a deployed Vercel function the token is delivered per request, as
 * the `x-vercel-oidc-token` header, through Vercel's request context -- not as
 * an environment variable. `process.env.VERCEL_OIDC_TOKEN` exists only in local
 * development after `vercel env pull`. Checking the env var alone, as this file
 * used to, reported the sandbox unconfigured in production even when OIDC was
 * working. `getVercelOidcTokenSync` reads both, in that order, and is the same
 * resolution the Sandbox SDK uses to authenticate.
 */
export async function hasOidcToken(): Promise<boolean> {
  try {
    const { getVercelOidcTokenSync } = await import("@vercel/oidc");
    return getVercelOidcTokenSync().length > 0;
  } catch {
    return false;
  }
}

/**
 * Explicit credentials, for CI only.
 *
 * The app runtime authenticates through OIDC and never reads a Vercel token.
 * The live-eval workflow runs outside Vercel, where there is no OIDC request
 * context, and supplies a project-scoped token from its own secrets. This is
 * read from the environment only when `OSIRUS_SANDBOX_CREDENTIALS=ci` is set,
 * which the deployed app never sets.
 */
function ciCredentials() {
  if (process.env.OSIRUS_SANDBOX_CREDENTIALS !== "ci") return undefined;
  const token = process.env.VERCEL_TOKEN;
  const teamId = process.env.VERCEL_TEAM_ID;
  const projectId = process.env.VERCEL_PROJECT_ID;
  return token && teamId && projectId
    ? { token, teamId, projectId }
    : undefined;
}

/**
 * Pick a sandbox driver.
 *
 * Vercel Sandbox is the configured provider. Without an OIDC token (or CI
 * credentials) the unconfigured driver is returned and says why -- there is
 * deliberately no fallback that runs generated code in this process.
 */
export async function resolveSandbox(): Promise<SandboxDriver> {
  const credentials = ciCredentials();
  if (!credentials && !(await hasOidcToken())) {
    return new UnconfiguredSandbox(
      "No Vercel OIDC token on this request; hosted execution is NOT_CONFIGURED here.",
    );
  }
  const { VercelSandboxDriver } = await import("./vercel");
  return new VercelSandboxDriver(credentials);
}

export async function sandboxAvailability(): Promise<SandboxAvailability> {
  return (await resolveSandbox()).availability();
}
