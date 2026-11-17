import type { InteractionPreference, LabModelId } from "./choices";

/**
 * What the selector may claim. These programs are untrained, so the live
 * route is the UnoRouter fallback. The short option text stays the program
 * name; the route label is the honest one.
 */

export function honestRouteLabel(model: LabModelId): string {
  if (model === "external") return "UNOROUTER";
  return "Bald verfügbar";
}

/**
 * Screen-reader description. The closed control keeps its short name so the
 * composer row does not reflow. Agent mode is Osirus, not the selected model.
 */
export function modelRouteDescription(
  _model: LabModelId,
  interaction: InteractionPreference,
): string {
  if (interaction === "agent") {
    return "Im Agent-Modus arbeitet Osirus. Das gewählte Modell ist nicht der Agent.";
  }
  return "UNOROUTER-Modelle erscheinen, sobald die Schlüsselliste bekannt ist.";
}

/**
 * Live caption. A policy phase is not a native model, and an API fallback is
 * never labeled as one. Agent mode does not borrow the model's route label.
 */
export function activityCaption(input: {
  activity: string | null;
  model: string;
  interaction: InteractionPreference;
}): string {
  if (input.activity === "waiting") return "Wartet";
  if (input.activity === "typing") return "Schreibt";
  if (input.interaction === "agent") return "Bereit";
  // The fallback is a route, not a model the person can select. Never call
  // the answer a native checkpoint.
  if (
    input.activity === "api_fallback" ||
    input.activity === "native_inference"
  ) {
    return "Kein nativer Checkpoint.";
  }
  return "Bereit";
}

/** Lab programs answer only in AI mode. Agent mode never calls them. */
export function labAnswers(input: {
  interaction: InteractionPreference;
  model: LabModelId;
}): boolean {
  return input.interaction === "ai" && input.model !== "external";
}
