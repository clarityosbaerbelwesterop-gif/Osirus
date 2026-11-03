"use client";

import { Download, Trash2 } from "lucide-react";
import { useState } from "react";

// Art. 15/20 and Art. 17 DSGVO as two buttons: take a copy, or delete.

export function PrivacyControls() {
  const [confirm, setConfirm] = useState("");
  const [endSubscription, setEndSubscription] = useState(false);
  const [needsSubscriptionConsent, setNeedsSubscriptionConsent] =
    useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const remove = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/account", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirm, endSubscription }),
      });
      const body = (await response.json().catch(() => null)) as {
        error?: string;
        message?: string;
      } | null;
      if (response.ok) {
        // A full reload: the session no longer exists.
        window.location.replace(window.location.origin);
        return;
      }
      if (body?.error === "subscription_active")
        setNeedsSubscriptionConsent(true);
      setMessage(
        body?.message ??
          "Das Konto konnte nicht gelöscht werden. Bitte später erneut versuchen.",
      );
    } catch {
      setMessage("Keine Verbindung. Bitte erneut versuchen.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack">
      <div className="stack">
        <h3 className="field-label">Deine Daten herunterladen</h3>
        <p className="muted">
          Eine Kopie aller Daten, die Osirus zu dir speichert: Profil, Chats,
          Bots, Läufe, Gedächtnis, Dateien (Text), Verbindungen ohne Tokens,
          Abo und Nutzung. Als JSON-Datei (Art. 15 und 20 DSGVO).
        </p>
        <div>
          <a className="btn btn-secondary btn-sm" href="/api/account/export" download>
            <Download size={14} aria-hidden="true" /> Daten herunterladen
          </a>
        </div>
      </div>
      <div className="stack">
        <h3 className="field-label">Konto löschen</h3>
        <p className="muted">
          Löscht dein Konto, deine Anmeldung und alle Inhalte sofort und
          endgültig (Art. 17 DSGVO). Aufbewahrt bleiben nur, was das Gesetz
          verlangt: eine eingegangene Kündigungserklärung als Nachweis und
          Rechnungen bei Stripe.
        </p>
        <label className="field">
          <span className="field-label">Zum Bestätigen LÖSCHEN eingeben</span>
          <input
            className="input"
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
        </label>
        {needsSubscriptionConsent ? (
          <label className="row row-wrap">
            <input
              type="checkbox"
              checked={endSubscription}
              onChange={(event) => setEndSubscription(event.target.checked)}
            />
            <span>Mein laufendes Abo endet damit sofort, ohne Erstattung.</span>
          </label>
        ) : null}
        <div>
          <button
            type="button"
            className="btn btn-danger btn-sm"
            disabled={
              busy ||
              confirm !== "LÖSCHEN" ||
              (needsSubscriptionConsent && !endSubscription)
            }
            onClick={() => void remove()}
          >
            <Trash2 size={14} aria-hidden="true" />
            {busy ? "Wird gelöscht …" : "Konto endgültig löschen"}
          </button>
        </div>
        {message ? (
          <p className="field-error" role="alert">
            {message}
          </p>
        ) : null}
      </div>
    </div>
  );
}
