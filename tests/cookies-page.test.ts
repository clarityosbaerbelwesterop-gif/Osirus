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
    expect(html).toContain("Neon Auth");
    // Durations and flags must match writePreference in preferences.ts.
    expect(html).toContain("1 Jahr");
    expect(html).toContain("SameSite=Lax");
    expect(html).toContain("HttpOnly");
    // No Web Storage is used anywhere in src/; the page must say so.
    expect(html).toContain("localStorage");
    expect(html).toContain("sessionStorage");
    expect(html).toContain("osirus-consent");
    expect(html).toContain("osirus-lab-model");
    expect(html).toContain("osirus-interaction");
  });

  it("cites § 25 TDDDG and gates optional cookies on consent", () => {
    const html = renderToStaticMarkup(createElement(CookiesPage));
    expect(html).toContain("§ 25 Abs. 2 TDDDG");
    expect(html).toContain("§ 25 Abs. 1 TDDDG");
    expect(html).toContain("Nur notwendige");
    expect(html).toContain("Alle akzeptieren");
    expect(html).not.toContain("no consent banner");
  });

  it("names the operator without placeholders and stays public", () => {
    const html = renderToStaticMarkup(createElement(CookiesPage));
    expect(html).not.toContain("[[OPERATOR:");
    expect(html).not.toContain("USt-IdNr");
    expect(html).toContain("Bärbel Westerop");
    expect(html).toContain("ClarityCompassAI");
    expect(html).toContain("47447 Moers");
    expect(html).toContain("Drinhausstraße 22");
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
    vi.stubEnv("OSIRUS_PUBLIC_BASE_URL", "https://app.example.test");
    const urls = sitemap().map((entry) => entry.url);
    expect(urls).toContain("https://osirus-ai.vercel.app/legal/cookies");
    expect(urls.join(" ")).not.toContain("osirus.vercel.app");
  });
});
