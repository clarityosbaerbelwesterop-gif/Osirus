import type { InteractionPreference, LabModelId } from "./choices";

/**
 * What the selector may claim. These programs are untrained, so the live
 * route is the UnoRouter fallback. The short option text stays the program
 * name; the route label is the honest one.
 */

const FALLBACK_LABEL: Record<Exclude<LabModelId, "external">, string> = {
  rouge: "ROUGE 1 · API fallback",
  quasnir: "QUASNIR · API fallback",
  darus: "DARUS · API fallback",
};

export function honestRouteLabel(model: LabModelId): string {
  if (model === "external") return "External API";
  return FALLBACK_LABEL[model];
}

/**
 * Screen-reader description. The closed control keeps its short name so the
 * composer row does not reflow. Agent mode is Osirus, not the selected model.
 */
export function modelRouteDescription(
  model: LabModelId,
  interaction: InteractionPreference,
): string {
  if (interaction === "agent") {
    return "Agent mode runs Osirus. The selected model is not the agent.";
  }
  if (model === "external") {
    return "External API is the Osirus provider pool, not ROUGE 1, QUASNIR, or DARUS.";
  }
  return `${honestRouteLabel(model)}. Not a native checkpoint.`;
}

/**
 * Live caption. A policy phase is not a native model, and an API fallback is
 * never labeled as one. Agent mode does not borrow the model's route label.
 */
export function activityCaption(input: {
  activity: string | null;
  model: LabModelId;
  interaction: InteractionPreference;
}): string {
  if (input.activity === "waiting") return "Waiting";
  if (input.activity === "typing") return "Typing";
  if (input.interaction === "agent") return "Idle";
  // The fallback is a route, not a model the person can select. Never call
  // the answer a native checkpoint.
  if (
    input.activity === "api_fallback" ||
    input.activity === "native_inference"
  ) {
    return "Not a native checkpoint.";
  }
  return "Idle";
}

/** Lab programs answer only in AI mode. Agent mode never calls them. */
export function labAnswers(input: {
  interaction: InteractionPreference;
  model: LabModelId;
}): boolean {
  return input.interaction === "ai" && input.model !== "external";
}
