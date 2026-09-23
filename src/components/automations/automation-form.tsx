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
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

const ERRORS: Record<string, string> = {
  invalid_request:
    "Check the fields: a name, an objective of at least a sentence, and a schedule.",
  forbidden: "Only workspace owners and editors can create automations.",
  rate_limited: "Too many changes at once. Wait a minute.",
};

export function AutomationForm({ onDone }: { onDone: () => void }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [objective, setObjective] = useState("");
  const [trigger, setTrigger] = useState<
    "schedule" | "run_completed" | "connector_changed"
  >("schedule");
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
    setError(ERRORS[body?.error ?? ""] ?? "The automation was not created.");
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
        label="Objective"
        hint="What Osirus should do each time, as you would type it in a chat."
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
        <legend className="field-label">When</legend>
        <label className="check">
          <input
            type="radio"
            name="trigger"
            checked={trigger === "schedule"}
            onChange={() => setTrigger("schedule")}
          />
          <span>On a schedule</span>
        </label>
        {trigger === "schedule" ? (
          <div className="row row-wrap indent">
            <select
              className="select"
              aria-label="Cadence"
              value={cadence}
              onChange={(event) =>
                setCadence(event.target.value as typeof cadence)
              }
            >
              <option value="daily">Every day</option>
              <option value="weekdays">Weekdays</option>
              <option value="weekly">Once a week</option>
            </select>
            {cadence === "weekly" ? (
              <select
                className="select"
                aria-label="Day of the week"
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
              Runs in the daily scheduler window at{" "}
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
          <span>When one of your runs completes</span>
        </label>
        <label className="check">
          <input
            type="radio"
            name="trigger"
            checked={trigger === "connector_changed"}
            onChange={() => setTrigger("connector_changed")}
          />
          <span>
            When a connection changes (GitHub connected or disconnected)
          </span>
        </label>
        <p className="field-hint">
          GitHub repository events and inbound webhooks are not available yet.
        </p>
      </fieldset>
      <fieldset className="field fieldset">
        <legend className="field-label">What it may do on its own</legend>
        <label className="check">
          <input
            type="radio"
            name="preset"
            checked={preset === "cautious"}
            onChange={() => setPreset("cautious")}
          />
          <span>Cautious: asks before any change</span>
        </label>
        <label className="check">
          <input
            type="radio"
            name="preset"
            checked={preset === "balanced"}
            onChange={() => setPreset("balanced")}
          />
          <span>
            Balanced: works in the sandbox, asks before acting elsewhere
          </span>
        </label>
        <p className="field-hint">
          Never looser than the workspace policy. Approvals arrive in your
          inbox.
        </p>
      </fieldset>
      <fieldset className="field fieldset">
        <legend className="field-label">
          Limit actions to these tools (optional)
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
          Reading is always allowed. With none selected, the policy decides.
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
        <Field label="Token limit (optional)">
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
          Notify me when it completes (failures and approvals always notify)
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
          {busy ? "Creating…" : "Create automation"}
        </button>
        <button type="button" className="btn btn-ghost" onClick={onDone}>
          Cancel
        </button>
      </div>
    </form>
  );
}
