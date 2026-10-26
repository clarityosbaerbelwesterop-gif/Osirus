import type { Route } from "next";

export const PLANS = [
  {
    id: "pro",
    name: "Pro",
    price: "20 €",
    href: "/auth/sign-up?plan=pro" as Route,
  },
  {
    id: "developer",
    name: "Developer",
    price: "50 €",
    href: "/auth/sign-up?plan=developer" as Route,
  },
  {
    id: "ultra-100",
    name: "Ultra 100",
    price: "100 €",
    href: "/auth/sign-up?plan=ultra-100" as Route,
  },
  {
    id: "ultra-200",
    name: "Ultra 200",
    price: "200 €",
    href: "/auth/sign-up?plan=ultra-200" as Route,
  },
] as const;

/** Kleinunternehmer, § 19 UStG. No VAT line, no “inkl.” or “zzgl.”. */
export const PRICE_TAX_NOTE =
  "Gemäß § 19 UStG wird keine Umsatzsteuer berechnet.";

export type PlanId = (typeof PLANS)[number]["id"];

export function planById(id: string | undefined) {
  return PLANS.find((plan) => plan.id === id) ?? null;
}
