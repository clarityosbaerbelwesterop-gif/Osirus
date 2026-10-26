import { PLANS, PRICE_TAX_NOTE } from "@/components/marketing/plans";
import { QuotaBarsLive } from "@/components/motion/quota-bars";
import {
  ManageSubscriptionButton,
  PlanCheckoutButton,
} from "./plan-checkout-button";

/** What the account has right now, as the settings page reads it. */
export type CurrentPlanInfo = {
  /** Plan label ("Pro", "Free"), or null without any plan. */
  label: string | null;
  status: string | null;
  periodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  /** No subscription ever: the first Pro subscription starts with a free week. */
  trialEligible: boolean;
  /** A billing account exists, so the customer portal can open. */
  canManage: boolean;
};

const dateDe = (iso: string) =>
  new Date(iso).toLocaleDateString("de-DE", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Europe/Berlin",
  });

/** Four paid plans. Prices stay off the public landing page. */
export function PlanCards({ proTrial = false }: { proTrial?: boolean }) {
  return (
    <div className="plan-offer">
      <p className="plan-tax">{PRICE_TAX_NOTE}</p>
      <ul className="price-grid">
        {PLANS.map((plan) => (
          <li key={plan.id} className="price-card">
            <h3>{plan.name}</h3>
            <p className="price-amount">
              {plan.price} <span>/ Monat</span>
            </p>
            {proTrial && plan.id === "pro" ? (
              <p className="price-trial">Die ersten 7 Tage kostenlos</p>
            ) : null}
            <PlanCheckoutButton planId={plan.id} planName={plan.name} />
          </li>
        ))}
      </ul>
    </div>
  );
}

export function CurrentPlan({ current }: { current: CurrentPlanInfo }) {
  const { label, status, periodEnd } = current;
  let detail = "";
  if (label && periodEnd && status === "trialing")
    detail = `Kostenlose Testphase bis ${dateDe(periodEnd)}.`;
  else if (label && periodEnd && current.cancelAtPeriodEnd)
    detail = `Gekündigt, läuft bis ${dateDe(periodEnd)}.`;
  else if (label && periodEnd && status === "active")
    detail = `Verlängert sich am ${dateDe(periodEnd)}.`;
  else if (status === "past_due")
    detail = "Die letzte Zahlung ist offen. Bitte Zahlungsmethode prüfen.";
  return (
    <div className="plan-current">
      <p>
        Aktueller Plan: <strong>{label ?? "Kein Plan aktiv"}</strong>
        {detail ? ` · ${detail}` : ""}
      </p>
      {current.canManage ? <ManageSubscriptionButton /> : null}
    </div>
  );
}

export function PlanSection({ current }: { current: CurrentPlanInfo }) {
  return (
    <section className="card settings-group" aria-labelledby="plan-heading">
      <h2 id="plan-heading">Plan</h2>
      <CurrentPlan current={current} />
      <QuotaBarsLive showNote />
      <PlanCards proTrial={current.trialEligible} />
    </section>
  );
}

const timeDe = (iso: string) =>
  new Date(iso).toLocaleString("de-DE", {
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Berlin",
  });

/**
 * Shown in Chat and Code only while the free tier is on and its quota is
 * empty: when it refills, or upgrading now.
 */
export function FreeQuotaPanel({
  availableAt,
}: {
  availableAt: string | null;
}) {
  return (
    <section className="quota-offer" aria-labelledby="quota-offer-title">
      <h2 id="quota-offer-title">
        Dein kostenloses Kontingent ist aufgebraucht.
      </h2>
      <div className="quota-choice">
        <p>
          {availableAt
            ? `Wieder verfügbar ab ${timeDe(availableAt)} Uhr`
            : "Wieder verfügbar, sobald sich das Zeitfenster erneuert"}
        </p>
        <p>oder jetzt upgraden.</p>
      </div>
      <PlanCards />
    </section>
  );
}
