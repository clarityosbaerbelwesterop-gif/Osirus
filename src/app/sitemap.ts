import type { MetadataRoute } from "next";
import { publicBaseOrigin } from "@/lib/public-base";

export default function sitemap(): MetadataRoute.Sitemap {
  const BASE = publicBaseOrigin();
  if (!BASE) return [];
  const lastModified = new Date("2026-10-01");
  return [
    { url: `${BASE}/`, lastModified, changeFrequency: "weekly", priority: 1 },
    {
      url: `${BASE}/legal/impressum`,
      lastModified,
      changeFrequency: "yearly",
      priority: 0.2,
    },
    {
      url: `${BASE}/legal/privacy`,
      lastModified,
      changeFrequency: "yearly",
      priority: 0.3,
    },
    {
      url: `${BASE}/legal/terms`,
      lastModified,
      changeFrequency: "yearly",
      priority: 0.2,
    },
    {
      url: `${BASE}/legal/cookies`,
      lastModified,
      changeFrequency: "yearly",
      priority: 0.2,
    },
  ];
}
