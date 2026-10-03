import type { Tone } from "./labels";

/**
 * What the chat may say about a run. Five states, no stage names, no
 * progress fraction. Internal statuses stay in the runtime record.
 */

export type ChatRunLabel =
  "Starting" | "Working" | "Needs you" | "Done" | "Couldn't finish";

export function chatRunPresentation(status: string | null | undefined): {
  label: ChatRunLabel;
  tone: Tone;
  line: string;
} {
  switch (status) {
    case "created":
    case "queued":
      return { label: "Starting", tone: "accent", line: "Starting" };
    case "waiting_for_approval":
      return {
        label: "Needs you",
        tone: "warning",
        line: "Waiting for your approval.",
      };
    case "blocked":
      return { label: "Needs you", tone: "warning", line: "Waiting for you." };
    case "completed":
      return { label: "Done", tone: "success", line: "Done" };
    case "failed":
    case "cancelled":
      return {
        label: "Couldn't finish",
        tone: "danger",
        line: "Couldn't finish",
      };
    default:
      return { label: "Working", tone: "accent", line: "Working" };
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

const PROGRAM_NAMES = ["ROUGE 1", "QUASNIR", "DARUS"] as const;

/**
 * The name under an AI-mode answer. Never a catalog id, never UnoRouter,
 * and never a claim that the answer is a native checkpoint.
 */
export function customerProgramCaption(
  userLabel: string | null | undefined,
): string | null {
  if (!userLabel) return null;
  const name = PROGRAM_NAMES.find((item) => userLabel.startsWith(item));
  if (!name) return null;
  return `${name}. Not a native checkpoint.`;
}
