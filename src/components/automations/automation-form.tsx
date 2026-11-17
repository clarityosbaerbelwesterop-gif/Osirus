"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { SCHEDULER_WINDOW_HOUR_UTC } from "@/lib/automations/schedule";
import { toolLabel } from "@/lib/ui/labels";
import { Field } from "../ui/field";

const ACTION_TOOLS = [
  "workspace.write",
  "workspace.replace",
  "workspace.rename",
  "workspace.delete",
  "workspace.run",
  "sandbox.write",
  "sandbox.preview",
  "git.deliver",
];

const WEEKDAYS = [
  "Sonntag",
  "Montag",
  "Dienstag",
  "Mittwoch",
  "Donnerstag",
  "Freitag",
  "Samstag",
];

const ERRORS: Record<string, string> = {
  invalid_request:
    "Prüfe die Felder: ein Name, ein Ziel von mindestens einem Satz und ein Zeitplan.",
  forbidden:
    "Nur Inhaber und Bearbeiter des Arbeitsbereichs können Automationen anlegen.",
  rate_limited: "Zu viele Änderungen auf einmal. Warte eine Minute.",
  limit_reached:
    "Dieser Arbeitsbereich hat das Automationen-Limit seines Plans erreicht.",
};

const WEBHOOK_EVENTS = [
  { id: "push", label: "Push" },
  { id: "pull_request", label: "Pull Request" },
  { id: "ci_failure", label: "CI-Fehler" },
  { id: "deployment", label: "Deployment" },
  { id: "db_event", label: "Datenbank-Ereignis" },
  { id: "generic", label: "Anderes signiertes Ereignis" },
] as const;

export function AutomationForm({
  onDone,
  endpoints = [],
}: {
  onDone: () => void;
  endpoints?: Array<{ id: string; name: string; source: string }>;
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [objective, setObjective] = useState("");
  const [trigger, setTrigger] = useState<
    "schedule" | "run_completed" | "connector_changed" | "webhook"
  >("schedule");
  const [endpointId, setEndpointId] = useState<string>("");
  const [events, setEvents] = useState<string[]>(["ci_failure"]);
  const [cadence, setCadence] = useState<"daily" | "weekdays" | "weekly">(
    "weekdays",
  );
  const [weekday, setWeekday] = useState(1);
  const [preset, setPreset] = useState<"cautious" | "balanced">("cautious");
  const [maxCost, setMaxCost] = useState("");
  const [maxTokens, setMaxTokens] = useState("");
  const [tools, setTools] = useState<string[]>([]);
  const [notifyCompleted, setNotifyCompleted] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    const response = await fetch("/api/automations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name,
        objective,
        trigger,
        schedule:
          trigger === "schedule"
            ? { cadence, weekday: cadence === "weekly" ? weekday : undefined }
            : null,
        webhook:
          trigger === "webhook"
            ? { endpointId: endpointId || null, events }
            : null,
        policyPreset: preset,
        maxCostUsd: maxCost ? Number(maxCost) : null,
        maxTokens: maxTokens ? Number(maxTokens) : null,
        allowedTools: tools,
        notifyOn: notifyCompleted
          ? ["completed", "failed", "approval"]
          : ["failed", "approval"],
      }),
    }).catch(() => null);
    setBusy(false);
    if (response?.ok) {
      router.refresh();
      return onDone();
    }
    const body = (await response?.json().catch(() => ({}))) as {
      error?: string;
    };
    setError(
      ERRORS[body?.error ?? ""] ?? "Die Automation wurde nicht angelegt.",
    );
  };

  return (
    <form
      className="card card-pad conn-form automation-form"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <Field label="Name">
        {(props) => (
          <input
            {...props}
            className="input"
            value={name}
            maxLength={120}
            onChange={(event) => setName(event.target.value)}
          />
        )}
      </Field>
      <Field
        label="Ziel"
        hint="Was Osirus jedes Mal tun soll, so wie du es in einen Chat tippen würdest."
      >
        {(props) => (
          <textarea
            {...props}
            className="textarea"
            rows={3}
            value={objective}
            maxLength={4000}
            onChange={(event) => setObjective(event.target.value)}
          />
        )}
      </Field>
      <fieldset className="field fieldset">
        <legend className="field-label">Wann</legend>
        <label className="check">
          <input
            type="radio"
            name="trigger"
            checked={trigger === "schedule"}
            onChange={() => setTrigger("schedule")}
          />
          <span>Nach Zeitplan</span>
        </label>
        {trigger === "schedule" ? (
          <div className="row row-wrap indent">
            <select
              className="select"
              aria-label="Rhythmus"
              value={cadence}
              onChange={(event) =>
                setCadence(event.target.value as typeof cadence)
              }
            >
              <option value="daily">Jeden Tag</option>
              <option value="weekdays">Werktags</option>
              <option value="weekly">Einmal pro Woche</option>
            </select>
            {cadence === "weekly" ? (
              <select
                className="select"
                aria-label="Wochentag"
                value={weekday}
                onChange={(event) => setWeekday(Number(event.target.value))}
              >
                {WEEKDAYS.map((day, index) => (
                  <option key={day} value={index}>
                    {day}
                  </option>
                ))}
              </select>
            ) : null}
            <span className="field-hint">
              Läuft im täglichen Zeitfenster um{" "}
              {String(SCHEDULER_WINDOW_HOUR_UTC).padStart(2, "0")}:00 UTC.
            </span>
          </div>
        ) : null}
        <label className="check">
          <input
            type="radio"
            name="trigger"
            checked={trigger === "run_completed"}
            onChange={() => setTrigger("run_completed")}
          />
          <span>Wenn einer deiner Läufe fertig ist</span>
        </label>
        <label className="check">
          <input
            type="radio"
            name="trigger"
            checked={trigger === "connector_changed"}
            onChange={() => setTrigger("connector_changed")}
          />
          <span>
            Wenn sich eine Verbindung ändert (GitHub verbunden oder getrennt)
          </span>
        </label>
        <label className="check">
          <input
            type="radio"
            name="trigger"
            checked={trigger === "webhook"}
            disabled={!endpoints.length}
            onChange={() => setTrigger("webhook")}
          />
          <span>
            Wenn ein signierter Webhook eintrifft
            {endpoints.length
              ? ""
              : " (lege zuerst unter Verbindungen einen Webhook-Endpunkt an)"}
          </span>
        </label>
        {trigger === "webhook" ? (
          <div className="indent stack">
            <select
              className="select"
              aria-label="Webhook-Endpunkt"
              value={endpointId}
              onChange={(event) => setEndpointId(event.target.value)}
            >
              <option value="">Jeder Endpunkt in diesem Arbeitsbereich</option>
              {endpoints.map((endpoint) => (
                <option key={endpoint.id} value={endpoint.id}>
                  {endpoint.name} ({endpoint.source})
                </option>
              ))}
            </select>
            <div className="tool-checks" role="group" aria-label="Ereignisse">
              {WEBHOOK_EVENTS.map((event) => (
                <label key={event.id} className="check">
                  <input
                    type="checkbox"
                    checked={events.includes(event.id)}
                    onChange={(change) =>
                      setEvents((current) =>
                        change.target.checked
                          ? [...current, event.id]
                          : current.filter((id) => id !== event.id),
                      )
                    }
                  />
                  <span>{event.label}</span>
                </label>
              ))}
            </div>
            <span className="field-hint">
              Nur geprüfte Zustellungen starten sie; der Lauf erfährt, was
              passiert ist (Ereignis, Repository, Branch, Commit), nie den
              freien Text des Absenders.
            </span>
          </div>
        ) : null}
      </fieldset>
      <fieldset className="field fieldset">
        <legend className="field-label">Was sie selbst tun darf</legend>
        <label className="check">
          <input
            type="radio"
            name="preset"
            checked={preset === "cautious"}
            onChange={() => setPreset("cautious")}
          />
          <span>Vorsichtig: fragt vor jeder Änderung</span>
        </label>
        <label className="check">
          <input
            type="radio"
            name="preset"
            checked={preset === "balanced"}
            onChange={() => setPreset("balanced")}
          />
          <span>
            Ausgewogen: arbeitet in der Sandbox, fragt, bevor sie anderswo
            handelt
          </span>
        </label>
        <p className="field-hint">
          Nie lockerer als die Richtlinie des Arbeitsbereichs. Freigaben landen
          in deinem Posteingang.
        </p>
      </fieldset>
      <fieldset className="field fieldset">
        <legend className="field-label">
          Aktionen auf diese Werkzeuge beschränken (optional)
        </legend>
        <div className="tool-checks">
          {ACTION_TOOLS.map((tool) => (
            <label key={tool} className="check">
              <input
                type="checkbox"
                checked={tools.includes(tool)}
                onChange={(event) =>
                  setTools((current) =>
                    event.target.checked
                      ? [...current, tool]
                      : current.filter((item) => item !== tool),
                  )
                }
              />
              <span>{toolLabel(tool)}</span>
            </label>
          ))}
        </div>
        <p className="field-hint">
          Lesen ist immer erlaubt. Ist nichts ausgewählt, entscheidet die
          Richtlinie.
        </p>
      </fieldset>
      <div className="row row-wrap">
        <Field label="Budget (USD, optional)">
          {(props) => (
            <input
              {...props}
              className="input"
              type="number"
              min="0.01"
              step="0.01"
              inputMode="decimal"
              value={maxCost}
              onChange={(event) => setMaxCost(event.target.value)}
            />
          )}
        </Field>
        <Field label="Token-Limit (optional)">
          {(props) => (
            <input
              {...props}
              className="input"
              type="number"
              min="1000"
              step="1000"
              inputMode="numeric"
              value={maxTokens}
              onChange={(event) => setMaxTokens(event.target.value)}
            />
          )}
        </Field>
      </div>
      <label className="check">
        <input
          type="checkbox"
          checked={notifyCompleted}
          onChange={(event) => setNotifyCompleted(event.target.checked)}
        />
        <span>
          Benachrichtige mich, wenn sie fertig ist (bei Fehlern und Freigaben
          immer)
        </span>
      </label>
      {error ? (
        <p className="field-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="row">
        <button
          type="submit"
          className="btn btn-primary"
          disabled={busy || !name.trim() || objective.trim().length < 8}
        >
          {busy ? "Wird angelegt…" : "Automation anlegen"}
        </button>
        <button type="button" className="btn btn-ghost" onClick={onDone}>
          Abbrechen
        </button>
      </div>
    </form>
  );
}
