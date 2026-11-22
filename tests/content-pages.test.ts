import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

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

import LegalLayout from "../src/app/legal/layout";
import ApprovalTeamPage, {
  metadata as approvalMetadata,
} from "../src/app/ki-team-freigabe/page";
import OsirusKiPage, {
  metadata as osirusKiMetadata,
} from "../src/app/osirus-ki/page";
import AboutPage, {
  metadata as aboutMetadata,
} from "../src/app/ueber-uns/page";

const FORBIDDEN =
  /ROUGE|QUASNIR|DARUS|HRB|USt-ID|Umsatzsteuer-Identifikationsnummer|Investor|Kundinnen und Kunden|Kundenanzahl|ARR|MRR/i;

function render(page: () => ReactNode) {
  return renderToStaticMarkup(
    createElement(LegalLayout, null, createElement(page)),
  );
}

describe("public content pages", () => {
  it("about page states only confirmed company facts", () => {
    const html = render(AboutPage);
    expect(aboutMetadata.title).toBe("Über ClarityCompassAI und Osirus");
    expect(String(aboutMetadata.description)).toMatch(/Moers/);
    expect(html).toContain("ClarityCompassAI");
    expect(html).toContain("2. Januar 2025");
    expect(html).toContain("Moers");
    expect(html).toContain("Nordrhein-Westfalen");
    expect(html).toContain("Bärbel Westerop");
    expect(html).toContain("Mark Quasnitza");
    expect(html).toContain("eigenfinanziert");
    expect(html).toContain("Frankfurt");
    expect(html).toContain('href="/legal/impressum"');
    expect(html).toContain('href="/osirus-ki"');
    expect(html).toContain('href="/ki-team-freigabe"');
    expect(html).not.toMatch(FORBIDDEN);
    expect(html).not.toMatch(/HRB\s*\d/i);
  });

  it("Osirus KI and Freigabe pages have unique titles and no invented claims", () => {
    const ki = render(OsirusKiPage);
    const freigabe = render(ApprovalTeamPage);
    expect(osirusKiMetadata.title).toMatch(/Osirus KI/);
    expect(approvalMetadata.title).toMatch(/Freigabeknopf/);
    expect(osirusKiMetadata.title).not.toEqual(approvalMetadata.title);
    expect(osirusKiMetadata.description).not.toEqual(
      approvalMetadata.description,
    );
    expect(ki).toContain("Osirus KI");
    expect(ki).toContain("nummerierte Quellen");
    expect(ki).toContain('href="/ueber-uns"');
    expect(ki).toContain('href="/ki-team-freigabe"');
    expect(freigabe).toContain("Freigabeknopf");
    expect(freigabe).toContain("Plan");
    expect(freigabe).toContain("Prüfung");
    expect(freigabe).toContain("Freigabe");
    expect(freigabe).toContain('href="/osirus-ki"');
    expect(freigabe).toContain('href="/sicherheit"');
    expect(ki).not.toMatch(FORBIDDEN);
    expect(freigabe).not.toMatch(FORBIDDEN);
  });

  it("legal layout footer lists the new content pages", () => {
    const html = renderToStaticMarkup(
      createElement(LegalLayout, null, createElement("div")),
    );
    expect(html).toContain('href="/ueber-uns"');
    expect(html).toContain('href="/osirus-ki"');
    expect(html).toContain('href="/ki-team-freigabe"');
    expect(html).toContain('href="/kuendigen"');
  });
});
