import type { MetadataRoute } from "next";
import { absoluteUrl } from "./site-url";

const PATHS = [
  "/",
  "/sicherheit",
  "/legal/impressum",
  "/legal/privacy",
  "/legal/terms",
  "/legal/eula",
  "/legal/cookies",
  "/kuendigen",
] as const;

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date("2026-10-24");
  return PATHS.map((path) => ({
    url: absoluteUrl(path),
    lastModified,
    changeFrequency: path === "/" ? "weekly" : "yearly",
    priority: path === "/" ? 1 : 0.2,
  }));
}
