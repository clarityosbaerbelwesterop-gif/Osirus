// The four product surfaces. A thread belongs to one of them. Coding is the
// only surface that may carry a repository grant on the run.

export const SESSION_SURFACES = ["ai", "agent", "bot", "coding"] as const;

export type SessionSurface = (typeof SESSION_SURFACES)[number];

export const EFFORTS = ["leicht", "mittel", "hoch", "super", "ultra"] as const;

export type EffortId = (typeof EFFORTS)[number];

export const EFFORT_LABEL: Record<EffortId, string> = {
  leicht: "Leicht",
  mittel: "Mittel",
  hoch: "Hoch",
  super: "Super",
  ultra: "Ultra",
};

export const CUSTOMER_MODELS = [
  { id: "rouge", label: "ROUGE 1" },
  { id: "quasnir", label: "QUASNIR" },
  { id: "darus", label: "DARUS" },
] as const;

export type CustomerModelId = (typeof CUSTOMER_MODELS)[number]["id"];

export function parseSessionSurface(value: unknown): SessionSurface | null {
  return value === "ai" ||
    value === "agent" ||
    value === "bot" ||
    value === "coding"
    ? value
    : null;
}

export function parseEffort(value: unknown): EffortId | null {
  return value === "leicht" ||
    value === "mittel" ||
    value === "hoch" ||
    value === "super" ||
    value === "ultra"
    ? value
    : null;
}

export function parseCustomerModel(value: unknown): CustomerModelId | null {
  return value === "rouge" || value === "quasnir" || value === "darus"
    ? value
    : null;
}

/** How many motion marks an in-progress coding run draws. Not a percent. */
export function effortScale(effort: EffortId) {
  return EFFORTS.indexOf(effort) + 1;
}

export type CodingGrantTarget = {
  repository: string;
  branch: string;
  effort: EffortId;
  /** True only when the person chose the level. A suggestion is not a choice. */
  effortChosen: boolean;
  model: CustomerModelId;
};

/**
 * The coding grant rides only on a run whose surface is coding and whose
 * selection names a repository and a branch. Any other input, including an
 * agent or chat run, is not allowed to read that grant.
 */
export function codingGrantFromRunInput(
  input: unknown,
): CodingGrantTarget | null {
  if (!input || typeof input !== "object") return null;
  const row = input as { surface?: unknown; coding?: unknown };
  if (row.surface !== "coding" || !row.coding || typeof row.coding !== "object")
    return null;
  const coding = row.coding as Record<string, unknown>;
  const repository =
    typeof coding.repository === "string" ? coding.repository : "";
  const branch = typeof coding.branch === "string" ? coding.branch : "";
  const effort = parseEffort(coding.effort);
  const model = parseCustomerModel(coding.model);
  if (!/^https:\/\/github\.com\/[^/]+\/[^/]+$/.test(repository)) return null;
  if (!branch || branch.startsWith("-") || branch.includes("..")) return null;
  if (!effort || !model) return null;
  return {
    repository,
    branch,
    effort,
    model,
    effortChosen: coding.effortChosen === true,
  };
}

export function surfacePath(surface: SessionSurface) {
  switch (surface) {
    case "agent":
      return "/app/agent";
    case "bot":
      return "/app/bots";
    case "coding":
      return "/app/coding";
    default:
      return "/app";
  }
}

/**
 * Conversations beside one surface. A coding thread is not a chat thread.
 * A row with no surface is an old chat, not an agent or coding thread.
 */
export function sessionsForSurface<T extends { surface?: string | null }>(
  sessions: readonly T[],
  surface: SessionSurface | null,
): T[] {
  if (!surface) {
    return sessions.filter((item) => !item.surface || item.surface === "ai");
  }
  return sessions.filter((item) => item.surface === surface);
}

/** Switching Chat to Coding must not keep the previous line in the composer. */
export function draftAfterSurfaceChange(
  previous: SessionSurface | null,
  next: SessionSurface,
  draft: string,
) {
  if (previous !== next) return "";
  return draft;
}
