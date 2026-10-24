import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  CurrentPlan,
  PlanCards,
  PlanSection,
} from "../src/components/settings/plan-offer";

const TAX = "Gemäß § 19 UStG wird keine Umsatzsteuer berechnet.";

describe("plan section", () => {
  it("lists the four end prices and a checkout button", () => {
    const html = renderToStaticMarkup(createElement(PlanCards));
    expect(html).toContain("Pro");
    expect(html).toContain("Developer");
    expect(html).toContain("Ultra 100");
    expect(html).toContain("Ultra 200");
    expect(html).toContain("20 €");
    expect(html).toContain("50 €");
    expect(html).toContain("100 €");
    expect(html).toContain("200 €");
    expect(html).toContain(TAX);
    expect(html).toContain("im Checkout");
    expect(html).not.toMatch(/inkl\. MwSt|zzgl\. MwSt|brutto|netto/i);
  });

  it("marks the current plan as a placeholder", () => {
    const on = renderToStaticMarkup(
      createElement(CurrentPlan, { freeTier: true }),
    );
    expect(on).toContain("Free");
    expect(on).toContain("Platzhalter");
    expect(on).not.toMatch(/\d/);
    const off = renderToStaticMarkup(
      createElement(CurrentPlan, { freeTier: false }),
    );
    expect(off).not.toContain("Free");
    expect(off).toContain("Platzhalter");
  });

  it("places the bars above the paid plans", () => {
    const html = renderToStaticMarkup(
      createElement(PlanSection, { freeTier: true }),
    );
    expect(html).toContain("Plan");
    expect(html).toContain("5-Stunden-Kontingent");
    expect(html).toContain("Wochenkontingent");
    expect(html.indexOf("5-Stunden-Kontingent")).toBeLessThan(
      html.indexOf("20 €"),
    );
    expect(html).toContain(TAX);
  });
});
