"use client";

import {
  MODEL_OPTIONS,
  type InteractionPreference,
  type LabModelId,
} from "@/lib/lab/choices";

/**
 * Model and interaction selection for the composer.
 *
 * Both controls are real: the model choice is honest about what exists
 * (only "Auto" routes anywhere; the self-models are disabled until a
 * trained, measured checkpoint ships), and the interaction choice switches
 * between two genuinely different backends -- AI mode streams a direct
 * answer from the Rouge runtime, Agent mode starts an Osirus run with
 * steps, tools and approvals. `activity` shows the AI answer's live status
 * while it streams; nothing here simulates progress.
 */
export function ModelSelectors(props: {
  model: LabModelId;
  interaction: InteractionPreference;
  /** Live status label of the AI-mode answer stream; null when idle. */
  activity: string | null;
  disabled?: boolean;
  onModelChange: (model: LabModelId) => void;
  onInteractionChange: (interaction: InteractionPreference) => void;
}) {
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
          {MODEL_OPTIONS.map((model) => (
            <option key={model.id} value={model.id} disabled={!model.available}>
              {model.available
                ? model.label
                : `${model.label} — in training, not available`}
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
      {props.activity ? (
        <p className="lab-activity" data-live="true">
          {props.activity}
        </p>
      ) : null}
    </div>
  );
}
