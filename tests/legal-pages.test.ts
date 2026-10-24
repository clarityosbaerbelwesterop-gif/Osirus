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

import ImpressumPage from "../src/app/legal/impressum/page";
import LegalLayout from "../src/app/legal/layout";
import PrivacyPage from "../src/app/legal/privacy/page";
import TermsPage from "../src/app/legal/terms/page";

function render(component: () => ReactNode) {
  return renderToStaticMarkup(createElement(component));
}

describe("legal pages", () => {
  it("impressum cites § 5 DDG and carries the operator's complete, real identity", () => {
    const html = render(ImpressumPage);
    expect(html).toContain("§ 5 DDG");
    expect(html).not.toContain("TMG");
    expect(html).toContain("Bärbel Westerop");
    expect(html).toContain("ClarityCompassAI");
    expect(html).toContain("Drinhausstraße 22");
    expect(html).toContain("47447 Moers");
    expect(html).toContain('href="tel:+4916094486598"');
    expect(html).toContain("mailto:clarityos.baerbelwesterop@gmail.com");
    expect(html).toContain("§ 18 Abs. 2 MStV");
    expect(html).toContain("§ 36 VSBG");
    // The EU ODR platform was discontinued on 20 July 2025; never link it.
    expect(html).not.toContain("ec.europa.eu/consumers/odr");
    // A published imprint must not show placeholders or a draft banner.
    expect(html).not.toContain("[[OPERATOR:");
    expect(html).not.toContain("DRAFT");
  });

  it("privacy notice carries the GDPR structure and the real cookie inventory", () => {
    const html = render(PrivacyPage);
    expect(html).toContain("Art. 6(1)(b)");
    expect(html).toContain("Art. 15");
    expect(html).toContain("Art. 77");
    expect(html).toContain("LDI NRW");
    // Cookie claims must match src/lib/ui/preferences.ts.
    expect(html).toContain("§ 25 Abs. 2 TDDDG");
    expect(html).toContain("osirus-theme");
    expect(html).toContain("osirus-sidebar");
    // Processor inventory and transfer basis.
    expect(html).toContain("Neon");
    expect(html).toContain("Vercel");
    expect(html).toContain("Data Privacy Framework");
    expect(html).toContain("eu-central-1");
    // No banner claim is only lawful while no non-essential storage exists.
    expect(html).toContain("no consent banner");
  });

  it("terms are truthful about billing and choose German law with a consumer carve-out", () => {
    const html = render(TermsPage);
    // There is no payment integration; the page must not pretend otherwise.
    expect(html).toContain("No payment is currently taken");
    expect(html).toContain("Federal Republic of Germany");
    expect(html).toContain("cardinal duty");
    expect(html).toContain("[[OPERATOR:");
  });

  it("legal layout links all four pages so they stay reachable within two clicks", () => {
    const html = renderToStaticMarkup(
      createElement(LegalLayout, null, createElement("div")),
    );
    expect(html).toContain('href="/legal/impressum"');
    expect(html).toContain('href="/legal/privacy"');
    expect(html).toContain('href="/legal/terms"');
    expect(html).toContain('href="/legal/cookies"');
  });
});
