"use client";

import {
  LAB_BUILD,
  LAB_MODELS,
  type InteractionPreference,
  type LabModelId,
} from "@/lib/lab/choices";
import { activityCaption, modelRouteDescription } from "@/lib/lab/honesty";
import type { LivePill } from "@/lib/ui/live-activity";

export interface PhaseGrade {
  readonly armId: string;
  readonly phase: string | null;
  readonly passed: boolean;
}

export function ModelSelectors(props: {
  model: LabModelId;
  interaction: InteractionPreference;
  activity: string | null;
  /** Kept so callers can pass grader rows without rendering them as thinking. */
  phases?: readonly string[];
  grades?: readonly PhaseGrade[];
  pills?: readonly LivePill[];
  disabled?: boolean;
  onModelChange: (model: LabModelId) => void;
  onInteractionChange: (interaction: InteractionPreference) => void;
}) {
  const pills = props.pills ?? [];
  const ran = new Set(props.phases ?? []);
  const shownGrades = (props.grades ?? []).filter(
    (grade) =>
      grade.phase !== null &&
      ran.has(grade.phase) &&
      grade.phase !== "native_inference",
  );
  return (
    <div className="lab-selectors">
      <label>
        Model
        <span id="lab-model-route" className="sr-only">
          {modelRouteDescription(props.model, props.interaction)}
        </span>
        <select
          aria-label="Model"
          aria-describedby="lab-model-route"
          title={modelRouteDescription(props.model, props.interaction)}
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
        data-activity={
          props.activity === "waiting" || props.activity === "typing"
            ? props.activity
            : props.interaction === "ai" &&
                (props.activity === "api_fallback" ||
                  props.activity === "native_inference")
              ? props.activity
              : "idle"
        }
        data-provenance={
          props.interaction === "ai" && props.activity === "api_fallback"
            ? "api_fallback"
            : props.interaction === "ai" &&
                props.activity === "native_inference"
              ? "native"
              : "none"
        }
        data-live={props.activity === "waiting" ? "true" : "false"}
      >
        {activityCaption({
          activity: props.activity,
          model: props.model,
          interaction: props.interaction,
        })}
      </p>
      {shownGrades.some((grade) => !grade.passed) ? (
        <p className="lab-activity" data-activity="idle">
          A check did not pass.
        </p>
      ) : null}
      {pills.length ? (
        <p className="lab-live" role="status">
          {pills
            .map((pill) =>
              pill.kind === "tool"
                ? `Tool · ${pill.label}`
                : `Subagent · ${pill.label}`,
            )
            .join(" ")}
        </p>
      ) : null}
    </div>
  );
}
