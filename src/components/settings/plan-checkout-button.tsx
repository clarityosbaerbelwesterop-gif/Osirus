"use client";

import { useState } from "react";

function billingError(status: number) {
  if (status === 401) return "Bitte melde dich erneut an.";
  if (status === 429) return "Zu viele Versuche. Bitte kurz warten.";
  if (status === 503)
    return "Die Buchung ist gerade nicht verfügbar. Bitte später erneut versuchen.";
  return "Der Checkout konnte nicht geöffnet werden. Bitte erneut versuchen.";
}

/** Opens the billing portal: payment method, invoices, plan change, cancel. */
export function ManageSubscriptionButton() {
  const [note, setNote] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function open() {
    setPending(true);
    setNote(null);
    try {
      const response = await fetch("/api/billing/portal", { method: "POST" });
      const body = (await response.json().catch(() => null)) as {
        url?: string;
      } | null;
      if (!response.ok || !body?.url) {
        setNote(billingError(response.status));
        return;
      }
      window.location.assign(body.url);
    } catch {
      setNote(billingError(0));
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <button
        type="button"
        className="btn btn-secondary"
        onClick={() => void open()}
        disabled={pending}
      >
        {pending ? "Öffnet…" : "Abo und Rechnungen verwalten"}
      </button>
      {note ? <p className="plan-tax">{note}</p> : null}
    </>
  );
}

/** Maps the display id onto the checkout plan name from PR #84. */
function checkoutPlan(id: string) {
  if (id === "ultra-100") return "ultra_100";
  if (id === "ultra-200") return "ultra_200";
  return id;
}

export function PlanCheckoutButton({
  planId,
  planName,
}: {
  planId: string;
  planName: string;
}) {
  const [note, setNote] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function start() {
    setPending(true);
    setNote(null);
    try {
      const response = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ plan: checkoutPlan(planId) }),
      });
      const body = (await response.json().catch(() => null)) as {
        url?: string;
      } | null;
      if (!response.ok || !body?.url) {
        setNote(billingError(response.status));
        return;
      }
      window.location.assign(body.url);
    } catch {
      setNote(billingError(0));
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <button
        type="button"
        className="btn btn-secondary"
        onClick={() => void start()}
        disabled={pending}
      >
        {pending ? "Weiter…" : `${planName} im Checkout`}
      </button>
      {note ? <p className="plan-tax">{note}</p> : null}
    </>
  );
}
