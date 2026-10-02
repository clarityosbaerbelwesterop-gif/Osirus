// What the composer model selector may offer.
//
// "auto" is the only selectable entry, because it is the only routing the
// product actually performs: agent runs are served by the verified
// free-model pool (src/lib/models), AI-mode answers by the Rouge runtime's
// configured core (/api/rouge). There is no per-request model pin for
// product runs -- pinning exists for Foundry/RSI trials only -- so offering
// one would be a dead control.
//
// The Osirus self-models are listed so people can see they exist, but they
// are disabled: none has a trained, measured checkpoint
// (trainingReady/measured are false in ai-lab/programs/*, so every answer
// would come from an external fallback model wearing the self-model's
// name). The label says so instead.
export const MODEL_OPTIONS = [
  { id: "auto", label: "Auto", available: true },
  { id: "rouge", label: "ROUGE 1", available: false },
  { id: "quasnir", label: "QUASNIR", available: false },
  { id: "darus", label: "DARUS", available: false },
] as const;

export type LabModelId = (typeof MODEL_OPTIONS)[number]["id"];

/** Selectable models only; unavailable ids and legacy cookies become "auto". */
export function parseLabModel(value: string | undefined | null): LabModelId {
  const match = MODEL_OPTIONS.find((model) => model.id === value);
  return match?.available ? match.id : "auto";
}

export type InteractionPreference = "ai" | "agent";

export function parseInteraction(
  value: string | undefined | null,
): InteractionPreference {
  return value === "ai" ? "ai" : "agent";
}
