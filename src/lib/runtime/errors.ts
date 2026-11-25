import { redact } from "../security/redact";

type CodedError = Error & { code?: unknown };

export function runtimeErrorCode(error: unknown) {
  const code = (error as CodedError | undefined)?.code;
  return typeof code === "string" ? code : "runtime_error";
}

export function publicRuntimeErrorMessage(error: unknown) {
  switch (runtimeErrorCode(error)) {
    case "cancelled":
      return "Lauf abgebrochen.";
    case "rate_limited":
      return "Der Modellanbieter ist gerade ausgelastet. Bitte versuch es gleich noch einmal.";
    case "capacity_deferred":
      return "Die Modellkapazität ist gerade für direkte Anfragen reserviert. Diese Arbeit geht automatisch weiter.";
    case "timeout":
      return "Die Modellanfrage hat zu lange gedauert. Bitte versuch es noch einmal.";
    case "provider_not_configured":
    case "model_not_configured":
      return "Die Modellumgebung ist nicht eingerichtet.";
    case "credential_rejected":
      return "Der Modellanbieter hat die Zugangsdaten dieser Installation abgelehnt. Das muss der Betreiber beheben.";
    case "provider_unavailable":
      return "Der Modellanbieter ist vorübergehend nicht erreichbar. Bitte versuch es später noch einmal.";
    case "insufficient_credit":
      return "Der Modellanbieter hat die Anfrage abgelehnt: Das kostenlose Kontingent oder Guthaben des Kontos ist aufgebraucht.";
    case "quota_exhausted":
      return "Dein Nutzungsbudget für diesen Zeitraum ist verbraucht. Es füllt sich automatisch wieder auf; dann geht diese Arbeit weiter.";
    case "subscription_required":
      return "Für Modelle ist ein aktives Abo nötig.";
    case "plan_required":
      return "Der Rouge Agent ist ab Pro enthalten: Er arbeitet mit Premium-Modellen.";
    case "model_not_in_plan":
      return "Dieses Modell ist im Free-Plan nicht enthalten. Wechsle auf einen bezahlten Plan, um es zu nutzen.";
    case "subagent_limit":
      return "Der Free-Plan erlaubt weniger Subagents. Wechsle für mehr auf einen bezahlten Plan.";
    case "invalid_stream":
    case "invalid_json":
      return "Das Modell hat eine unbrauchbare Antwort geliefert. Bitte versuch es noch einmal.";
    default:
      return "Der Lauf konnte nicht abgeschlossen werden. Bitte versuch es noch einmal.";
  }
}

export function safeDiagnosticMessage(error: unknown) {
  return redact(
    error instanceof Error ? error.message.slice(0, 500) : "Unknown error",
  );
}
