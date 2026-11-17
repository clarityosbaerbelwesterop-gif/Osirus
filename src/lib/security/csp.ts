// Content Security Policy, shared by next.config.ts (every response) and the
// proxy (pages, with a per-request nonce). One source, so the two never
// drift apart.

const COMMON = [
  "default-src 'self'",
  "img-src 'self' data:",
  // React writes style attributes; styles cannot run code.
  "style-src 'self' 'unsafe-inline'",
  "connect-src 'self'",
  // Workspace previews are served from Vercel Sandbox domains. Nothing else
  // may be framed.
  "frame-src https://*.vercel.run",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "media-src 'self'",
];

/**
 * The policy for responses without a nonce (API routes, assets, files).
 * Inline scripts stay allowed here only because these responses are not
 * pages; every page gets pageContentSecurityPolicy instead.
 */
export function staticContentSecurityPolicy(development: boolean) {
  return [
    ...COMMON,
    development
      ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'"
      : "script-src 'self' 'unsafe-inline'",
    ...(development ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");
}

/**
 * The policy for a page: only scripts with this request's nonce run, and
 * what they load ('strict-dynamic'). 'unsafe-inline' and https: are
 * fallbacks for browsers without strict-dynamic and are ignored by every
 * browser that supports it (CSP level 3).
 */
export function pageContentSecurityPolicy(nonce: string, development: boolean) {
  const script = [
    "script-src",
    `'nonce-${nonce}'`,
    "'strict-dynamic'",
    "'self'",
    "https:",
    "'unsafe-inline'",
    ...(development ? ["'unsafe-eval'"] : []),
  ].join(" ");
  return [
    ...COMMON,
    script,
    ...(development ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");
}
