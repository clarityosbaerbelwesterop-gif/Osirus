import type { MetadataRoute } from "next";
import { absoluteUrl } from "./site-url";

const PATHS = [
  "/",
  "/ueber-uns",
  "/osirus-ki",
  "/ki-team-freigabe",
  "/sicherheit",
  "/legal/impressum",
  "/legal/privacy",
  "/legal/terms",
  "/legal/eula",
  "/legal/cookies",
  "/kuendigen",
] as const;

const CONTENT = new Set(["/ueber-uns", "/osirus-ki", "/ki-team-freigabe"]);

export default function sitemap(): MetadataRoute.Sitemap {
  return PATHS.map((path) => ({
    url: absoluteUrl(path),
    lastModified: new Date(CONTENT.has(path) ? "2026-11-22" : "2026-11-17"),
    changeFrequency:
      path === "/" ? "weekly" : CONTENT.has(path) ? "monthly" : "yearly",
    priority: path === "/" ? 1 : CONTENT.has(path) ? 0.6 : 0.2,
  }));
}
