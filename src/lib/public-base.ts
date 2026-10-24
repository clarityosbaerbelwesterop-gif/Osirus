/**
 * Public origin of this deployment. Unset means Osirus does not invent one.
 * osirus.vercel.app is a different product and is never accepted.
 */

const FORBIDDEN_HOST = "osirus.vercel.app";

export function publicBaseUrl(
  env: NodeJS.ProcessEnv = process.env,
): URL | null {
  const raw = env.OSIRUS_PUBLIC_BASE_URL?.trim();
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (url.hostname.toLowerCase() === FORBIDDEN_HOST) return null;
  url.hash = "";
  url.search = "";
  if (url.pathname !== "/") url.pathname = url.pathname.replace(/\/$/, "");
  return url;
}

export function publicBaseOrigin(env: NodeJS.ProcessEnv = process.env) {
  const url = publicBaseUrl(env);
  if (!url) return null;
  return url.origin;
}
