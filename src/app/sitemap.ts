import type { MetadataRoute } from "next";

const BASE = "https://osirus.vercel.app";

export default function sitemap(): MetadataRoute.Sitemap {
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
  ];
}
