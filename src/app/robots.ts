import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/app", "/api", "/auth", "/internal", "/ui-fixtures"],
      },
    ],
    sitemap: "https://osirus.vercel.app/sitemap.xml",
  };
}
