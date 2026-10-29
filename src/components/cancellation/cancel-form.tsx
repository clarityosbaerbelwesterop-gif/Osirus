"use client";

import { useRef, useState } from "react";

// The cancellation page's form (§ 312k BGB): the declaration in one step,
// sent with "Jetzt kündigen", and the receipt the person can save or print.

type Receipt = {
  reference: string;
  receivedAt: string;
  outcome: string;
  text: string;
  mailSent: boolean;
};

const FIELD_ERROR: Record<string, string> = {
  name: "Bitte gib deinen Namen an.",
  email: "Bitte gib eine gültige E-Mail-Adresse an.",
  reason: "Bitte nenne den Grund für die außerordentliche Kündigung.",
  requestedEnd: "Bitte wähle ein Datum ab heute.",
};

const receivedLabel = (iso: string) =>
  `${new Date(iso).toLocaleString("de-DE", {
    timeZone: "Europe/Berlin",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })} Uhr`;

export function CancelForm({
  defaults,
  today,
  supportEmail,
}: {
  defaults: { name: string; email: string; signedIn: boolean };
  today: string;
  supportEmail: string;
}) {
  const [kind, setKind] = useState<"ordinary" | "extraordinary">("ordinary");
  const [timing, setTiming] = useState<"earliest" | "date">("earliest");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [invalid, setInvalid] = useState<string[]>([]);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const doneHeading = useRef<HTMLHeadingElement>(null);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const value = (name: string) => String(form.get(name) ?? "").trim();
    setBusy(true);
    setError(null);
    setInvalid([]);
    try {
      const response = await fetch("/api/kuendigen", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: value("name"),
          email: value("email"),
          contract: value("contract"),
          customerReference: value("customerReference") || undefined,
          kind,
          reason: kind === "extraordinary" ? value("reason") : undefined,
          timing,
          requestedEnd: timing === "date" ? value("requestedEnd") : undefined,
        }),
      });
      const body = (await response.json().catch(() => null)) as
        (Receipt & { error?: string; fields?: string[] }) | null;
      if (response.ok && body?.reference) {
        setReceipt(body);
        requestAnimationFrame(() => doneHeading.current?.focus());
        return;
      }
      if (body?.error === "invalid_request" && body.fields?.length) {
        setInvalid(body.fields);
        setError(
          body.fields
            .map((field) => FIELD_ERROR[field])
            .filter(Boolean)
            .join(" ") || "Bitte prüfe deine Angaben.",
        );
      } else if (body?.error === "rate_limited") {
        setError(
          "Zu viele Versuche in kurzer Zeit. Bitte warte eine Minute und sende erneut.",
        );
      } else {
        setError(
          `Deine Kündigung konnte gerade nicht gespeichert werden. Bitte versuche es erneut oder kündige per E-Mail an ${supportEmail}.`,
        );
      }
    } catch {
      setError(
        `Keine Verbindung. Bitte versuche es erneut oder kündige per E-Mail an ${supportEmail}.`,
      );
    } finally {
      setBusy(false);
    }
  };

  if (receipt) {
    const download = () => {
      const file = new Blob([receipt.text], {
        type: "text/plain;charset=utf-8",
      });
      const url = URL.createObjectURL(file);
      const link = document.createElement("a");
      link.href = url;
      link.download = `Kuendigung-${receipt.reference}.txt`;
      document.body.append(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    };
    return (
      <section className="cancel-done" aria-labelledby="cancel-done-heading">
        <h2 id="cancel-done-heading" ref={doneHeading} tabIndex={-1}>
          Deine Kündigung ist eingegangen
        </h2>
        <dl className="cancel-facts">
          <div>
            <dt>Eingang</dt>
            <dd>{receivedLabel(receipt.receivedAt)}</dd>
          </div>
          <div>
            <dt>Vorgangsnummer</dt>
            <dd>{receipt.reference}</dd>
          </div>
        </dl>
        <p>{receipt.outcome}</p>
        <p className="field-hint">
          {receipt.mailSent
            ? "Die Bestätigung haben wir dir gerade per E-Mail geschickt."
            : "Speichere diese Bestätigung. Die Bestätigung per E-Mail folgt."}
        </p>
        <pre className="cancel-receipt" aria-label="Bestätigung zum Speichern">
          {receipt.text}
        </pre>
        <div className="cancel-actions">
          <button type="button" className="btn btn-primary" onClick={download}>
            Bestätigung speichern
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => window.print()}
          >
            Drucken oder als PDF sichern
          </button>
        </div>
      </section>
    );
  }

  const invalidProps = (name: string) =>
    invalid.includes(name)
      ? { "aria-invalid": true as const, "aria-describedby": "cancel-error" }
      : {};

  return (
    <form className="cancel-form" onSubmit={submit}>
      {defaults.signedIn ? (
        <p className="field-hint">
          Du bist angemeldet. Wir ordnen die Kündigung deinem Konto zu.
        </p>
      ) : null}

      <label className="field">
        <span className="field-label">Vor- und Nachname</span>
        <input
          className="input"
          name="name"
          type="text"
          autoComplete="name"
          defaultValue={defaults.name}
          minLength={2}
          maxLength={120}
          required
          {...invalidProps("name")}
        />
      </label>

      <label className="field">
        <span className="field-label">E-Mail-Adresse</span>
        <span className="field-hint">
          Am besten die Adresse deines Osirus-Kontos. Dorthin schicken wir die
          Bestätigung.
        </span>
        <input
          className="input"
          name="email"
          type="email"
          autoComplete="email"
          defaultValue={defaults.email}
          maxLength={200}
          required
          {...invalidProps("email")}
        />
      </label>

      <label className="field">
        <span className="field-label">Welcher Vertrag?</span>
        <select className="select" name="contract" defaultValue="subscription">
          <option value="subscription">
            Osirus-Abonnement (Pro, Developer oder Ultra)
          </option>
          <option value="free">Kostenloses Osirus-Konto</option>
        </select>
      </label>

      <label className="field">
        <span className="field-label">
          Kunden- oder Rechnungsnummer (freiwillig)
        </span>
        <input
          className="input"
          name="customerReference"
          type="text"
          maxLength={120}
        />
      </label>

      <fieldset className="fieldset">
        <legend className="field-label">Art der Kündigung</legend>
        <label className="check">
          <input
            type="radio"
            name="kind"
            value="ordinary"
            checked={kind === "ordinary"}
            onChange={() => setKind("ordinary")}
          />
          Ordentliche Kündigung
        </label>
        <label className="check">
          <input
            type="radio"
            name="kind"
            value="extraordinary"
            checked={kind === "extraordinary"}
            onChange={() => setKind("extraordinary")}
          />
          Außerordentliche (fristlose) Kündigung aus wichtigem Grund
        </label>
      </fieldset>

      {kind === "extraordinary" ? (
        <label className="field">
          <span className="field-label">Kündigungsgrund</span>
          <textarea
            className="textarea"
            name="reason"
            rows={4}
            minLength={3}
            maxLength={2000}
            required
            {...invalidProps("reason")}
          />
        </label>
      ) : null}

      <fieldset className="fieldset">
        <legend className="field-label">Wann soll der Vertrag enden?</legend>
        <label className="check">
          <input
            type="radio"
            name="timing"
            value="earliest"
            checked={timing === "earliest"}
            onChange={() => setTiming("earliest")}
          />
          Zum nächstmöglichen Zeitpunkt
        </label>
        <label className="check">
          <input
            type="radio"
            name="timing"
            value="date"
            checked={timing === "date"}
            onChange={() => setTiming("date")}
          />
          Zu einem bestimmten Datum
        </label>
      </fieldset>

      {timing === "date" ? (
        <label className="field">
          <span className="field-label">Gewünschtes Vertragsende</span>
          <span className="field-hint">
            Ein Abonnement endet frühestens zum Ende der laufenden
            Abrechnungsperiode.
          </span>
          <input
            className="input"
            name="requestedEnd"
            type="date"
            min={today}
            required
            {...invalidProps("requestedEnd")}
          />
        </label>
      ) : null}

      {error ? (
        <div className="form-error" role="alert" id="cancel-error">
          <p>{error}</p>
        </div>
      ) : null}

      <p className="field-hint">
        Mit „Jetzt kündigen“ gibst du deine Kündigung ab. Du erhältst sofort
        eine Bestätigung mit Datum und Uhrzeit des Eingangs.
      </p>
      <button
        type="submit"
        className="btn btn-primary btn-lg cancel-submit"
        disabled={busy}
      >
        {busy ? "Wird gesendet …" : "Jetzt kündigen"}
      </button>
    </form>
  );
}
