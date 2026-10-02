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

function activityLabel(activity: string): string {
  if (activity === "waiting") return "Waiting";
  if (activity === "api_fallback") return "API fallback";
  if (activity === "native_inference") return "Native inference";
  return activity.replaceAll("_", " ");
}

export interface PhaseGrade {
  readonly armId: string;
  readonly phase: string | null;
  readonly passed: boolean;
}

export function ModelSelectors(props: {
  model: LabModelId;
  interaction: InteractionPreference;
  activity: string | null;
  phases?: readonly string[];
  grades?: readonly PhaseGrade[];
  disabled?: boolean;
  onModelChange: (model: LabModelId) => void;
  onInteractionChange: (interaction: InteractionPreference) => void;
}) {
  const known = (ACTIVITIES as readonly string[]).includes(
    props.activity ?? "",
  );
  const phases = (props.phases ?? []).filter((phase) =>
    (ACTIVITIES as readonly string[]).includes(phase),
  );
  const grades = (props.grades ?? []).filter(
    (grade) => grade.phase !== null && phases.includes(grade.phase),
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
        data-provenance={
          props.activity === "api_fallback"
            ? "api_fallback"
            : props.activity === "native_inference"
              ? "native"
              : "none"
        }
        data-live={props.activity === "waiting" ? "true" : "false"}
      >
        {known && props.activity
          ? `${activityLabel(
              props.activity === "api_fallback" && phases.length
                ? (phases
                    .filter(
                      (phase) =>
                        phase !== "api_fallback" &&
                        phase !== "native_inference",
                    )
                    .at(-1) ?? props.activity)
                : props.activity,
            )}${props.activity === "api_fallback" ? " · API fallback" : ""}`
          : "Idle"}
      </p>
      {phases.length ? (
        <ol className="lab-activity-phases" aria-label="Completed policy steps">
          {phases.map((phase) => {
            const beside = grades.filter((grade) => grade.phase === phase);
            return (
              <li key={phase} data-state="done">
                {activityLabel(phase)}
                {beside.map((grade) => (
                  <span
                    key={grade.armId}
                    data-grader={grade.passed ? "pass" : "fail"}
                  >
                    {` · ${grade.armId}: ${grade.passed ? "pass" : "fail"}`}
                  </span>
                ))}
              </li>
            );
          })}
        </ol>
      ) : null}
    </div>
  );
}
