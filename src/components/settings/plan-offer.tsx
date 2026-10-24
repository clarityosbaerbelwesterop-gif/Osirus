import { PLANS, PRICE_TAX_NOTE } from "@/components/marketing/plans";
import { PLACEHOLDER_QUOTA, QuotaBars } from "@/components/motion/quota-bars";
import { PlanCheckoutButton } from "./plan-checkout-button";

/** Four paid plans. Prices stay off the public landing page. */
export function PlanCards() {
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
            <PlanCheckoutButton planId={plan.id} planName={plan.name} />
          </li>
        ))}
      </ul>
    </div>
  );
}

export function CurrentPlan({ freeTier }: { freeTier: boolean }) {
  return (
    <p className="plan-current">
      Aktueller Plan: {freeTier ? "Free" : "wird vom Server geliefert"}.
      Platzhalter, bis der Server den Plan bestätigt.
      {freeTier
        ? " Der Umfang des kostenlosen Kontingents steht hier, sobald er geliefert wird."
        : ""}
    </p>
  );
}

export function PlanSection({ freeTier }: { freeTier: boolean }) {
  return (
    <section className="card settings-group" aria-labelledby="plan-heading">
      <h2 id="plan-heading">Plan</h2>
      <CurrentPlan freeTier={freeTier} />
      <QuotaBars
        fiveHourRatio={PLACEHOLDER_QUOTA.fiveHourRatio}
        weekRatio={PLACEHOLDER_QUOTA.weekRatio}
        fiveHourRefill={PLACEHOLDER_QUOTA.fiveHourRefill}
        note={PLACEHOLDER_QUOTA.note}
      />
      <PlanCards />
    </section>
  );
}

/**
 * Shown in Chat and Work only while the free tier is on and its quota is
 * empty. X is not a measured duration.
 */
export function FreeQuotaPanel() {
  return (
    <section className="quota-offer" aria-labelledby="quota-offer-title">
      <h2 id="quota-offer-title">
        Dein kostenloses Kontingent ist aufgebraucht.
      </h2>
      <div className="quota-choice">
        <p>Wieder verfügbar in X h.</p>
        <p>oder jetzt upgraden.</p>
      </div>
      <p className="plan-tax">
        X ist ein Platzhalter, bis der Server die Dauer liefert.
      </p>
      <PlanCards />
    </section>
  );
}
