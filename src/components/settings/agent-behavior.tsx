"use client";

import { Lock } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  ACTION_CLASSES,
  CLASS_INFO,
  PRESET_INFO,
  PRESETS,
  withFloors,
  type ActionClass,
  type Decision,
  type Preset,
  type WorkspacePolicy,
} from "@/lib/policy/model";
import { Badge } from "../ui/badge";

const DECISION_LABEL: Record<Decision, string> = {
  allow: "Allowed",
  ask: "Asks you",
  deny: "Never",
};

export function AgentBehaviorSettings({ policy }: { policy: WorkspacePolicy }) {
  const router = useRouter();
  const [preset, setPreset] = useState<Preset | "custom">(policy.preset);
  const [custom, setCustom] = useState(policy.decisions);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const decisions =
    preset === "custom" ? withFloors(custom) : withFloors(PRESETS[preset]);
  const dirty =
    preset !== policy.preset ||
    ACTION_CLASSES.some((cls) => decisions[cls] !== policy.decisions[cls]);

  const save = async () => {
    setSaving(true);
    setMessage(null);
    const response = await fetch("/api/policy", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        preset,
        decisions: preset === "custom" ? decisions : undefined,
      }),
    }).catch(() => null);
    setSaving(false);
    setMessage(
      response?.ok
        ? "Saved. It applies from the next step of any running task."
        : response?.status === 403
          ? "Only workspace owners and editors can change this."
          : "The policy was not saved. Try again.",
    );
    router.refresh();
  };

  return (
    <div className="stack">
      <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="field-label">Autonomy level</legend>
        <div
          className="preset-grid"
          role="radiogroup"
          aria-label="Autonomy level"
        >
          {(["cautious", "balanced", "autonomous"] as Preset[]).map((id) => (
            <label key={id} className="preset">
              <input
                type="radio"
                name="preset"
                value={id}
                checked={preset === id}
                onChange={() => setPreset(id)}
              />
              <span className="preset-label">{PRESET_INFO[id].label}</span>
              <span className="preset-desc">{PRESET_INFO[id].description}</span>
            </label>
          ))}
          <label className="preset">
            <input
              type="radio"
              name="preset"
              value="custom"
              checked={preset === "custom"}
              onChange={() => {
                setCustom(decisions);
                setPreset("custom");
              }}
            />
            <span className="preset-label">Custom</span>
            <span className="preset-desc">Choose per action.</span>
          </label>
        </div>
      </fieldset>

      <div className="table-wrap">
        <table className="table policy-table">
          <caption className="sr-only">What Osirus may do on its own</caption>
          <thead>
            <tr>
              <th scope="col">Action</th>
              <th scope="col">Decision</th>
            </tr>
          </thead>
          <tbody>
            {ACTION_CLASSES.map((cls: ActionClass) => {
              const info = CLASS_INFO[cls];
              const value = decisions[cls];
              const options: Decision[] = info.floor
                ? ["ask", "deny"]
                : ["allow", "ask", "deny"];
              return (
                <tr key={cls}>
                  <td>
                    <div>{info.label}</div>
                    <div className="subtle">
                      {info.description}
                      {info.inUse ? "" : " No tool uses this yet."}
                    </div>
                  </td>
                  <td>
                    {preset === "custom" ? (
                      <select
                        className="select"
                        aria-label={`Decision for ${info.label}`}
                        value={value}
                        onChange={(event) =>
                          setCustom({
                            ...decisions,
                            [cls]: event.target.value as Decision,
                          })
                        }
                      >
                        {options.map((option) => (
                          <option key={option} value={option}>
                            {DECISION_LABEL[option]}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <Badge
                        tone={
                          value === "allow"
                            ? "success"
                            : value === "ask"
                              ? "warning"
                              : "danger"
                        }
                      >
                        {DECISION_LABEL[value]}
                      </Badge>
                    )}
                    {info.floor ? (
                      <div className="subtle floor-note">
                        <Lock size={12} aria-hidden="true" /> Never runs without
                        asking
                      </div>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="row row-wrap">
        <button
          type="button"
          className="btn btn-primary"
          disabled={!dirty || saving}
          onClick={() => void save()}
        >
          {saving ? "Saving…" : "Save policy"}
        </button>
        {message ? (
          <p className="subtle" role="status">
            {message}
          </p>
        ) : null}
      </div>
    </div>
  );
}
