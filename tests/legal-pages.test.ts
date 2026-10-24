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

  it("privacy notice carries the GDPR structure and names the real recipients", () => {
    const html = render(PrivacyPage);
    expect(html).toContain("Art. 6 Abs. 1 lit. b DSGVO");
    expect(html).toContain("Art. 15");
    expect(html).toContain("Art. 77");
    expect(html).toContain("LDI NRW");
    expect(html).toContain("§ 25");
    expect(html).toContain("Neon");
    expect(html).toContain("Vercel");
    expect(html).toContain("GitHub");
    expect(html).toContain("Stripe");
    expect(html).toContain("UNOROUTER");
    expect(html).toContain("Anthropic");
    expect(html).toContain("OpenAI");
    expect(html).toContain("eu-central-1");
    expect(html).toContain("Drinhausstraße 22");
    expect(html).not.toContain("[[OPERATOR:");
    expect(html).not.toContain("USt-IdNr");
    expect(html).not.toContain("osirus.vercel.app");
  });

  it("terms state the four end prices, both quota windows, and German withdrawal rules", () => {
    const html = render(TermsPage);
    expect(html).toContain("Planübersicht");
    expect(html).toContain("Checkout");
    expect(html).toContain("Endpreise");
    expect(html).not.toContain("20 €");
    expect(html).toContain(
      "Gemäß § 19 UStG wird keine Umsatzsteuer berechnet.",
    );
    expect(html).not.toMatch(/inkl\. MwSt|zzgl\. MwSt|brutto|netto|USt-IdNr/i);
    expect(html).toContain("5-Stunden-Kontingent");
    expect(html).toContain("Wochenkontingent");
    expect(html).toContain("begrenztes kostenloses Kontingent");
    expect(html).not.toContain("wird nicht angeboten");
    expect(html).toContain("Muster-Widerrufsformular");
    expect(html).toContain("Bundesrepublik Deutschland");
    expect(html).not.toContain("[[OPERATOR:");
    expect(html).not.toContain("osirus.vercel.app");
  });

  it("legal layout links every public legal page", () => {
    const html = renderToStaticMarkup(
      createElement(LegalLayout, null, createElement("div")),
    );
    expect(html).toContain('href="/legal/impressum"');
    expect(html).toContain('href="/legal/privacy"');
    expect(html).toContain('href="/legal/terms"');
    expect(html).toContain('href="/legal/eula"');
    expect(html).toContain('href="/legal/cookies"');
  });
});
