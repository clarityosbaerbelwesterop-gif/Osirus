export const LAB_MODELS = [
  { id: "rouge", label: "ROUGE 1" },
  { id: "quasnir", label: "QUASNIR" },
  { id: "darus", label: "DARUS" },
  { id: "external", label: "External API" },
] as const;

export type LabModelId = (typeof LAB_MODELS)[number]["id"];

/** Which model programs are compiled into this branch. */
export const LAB_BUILD: Record<Exclude<LabModelId, "external">, boolean> = {
  rouge: true,
  quasnir: true,
  darus: false,
};

export type InteractionPreference = "ai" | "agent";

export function parseLabModel(value: string | undefined | null): LabModelId {
  return value === "quasnir" || value === "darus" || value === "external"
    ? value
    : "rouge";
}

export function parseInteraction(
  value: string | undefined | null,
): InteractionPreference {
  return value === "ai" ? "ai" : "agent";
}
