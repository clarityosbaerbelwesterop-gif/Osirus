import type { MetadataRoute } from "next";
import { headers } from "next/headers";
import { absoluteUrl, publicSiteUrl } from "./site-url";

// Only the public domain is crawled. osirus-ai.vercel.app (webhooks,
// background calls) and deployment URLs serve the same pages and would
// compete with it as duplicates.
export default async function robots(): Promise<MetadataRoute.Robots> {
  const host = (await headers()).get("host")?.split(":")[0]?.toLowerCase();
  const canonical = publicSiteUrl().hostname.toLowerCase();
  if (host && host !== canonical && host !== "localhost")
    return { rules: [{ userAgent: "*", disallow: "/" }] };
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/app", "/api", "/auth", "/internal", "/ui-fixtures", "/s/"],
      },
    ],
    sitemap: absoluteUrl("/sitemap.xml"),
    host: absoluteUrl("/"),
  };
}
