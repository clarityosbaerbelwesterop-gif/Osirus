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
    expect(html).toContain("finishes the work");
    expect(html).toContain('href="/auth/sign-up"');
    expect(html).toContain('href="/auth/sign-in"');
    expect(html).toContain('href="/legal/impressum"');
    expect(html).toContain('href="/legal/privacy"');
    expect(html).toContain('href="/legal/terms"');
    expect(html).toContain('href="/legal/cookies"');
    // The animated run card is decorative and labelled as such.
    expect(html).toContain('role="img"');
    expect(html).toContain("verified");
  });

  it("ships parseable SoftwareApplication structured data", async () => {
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
    expect(data.offers.price).toBe("0");
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
    expect(robots().sitemap).toBe("https://osirus.vercel.app/sitemap.xml");
  });

  it("sitemap lists the landing page and the four legal pages", () => {
    const urls = sitemap().map((entry) => entry.url);
    expect(urls).toEqual([
      "https://osirus.vercel.app/",
      "https://osirus.vercel.app/legal/impressum",
      "https://osirus.vercel.app/legal/privacy",
      "https://osirus.vercel.app/legal/terms",
      "https://osirus.vercel.app/legal/cookies",
    ]);
  });

  it("root metadata is indexable with OpenGraph; auth stays noindex", () => {
    expect(rootMetadata.robots).toMatchObject({ index: true, follow: true });
    expect(rootMetadata.openGraph).toMatchObject({ siteName: "Osirus" });
    expect((rootMetadata.metadataBase as URL).host).toBe("osirus.vercel.app");
    expect(authMetadata.robots).toMatchObject({ index: false, follow: false });
  });
});
