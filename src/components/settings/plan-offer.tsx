import { PLANS, PRICE_TAX_NOTE } from "@/components/marketing/plans";
import { PlanCheckoutButton } from "./plan-checkout-button";
import { planInfo, PlanInfo } from "@/lib/product/settings";
import { getFreeQuotaUsage } from "@/app/free-tier";

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

export function CurrentPlan({ planInfo }: { planInfo: PlanInfo }) {
  const plan = planInfo.plan;
  const status = planInfo.status;
  const periodEnd = planInfo.currentPeriodEnd;

  if (!plan) {
    return (
      <p className="plan-current">
        Aktueller Plan: Free (kein Abo).
      </p>
    );
  }

  const planDetails = PLANS.find((p) => p.id === plan);
  const planName = planDetails?.name ?? plan;

  let statusText = "";
  if (status === "active") {
    statusText = "Aktiv";
  } else if (status === "past_due") {
    statusText = "Zahlung fehlgeschlagen";
  } else if (status === "canceled") {
    statusText = "Gekündigt";
  } else if (status === "trialing") {
    statusText = "Testphase";
  } else {
    statusText = status ?? "Unbekannt";
  }

  let periodText = "";
  if (periodEnd) {
    const date = new Date(periodEnd);
    periodText = `Läuft am ${date.toLocaleDateString("de-DE")} ${planInfo.cancelAtPeriodEnd ? "aus" : "ab"}.`;
  }

  return (
    <div className="plan-current">
      <p><strong>Aktueller Plan:</strong> {planName}</p>
      <p><strong>Status:</strong> {statusText}</p>
      {periodText && <p>{periodText}</p>}
    </div>
  );
}

function QuotaBarsReal({
  fiveHour,
  weekly,
}: {
  fiveHour: { used: number; limit: number; remaining: number; resetsAt: string };
  weekly: { used: number; limit: number; remaining: number; resetsAt: string };
}) {
  const fiveHourRatio = fiveHour.limit > 0 ? fiveHour.used / fiveHour.limit : 0;
  const weekRatio = weekly.limit > 0 ? weekly.used / weekly.limit : 0;

  const fiveHourRefill = new Date(fiveHour.resetsAt).toLocaleTimeString("de-DE", {
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <div className="quota-bars">
      <div className="quota-bar">
        <div className="quota-bar-header">
          <span>5-Stunden-Kontingent</span>
          <span className="quota-bar-ratio">
            {fiveHour.used} / {fiveHour.limit} Aufrufe
          </span>
        </div>
        <div className="quota-bar-track" role="progressbar" aria-valuenow={Math.round(fiveHourRatio * 100)} aria-valuemin={0} aria-valuemax={100} aria-label="5-Stunden-Kontingent">
          <div
            className="quota-bar-fill"
            style={{ width: `${Math.min(100, fiveHourRatio * 100)}%` }}
          />
        </div>
        <p className="quota-bar-note">
          Füllt sich wieder um {fiveHourRefill}.
        </p>
      </div>
      <div className="quota-bar">
        <div className="quota-bar-header">
          <span>Wochenkontingent</span>
          <span className="quota-bar-ratio">
            {weekly.used} / {weekly.limit} Aufrufe
          </span>
        </div>
        <div className="quota-bar-track" role="progressbar" aria-valuenow={Math.round(weekRatio * 100)} aria-valuemin={0} aria-valuemax={100} aria-label="Wochenkontingent">
          <div
            className="quota-bar-fill"
            style={{ width: `${Math.min(100, weekRatio * 100)}%` }}
          />
        </div>
        <p className="quota-bar-note">
          Füllt sich wieder am {new Date(weekly.resetsAt).toLocaleDateString("de-DE")}.
        </p>
      </div>
    </div>
  );
}

export async function PlanSection({ freeTier }: { freeTier: boolean }) {
  const { identity } = await import("@/lib/product/session").then((m) =>
    m.requireProductSession(),
  );
  const [plan, quota] = await Promise.all([
    planInfo(identity),
    freeTier ? getFreeQuotaUsage() : Promise.resolve(null),
  ]);

  return (
    <section className="card settings-group" aria-labelledby="plan-heading">
      <h2 id="plan-heading">Plan</h2>
      <CurrentPlan planInfo={plan} />
      {quota ? (
        <QuotaBarsReal fiveHour={quota.fiveHour} weekly={quota.weekly} />
      ) : (
        <p className="plan-tax">Kein kostenloses Kontingent konfiguriert.</p>
      )}
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