import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// Legal pages use next/link; outside the app router we render it as a plain
// anchor so the markup can be asserted on.
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

const redirect = vi.hoisted(() =>
  vi.fn((url: string) => {
    throw new Error(`redirect:${url}`);
  }),
);

vi.mock("next/navigation", () => ({ redirect }));
vi.mock("@/lib/auth/server", () => ({
  authConfigured: true,
  auth: { getSession: vi.fn(async () => ({ data: { user: null } })) },
}));

import CookiesPage, { metadata } from "../src/app/legal/cookies/page";
import HomePage from "../src/app/page";
import sitemap from "../src/app/sitemap";

describe("cookies page", () => {
  it("renders the full storage inventory matching src/lib/ui/preferences.ts", () => {
    const html = renderToStaticMarkup(createElement(CookiesPage));
    expect(html).toContain("osirus-theme");
    expect(html).toContain("osirus-sidebar");
    expect(html).toContain("osirus-mode");
    expect(html).toContain("Neon Auth session cookie");
    // Durations and flags must match writePreference in preferences.ts.
    expect(html).toContain("1 year");
    expect(html).toContain("SameSite=Lax");
    expect(html).toContain("HttpOnly");
    // No Web Storage is used anywhere in src/; the page must say so.
    expect(html).toContain("localStorage");
    expect(html).toContain("sessionStorage");
  });

  it("cites § 25 TDDDG and explains why no consent banner is required", () => {
    const html = renderToStaticMarkup(createElement(CookiesPage));
    expect(html).toContain("§ 25 Abs. 2 TDDDG");
    expect(html).toContain("no consent banner is required");
    // Future non-essential storage requires prior consent.
    expect(html).toContain("§ 25 Abs. 1 TDDDG");
    expect(html).toContain("prior consent");
  });

  it("keeps operator-dependent facts marked and the page public", () => {
    const html = renderToStaticMarkup(createElement(CookiesPage));
    expect(html).toContain("[[OPERATOR:");
    expect(html).toContain("Bärbel Westerop");
    expect(html).toContain("ClarityCompassAI");
    expect(html).toContain("47447 Moers");
    expect(metadata.title).toBe("Cookies");
    expect(metadata.description).toContain("§ 25 TDDDG");
    expect(metadata.robots).toMatchObject({ index: true });
  });

  it("landing footer links the cookies page", async () => {
    const html = renderToStaticMarkup(
      (await HomePage()) as ReturnType<typeof createElement>,
    );
    expect(html).toContain('href="/legal/cookies"');
  });

  it("sitemap includes /legal/cookies", () => {
    const urls = sitemap().map((entry) => entry.url);
    expect(urls).toContain("https://osirus.vercel.app/legal/cookies");
  });
});
