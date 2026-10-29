import type { Tone } from "./labels";

/**
 * What the chat may say about a run. Five states, no stage names, no
 * progress fraction. Internal statuses stay in the runtime record.
 */

export type ChatRunLabel =
  "Startet" | "Arbeitet" | "Wartet auf dich" | "Fertig" | "Nicht abgeschlossen";

export function chatRunPresentation(status: string | null | undefined): {
  label: ChatRunLabel;
  tone: Tone;
  line: string;
} {
  switch (status) {
    case "created":
    case "queued":
      return { label: "Startet", tone: "accent", line: "Startet …" };
    case "waiting_for_approval":
      return {
        label: "Wartet auf dich",
        tone: "warning",
        line: "Wartet auf deine Freigabe.",
      };
    case "blocked":
      return {
        label: "Wartet auf dich",
        tone: "warning",
        line: "Wartet auf dich.",
      };
    case "completed":
      return { label: "Fertig", tone: "success", line: "Fertig" };
    case "failed":
    case "cancelled":
      return {
        label: "Nicht abgeschlossen",
        tone: "danger",
        line: "Konnte nicht abgeschlossen werden.",
      };
    default:
      return { label: "Arbeitet", tone: "accent", line: "Arbeitet …" };
  }
}

/** The one visible sentence. A failure uses its honest message, not a stage id. */
export function chatStatusLine(
  status: string | null | undefined,
  failureMessage: string | null | undefined,
): string {
  const honest = failureMessage?.trim();
  if (honest) return honest;
  return chatRunPresentation(status).line;
}

/**
 * Captions no longer name retired product models. A message list may still
 * show a caption the caller passes explicitly.
 */
export function customerProgramCaption(
  userLabel: string | null | undefined,
): string | null {
  void userLabel;
  return null;
}
