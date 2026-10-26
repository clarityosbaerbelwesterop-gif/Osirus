import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  CurrentPlan,
  PlanCards,
  PlanSection,
  type CurrentPlanInfo,
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

  const base: CurrentPlanInfo = {
    label: "Pro",
    status: "active",
    periodEnd: "2026-11-26T10:00:00.000Z",
    cancelAtPeriodEnd: false,
    trialEligible: false,
    canManage: true,
  };
  const current = (patch: Partial<CurrentPlanInfo> = {}) =>
    renderToStaticMarkup(
      createElement(CurrentPlan, { current: { ...base, ...patch } }),
    );

  it("shows the real plan, its next date and the billing portal", () => {
    const html = current();
    expect(html).toContain("<strong>Pro</strong>");
    expect(html).toContain("Verlängert sich am 26. November 2026.");
    expect(html).toContain("Abo und Rechnungen verwalten");
    expect(html).not.toContain("Platzhalter");
    expect(current({ status: "trialing" })).toContain(
      "Kostenlose Testphase bis 26. November 2026.",
    );
    expect(current({ cancelAtPeriodEnd: true })).toContain(
      "Gekündigt, läuft bis 26. November 2026.",
    );
    const free = current({
      label: "Free",
      status: null,
      periodEnd: null,
      canManage: false,
    });
    expect(free).toContain("<strong>Free</strong>");
    expect(free).not.toContain("verwalten");
    expect(current({ label: null, status: null, canManage: false })).toContain(
      "Kein Plan aktiv",
    );
  });

  it("offers the free Pro week only to accounts that never subscribed", () => {
    expect(
      renderToStaticMarkup(createElement(PlanCards, { proTrial: true })),
    ).toContain("Die ersten 7 Tage kostenlos");
    expect(renderToStaticMarkup(createElement(PlanCards))).not.toContain(
      "7 Tage",
    );
  });

  it("places the bars above the paid plans", () => {
    const html = renderToStaticMarkup(
      createElement(PlanSection, {
        current: {
          label: "Free",
          status: null,
          periodEnd: null,
          cancelAtPeriodEnd: false,
          trialEligible: true,
          canManage: false,
        },
      }),
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
