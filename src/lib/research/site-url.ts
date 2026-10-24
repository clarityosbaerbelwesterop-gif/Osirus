/**
 * Public site origin for outbound identification.
 * NEXT_PUBLIC_SITE_URL overrides the default. osirus.vercel.app is rejected.
 */

export const DEFAULT_SITE_URL = "https://osirus-ai.vercel.app";

const FORBIDDEN_HOST = "osirus.vercel.app";

export function siteUrl(env?: { NEXT_PUBLIC_SITE_URL?: string }) {
  const raw =
    (env?.NEXT_PUBLIC_SITE_URL ?? process.env.NEXT_PUBLIC_SITE_URL)?.trim() ||
    DEFAULT_SITE_URL;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      return DEFAULT_SITE_URL;
    }
    if (url.hostname.toLowerCase() === FORBIDDEN_HOST) return DEFAULT_SITE_URL;
    return url.origin;
  } catch {
    return DEFAULT_SITE_URL;
  }
}

export function researchUserAgent(env?: { NEXT_PUBLIC_SITE_URL?: string }) {
  return `OsirusResearch/1.0 (+${siteUrl(env)})`;
}
