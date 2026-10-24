"use client";

import { useState } from "react";

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
      if (!response.ok) {
        setNote("Die Buchung ist noch nicht verbunden.");
        return;
      }
      const body = (await response.json()) as { url?: string };
      if (!body.url) {
        setNote("Die Buchung ist noch nicht verbunden.");
        return;
      }
      window.location.assign(body.url);
    } catch {
      setNote("Die Buchung ist noch nicht verbunden.");
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
