"use client";

import {
  LAB_BUILD,
  LAB_MODELS,
  type InteractionPreference,
  type LabModelId,
} from "@/lib/lab/choices";

const ACTIVITIES = [
  "thinking",
  "reasoning",
  "research",
  "verification",
  "code_analysis",
  "security_scan",
  "test_execution",
  "patch_verification",
  "deep_reasoning",
  "cross_domain_synthesis",
  "planning",
  "waiting",
  "api_fallback",
  "native_inference",
] as const;

export function ModelSelectors(props: {
  model: LabModelId;
  interaction: InteractionPreference;
  activity: string | null;
  disabled?: boolean;
  onModelChange: (model: LabModelId) => void;
  onInteractionChange: (interaction: InteractionPreference) => void;
}) {
  const known = (ACTIVITIES as readonly string[]).includes(
    props.activity ?? "",
  );
  return (
    <div className="lab-selectors">
      <label>
        Model
        <select
          aria-label="Model"
          value={props.model}
          disabled={props.disabled}
          onChange={(event) =>
            props.onModelChange(event.target.value as LabModelId)
          }
        >
          {LAB_MODELS.map((model) => (
            <option key={model.id} value={model.id}>
              {model.label}
              {model.id !== "external" && !LAB_BUILD[model.id]
                ? " (not in this build)"
                : ""}
            </option>
          ))}
        </select>
      </label>
      <div role="radiogroup" aria-label="Interaction">
        <button
          type="button"
          role="radio"
          aria-checked={props.interaction === "ai"}
          className={props.interaction === "ai" ? "is-active" : ""}
          disabled={props.disabled}
          onClick={() => props.onInteractionChange("ai")}
        >
          AI MODE
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={props.interaction === "agent"}
          className={props.interaction === "agent" ? "is-active" : ""}
          disabled={props.disabled}
          onClick={() => props.onInteractionChange("agent")}
        >
          AGENT MODE
        </button>
      </div>
      <p
        className="lab-activity"
        data-activity={known ? props.activity : "idle"}
      >
        {props.activity === "waiting"
          ? "Waiting"
          : props.activity === "api_fallback"
            ? "API fallback"
            : props.activity === "native_inference"
              ? "Native inference"
              : known && props.activity
                ? props.activity.replaceAll("_", " ")
                : "Idle"}
      </p>
    </div>
  );
}
