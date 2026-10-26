const DEFAULT_SITE_URL = "https://osirus-ai.vercel.app";
const FORBIDDEN_HOSTS = new Set(["osirus.vercel.app"]);

/** Public site origin. Override with NEXT_PUBLIC_SITE_URL. Never the other Osirus host. */
export function publicSiteUrl(): URL {
  const raw = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (raw) {
    try {
      const url = new URL(raw);
      if (
        (url.protocol === "https:" || url.protocol === "http:") &&
        !FORBIDDEN_HOSTS.has(url.hostname)
      ) {
        return url;
      }
    } catch {
      // Ignore a malformed override and use the public default.
    }
  }
  return new URL(DEFAULT_SITE_URL);
}

export function absoluteUrl(path: string): string {
  return new URL(path, publicSiteUrl()).toString();
}
