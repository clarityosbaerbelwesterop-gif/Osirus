import type { MetadataRoute } from "next";
import { publicBaseOrigin } from "@/lib/public-base";

export default function robots(): MetadataRoute.Robots {
  const origin = publicBaseOrigin();
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/app", "/api", "/auth", "/internal", "/ui-fixtures"],
      },
    ],
    ...(origin ? { sitemap: `${origin}/sitemap.xml` } : {}),
  };
}
