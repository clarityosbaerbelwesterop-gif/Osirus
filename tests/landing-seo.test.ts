import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const redirect = vi.hoisted(() =>
  vi.fn((url: string) => {
    throw new Error(`redirect:${url}`);
  }),
);

vi.mock("next/navigation", () => ({ redirect }));
const requestHost = vi.hoisted(() => ({ value: "osirus-ai.com" }));
vi.mock("next/headers", async (original) => ({
  ...(await original<typeof import("next/headers")>()),
  headers: async () => new Headers({ host: requestHost.value }),
}));
vi.mock("next/link", () => ({
  default: (props: {
    href: string;
    children?: ReactNode;
    className?: string;
  }) =>
    createElement(
      "a",
      { href: props.href, className: props.className },
      props.children,
    ),
}));
vi.mock("@/lib/auth/server", () => ({
  authConfigured: true,
  auth: { getSession: vi.fn(async () => ({ data: { user: null } })) },
}));

import { metadata as authMetadata } from "../src/app/auth/layout";
import { metadata as rootMetadata } from "../src/app/layout";
import HomePage from "../src/app/page";
import robots from "../src/app/robots";
import { searchVerification } from "../src/app/site-url";
import sitemap from "../src/app/sitemap";

describe("landing page", () => {
  it("renders the hero, both CTAs, the run illustration, and legal links", async () => {
    const html = renderToStaticMarkup(
      (await HomePage()) as ReturnType<typeof createElement>,
    );
    expect(html).toContain("Dein KI-Team mit");
    expect(html).toContain("Freigabeknopf");
    expect(html).toContain('href="/sicherheit"');
    // One promise: the product's internal surfaces stay off the public page.
    expect(html).not.toMatch(/\bWork\b|Lab\b|Intelligence|\bRSI\b/);
    expect(html).toContain('href="/auth/sign-up"');
    expect(html).toContain("Kostenlos starten");
    expect(html).not.toContain("Konto erstellen");
    expect(html).not.toContain("für immer");
    expect(html).not.toContain("plan=");
    expect(html).not.toContain("20 €");
    expect(html).not.toContain("50 €");
    expect(html).not.toContain("100 €");
    expect(html).not.toContain("200 €");
    expect(html).not.toContain("§ 19");
    expect(html).toContain("begrenztes kostenloses Kontingent");
    expect(html).toContain('href="/auth/sign-in"');
    expect(html).toContain('href="/legal/impressum"');
    expect(html).toContain('href="/legal/privacy"');
    expect(html).toContain('href="/legal/terms"');
    // § 312k BGB: the cancellation button on the landing page.
    expect(html).toContain('href="/kuendigen"');
    expect(html).toContain('href="/legal/eula"');
    expect(html).toContain('href="/legal/cookies"');
    expect(html).not.toContain('href="#preise"');
    expect(html).not.toContain('id="faq"');
    expect(html).not.toContain("Fragen");
    expect(html).not.toContain("Bald verfügbar");
    expect(html).not.toMatch(
      /ROUGE|QUASNIR|DARUS|inkl\. MwSt|zzgl\. MwSt|brutto|netto/i,
    );
    expect(html).not.toContain("osirus.vercel.app");
    expect(html).not.toContain("No payment required");
    expect(html).not.toContain("✓ verified");
  });

  it("ships SoftwareApplication data without prices", async () => {
    const html = renderToStaticMarkup(
      (await HomePage()) as ReturnType<typeof createElement>,
    );
    const match = html.match(
      /<script type="application\/ld\+json">(.*?)<\/script>/,
    );
    expect(match).not.toBeNull();
    const data = JSON.parse(match![1]);
    expect(data["@type"]).toBe("SoftwareApplication");
    expect(data.name).toBe("Osirus");
    expect(data.url).toBe("https://osirus-ai.com/");
    expect(data.publisher).toMatchObject({
      "@type": "Organization",
      name: "ClarityCompassAI",
    });
    expect(data.offers).toBeUndefined();
    expect(html).not.toContain('"price"');
  });

  it("ships Organization and WebSite JSON-LD with the logo", async () => {
    const html = renderToStaticMarkup(
      (await HomePage()) as ReturnType<typeof createElement>,
    );
    const scripts = [
      ...html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/g),
    ].map((m) => JSON.parse(m[1]));
    const orgBlock = scripts.find((d) => Array.isArray(d["@graph"]));
    expect(orgBlock).toBeDefined();
    const nodes = orgBlock["@graph"] as Array<{
      "@type": string;
      name?: string;
      url?: string;
      logo?: string;
    }>;
    const org = nodes.find((n) => n["@type"] === "Organization");
    const site = nodes.find((n) => n["@type"] === "WebSite");
    expect(org).toMatchObject({
      name: "ClarityCompassAI",
      url: "https://osirus-ai.com",
      logo: "https://osirus-ai.com/icon-512.png",
    });
    expect(site).toMatchObject({
      name: "Osirus AI",
      url: "https://osirus-ai.com",
    });
  });
});

describe("seo surface", () => {
  it("robots.txt allows the public site and keeps app/api/auth out", async () => {
    requestHost.value = "osirus-ai.com";
    const file = await robots();
    const rules = file.rules;
    const rule = Array.isArray(rules) ? rules[0] : rules;
    expect(rule).toMatchObject({ userAgent: "*", allow: "/" });
    const disallowed =
      rule && "disallow" in rule ? [rule.disallow].flat() : ([] as string[]);
    expect(disallowed).toEqual(
      expect.arrayContaining(["/app", "/api", "/auth", "/internal", "/s/"]),
    );
    expect(file.sitemap).toBe("https://osirus-ai.com/sitemap.xml");
    expect(String(file.sitemap)).not.toContain("osirus.vercel.app");
  });

  it("keeps the vercel.app host and deployment URLs out of search", async () => {
    for (const host of [
      "osirus-ai.vercel.app",
      "osirus-abc123-team.vercel.app",
    ]) {
      requestHost.value = host;
      const file = await robots();
      expect(file.rules).toEqual([{ userAgent: "*", disallow: "/" }]);
      expect(file.sitemap).toBeUndefined();
    }
  });

  it("adds the Search Console tag only for a well-formed token", () => {
    expect(searchVerification(undefined)).toBeUndefined();
    expect(searchVerification("  ")).toBeUndefined();
    expect(searchVerification('"><script>')).toBeUndefined();
    expect(searchVerification(" AbC-123_xyz-TOKEN ")).toEqual({
      google: "AbC-123_xyz-TOKEN",
    });
  });

  it("sitemap lists the landing page and the legal pages", () => {
    const urls = sitemap().map((entry) => entry.url);
    expect(urls).toEqual([
      "https://osirus-ai.com/",
      "https://osirus-ai.com/sicherheit",
      "https://osirus-ai.com/legal/impressum",
      "https://osirus-ai.com/legal/privacy",
      "https://osirus-ai.com/legal/terms",
      "https://osirus-ai.com/legal/eula",
      "https://osirus-ai.com/legal/cookies",
      "https://osirus-ai.com/kuendigen",
    ]);
    expect(urls.join("")).not.toContain("osirus.vercel.app");
  });

  it("root metadata is indexable with OpenGraph; auth stays noindex", () => {
    expect(rootMetadata.robots).toMatchObject({ index: true, follow: true });
    expect(rootMetadata.openGraph).toMatchObject({ siteName: "Osirus AI" });
    expect((rootMetadata.metadataBase as URL).host).toBe("osirus-ai.com");
    expect(authMetadata.robots).toMatchObject({ index: false, follow: false });
  });

  it("refuses the unrelated osirus.vercel.app host", async () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://osirus.vercel.app");
    const { publicSiteUrl } = await import("../src/app/site-url");
    expect(publicSiteUrl().host).toBe("osirus-ai.com");
    vi.unstubAllEnvs();
  });
});
