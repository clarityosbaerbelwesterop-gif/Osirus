import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const redirect = vi.hoisted(() =>
  vi.fn((url: string) => {
    throw new Error(`redirect:${url}`);
  }),
);

vi.mock("next/navigation", () => ({ redirect }));
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
import sitemap from "../src/app/sitemap";

describe("landing page", () => {
  it("renders the hero, both CTAs, the run illustration, and legal links", async () => {
    const html = renderToStaticMarkup(
      (await HomePage()) as ReturnType<typeof createElement>,
    );
    expect(html).toContain("Bots, Work und");
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
    expect(html).toContain('href="/legal/eula"');
    expect(html).toContain('href="/legal/cookies"');
    expect(html).not.toContain('href="#preise"');
    expect(html).toContain("Bald verfügbar");
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
    expect(data.url).toBe("https://osirus-ai.vercel.app/");
    expect(data.offers).toBeUndefined();
    expect(html).not.toContain('"price"');
  });
});

describe("seo surface", () => {
  it("robots.txt allows the public site and keeps app/api/auth out", () => {
    const rules = robots().rules;
    const rule = Array.isArray(rules) ? rules[0] : rules;
    expect(rule).toMatchObject({ userAgent: "*", allow: "/" });
    const disallowed =
      rule && "disallow" in rule ? [rule.disallow].flat() : ([] as string[]);
    expect(disallowed).toEqual(
      expect.arrayContaining(["/app", "/api", "/auth", "/internal"]),
    );
    expect(robots().sitemap).toBe("https://osirus-ai.vercel.app/sitemap.xml");
    expect(String(robots().sitemap)).not.toContain("osirus.vercel.app");
  });

  it("sitemap lists the landing page and the legal pages", () => {
    const urls = sitemap().map((entry) => entry.url);
    expect(urls).toEqual([
      "https://osirus-ai.vercel.app/",
      "https://osirus-ai.vercel.app/legal/impressum",
      "https://osirus-ai.vercel.app/legal/privacy",
      "https://osirus-ai.vercel.app/legal/terms",
      "https://osirus-ai.vercel.app/legal/eula",
      "https://osirus-ai.vercel.app/legal/cookies",
    ]);
  });

  it("root metadata is indexable with OpenGraph; auth stays noindex", () => {
    expect(rootMetadata.robots).toMatchObject({ index: true, follow: true });
    expect(rootMetadata.openGraph).toMatchObject({ siteName: "Osirus" });
    expect((rootMetadata.metadataBase as URL).host).toBe(
      "osirus-ai.vercel.app",
    );
    expect(authMetadata.robots).toMatchObject({ index: false, follow: false });
  });

  it("refuses the unrelated osirus.vercel.app host", async () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://osirus.vercel.app");
    const { publicSiteUrl } = await import("../src/app/site-url");
    expect(publicSiteUrl().host).toBe("osirus-ai.vercel.app");
    vi.unstubAllEnvs();
  });
});
