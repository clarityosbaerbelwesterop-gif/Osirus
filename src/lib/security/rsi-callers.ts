import {
  verifyGithubOidc,
  type OidcExpectation,
} from "@/lib/security/github-oidc";
import {
  enforceRateLimit,
  RateLimitError,
  RateLimitUnavailableError,
} from "@/lib/security/rate-limit";

// Who may talk to the recursive-intelligence endpoints: one GitHub Actions
// workflow file each, on main, in this repository, with a short-lived OIDC
// token for the "osirus-rsi" audience. There is no shared secret and no
// user session path. The endpoints hand out system-generated work (task
// specs, hypotheses) and take back bounded, validated results; they never
// read or return a tenant's data.

export const RSI_OIDC_HEADER = "x-osirus-github-oidc";

export async function authorizeRsiCaller(
  request: Request,
  expectation: OidcExpectation,
  route: string,
): Promise<Response | null> {
  const token = request.headers.get(RSI_OIDC_HEADER);
  if (!token || token.length >= 8_192)
    return Response.json({ error: "unauthorized" }, { status: 401 });
  const verified = await verifyGithubOidc(token, expectation);
  if (!verified.ok)
    return Response.json({ error: "unauthorized" }, { status: 401 });
  try {
    await enforceRateLimit({ subject: "rsi-runner", route, limit: 30 });
  } catch (error) {
    if (error instanceof RateLimitError)
      return Response.json({ error: "rate_limited" }, { status: 429 });
    if (error instanceof RateLimitUnavailableError)
      return Response.json({ error: "service_unavailable" }, { status: 503 });
    throw error;
  }
  return null;
}

/** A JSON body, capped, or null. */
export async function boundedJson(request: Request, maxBytes = 256_000) {
  const text = await request.text();
  if (text.length > maxBytes) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}
