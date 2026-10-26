import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`redirect:${url}`);
  },
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

import { isFreeTierEnabled } from "../src/app/free-tier";
import HomePage from "../src/app/page";
import { FreeQuotaPanel } from "../src/components/settings/plan-offer";

describe("free tier switch", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("is on unless the variable is exactly false", () => {
    vi.stubEnv("OSIRUS_FREE_TIER_ENABLED", "");
    expect(isFreeTierEnabled()).toBe(true);
    vi.stubEnv("OSIRUS_FREE_TIER_ENABLED", "true");
    expect(isFreeTierEnabled()).toBe(true);
    vi.stubEnv("OSIRUS_FREE_TIER_ENABLED", "FALSE");
    expect(isFreeTierEnabled()).toBe(true);
    vi.stubEnv("OSIRUS_FREE_TIER_ENABLED", "false");
    expect(isFreeTierEnabled()).toBe(false);
  });

  it("uses Kostenlos starten on the landing while the tier is on", async () => {
    vi.stubEnv("OSIRUS_FREE_TIER_ENABLED", "true");
    const html = renderToStaticMarkup(
      (await HomePage()) as ReturnType<typeof createElement>,
    );
    expect(html).toContain("Kostenlos starten");
    expect(html).not.toContain("Konto erstellen");
    expect(html).toContain("begrenztes kostenloses Kontingent");
    expect(html).not.toContain("für immer");
  });

  it("uses Konto erstellen and hides the free claim when the tier is off", async () => {
    vi.stubEnv("OSIRUS_FREE_TIER_ENABLED", "false");
    const html = renderToStaticMarkup(
      (await HomePage()) as ReturnType<typeof createElement>,
    );
    expect(html).toContain("Konto erstellen");
    expect(html).not.toContain("Kostenlos starten");
    expect(html).not.toContain("kostenloses Kontingent");
    expect(html).not.toContain("20 €");
  });
});

describe("empty free quota panel", () => {
  it("keeps waiting and upgrading equally visible and does not invent a duration", () => {
    const html = renderToStaticMarkup(
      createElement(FreeQuotaPanel, {
        availableAt: "2026-10-26T15:30:00.000Z",
      }),
    );
    expect(html).toContain("Dein kostenloses Kontingent ist aufgebraucht.");
    // The real refill time in Berlin, never a placeholder.
    expect(html).toContain("Wieder verfügbar ab Mo., 16:30 Uhr");
    expect(html).toContain("oder jetzt upgraden.");
    expect(html).not.toMatch(/Platzhalter|\bX\b/);
    expect(html).toContain("20 €");
    expect(html).toContain(
      "Gemäß § 19 UStG wird keine Umsatzsteuer berechnet.",
    );
    const unknown = renderToStaticMarkup(
      createElement(FreeQuotaPanel, { availableAt: null }),
    );
    expect(unknown).toContain("sobald sich das Zeitfenster erneuert");
  });
});
