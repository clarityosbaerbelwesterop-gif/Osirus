import type { MetadataRoute } from "next";
import { absoluteUrl } from "./site-url";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/app", "/api", "/auth", "/internal", "/ui-fixtures"],
      },
    ],
    sitemap: absoluteUrl("/sitemap.xml"),
  };
}
