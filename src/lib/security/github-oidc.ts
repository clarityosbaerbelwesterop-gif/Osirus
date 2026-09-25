import { createPublicKey, verify as verifySignature } from "node:crypto";

// GitHub Actions OIDC tokens, as the hourly caller of the scheduler tick.
//
// The scheduler secret lives only in Vercel and is never copied anywhere
// else. The hourly pulse workflow instead asks GitHub for a short-lived OIDC
// token (audience `osirus-scheduler`) and sends it. This module accepts the
// token only if GitHub signed it (RS256, keys from GitHub's JWKS) and every
// claim names this repository, the pulse workflow file, the main branch and
// a scheduled or manual run. Anything else -- another repository, another
// workflow, a fork, a pull request, an expired token -- is refused.

export const OIDC_ISSUER = "https://token.actions.githubusercontent.com";
export const OIDC_AUDIENCE = "osirus-scheduler";
export const PULSE_REPOSITORY = "clarityosbaerbelwesterop-gif/Osirus";
export const PULSE_WORKFLOW = ".github/workflows/capability-pulse.yml";
const JWKS_URL = `${OIDC_ISSUER}/.well-known/jwks`;
const CLOCK_SKEW_S = 60;

type Jwk = { kid?: string; kty: string; n?: string; e?: string; alg?: string };

export type OidcExpectation = {
  repository: string;
  workflow: string;
  ref: string;
  events: string[];
  audience: string;
};

export const PULSE_EXPECTATION: OidcExpectation = {
  repository: PULSE_REPOSITORY,
  workflow: PULSE_WORKFLOW,
  ref: "refs/heads/main",
  events: ["schedule", "workflow_dispatch"],
  audience: OIDC_AUDIENCE,
};

/**
 * The M44–M48 runners. Their own audience, so a token minted for the
 * scheduler tick is never accepted here and one minted here never reaches
 * the tick. Each endpoint names the one workflow file it serves.
 */
export const RSI_AUDIENCE = "osirus-rsi";
const RSI_EVENTS = ["schedule", "workflow_dispatch", "workflow_run"];

export const RSI_LIVE_EXPECTATION: OidcExpectation = {
  repository: PULSE_REPOSITORY,
  workflow: ".github/workflows/rsi-live.yml",
  ref: "refs/heads/main",
  events: RSI_EVENTS,
  audience: RSI_AUDIENCE,
};

export const SOFTWARE_RSI_EXPECTATION: OidcExpectation = {
  repository: PULSE_REPOSITORY,
  workflow: ".github/workflows/software-rsi.yml",
  ref: "refs/heads/main",
  events: RSI_EVENTS,
  audience: RSI_AUDIENCE,
};

let cache: { keys: Jwk[]; at: number } | null = null;

async function githubKeys(fetchImpl: typeof fetch): Promise<Jwk[]> {
  if (cache && Date.now() - cache.at < 60 * 60 * 1000) return cache.keys;
  const response = await fetchImpl(JWKS_URL, {
    signal: AbortSignal.timeout(5_000),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`jwks_unavailable:${response.status}`);
  const body = (await response.json()) as { keys?: Jwk[] };
  cache = { keys: body.keys ?? [], at: Date.now() };
  return cache.keys;
}

/** Test hook: forget cached keys. */
export function resetOidcKeyCache() {
  cache = null;
}

function decodePart(part: string) {
  return JSON.parse(Buffer.from(part, "base64url").toString("utf8")) as Record<
    string,
    unknown
  >;
}

export type OidcResult =
  { ok: true; claims: Record<string, unknown> } | { ok: false; reason: string };

/** Check the claims of a token whose signature already verified. */
export function checkClaims(
  claims: Record<string, unknown>,
  expected: OidcExpectation,
  nowSeconds = Math.floor(Date.now() / 1000),
): OidcResult {
  const fail = (reason: string): OidcResult => ({ ok: false, reason });
  if (claims.iss !== OIDC_ISSUER) return fail("issuer");
  const audience = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!audience.includes(expected.audience)) return fail("audience");
  const exp = Number(claims.exp);
  const nbf = Number(claims.nbf ?? claims.iat);
  if (!Number.isFinite(exp) || exp + CLOCK_SKEW_S < nowSeconds)
    return fail("expired");
  if (Number.isFinite(nbf) && nbf - CLOCK_SKEW_S > nowSeconds)
    return fail("not_yet_valid");
  const repository = String(claims.repository ?? "");
  if (repository.toLowerCase() !== expected.repository.toLowerCase())
    return fail("repository");
  if (claims.ref !== expected.ref) return fail("ref");
  const workflowRef = String(claims.workflow_ref ?? "");
  if (
    workflowRef.toLowerCase() !==
    `${expected.repository}/${expected.workflow}@${expected.ref}`.toLowerCase()
  )
    return fail("workflow");
  if (!expected.events.includes(String(claims.event_name ?? "")))
    return fail("event");
  return { ok: true, claims };
}

/** Verify a GitHub Actions OIDC token against an expectation. */
export async function verifyGithubOidc(
  token: string,
  expected: OidcExpectation = PULSE_EXPECTATION,
  options: { fetchImpl?: typeof fetch; now?: number } = {},
): Promise<OidcResult> {
  const parts = token.split(".");
  if (parts.length !== 3) return { ok: false, reason: "malformed" };
  let header: Record<string, unknown>;
  let claims: Record<string, unknown>;
  try {
    header = decodePart(parts[0]!);
    claims = decodePart(parts[1]!);
  } catch {
    return { ok: false, reason: "malformed" };
  }
  // Only RS256: never "none", never an HMAC keyed with a public key.
  if (header.alg !== "RS256") return { ok: false, reason: "algorithm" };
  let keys: Jwk[];
  try {
    keys = await githubKeys(options.fetchImpl ?? fetch);
  } catch {
    return { ok: false, reason: "jwks_unavailable" };
  }
  const jwk = keys.find((key) => key.kid === header.kid && key.kty === "RSA");
  if (!jwk) return { ok: false, reason: "unknown_key" };
  const valid = verifySignature(
    "RSA-SHA256",
    Buffer.from(`${parts[0]}.${parts[1]}`),
    createPublicKey({ key: jwk as never, format: "jwk" }),
    Buffer.from(parts[2]!, "base64url"),
  );
  if (!valid) return { ok: false, reason: "signature" };
  return checkClaims(
    claims,
    expected,
    Math.floor((options.now ?? Date.now()) / 1000),
  );
}
