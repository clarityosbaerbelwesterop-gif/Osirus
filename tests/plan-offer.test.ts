import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  CurrentPlan,
  PlanCards,
} from "../src/components/settings/plan-offer";
import { PlanInfo } from "../src/lib/product/settings";

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
    const freePlan: PlanInfo = { plan: null, status: null, currentPeriodEnd: null, cancelAtPeriodEnd: false };
    const on = renderToStaticMarkup(
      createElement(CurrentPlan, { planInfo: freePlan }),
    );
    expect(on).toContain("Free");
    expect(on).toContain("kein Abo");
    expect(on).not.toMatch(/\d/);

    const paidPlan: PlanInfo = { plan: "pro", status: "active", currentPeriodEnd: "2025-12-31T23:59:59.000Z", cancelAtPeriodEnd: false };
    const off = renderToStaticMarkup(
      createElement(CurrentPlan, { planInfo: paidPlan }),
    );
    expect(off).toContain("Pro");
    expect(off).toContain("Aktiv");
    expect(off).toContain("2025");
  });
});