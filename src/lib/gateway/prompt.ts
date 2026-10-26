import type { GatewayModel } from "./models";

// The Agents chat's instructions and its user-facing error copy.

export function chatSystemPrompt(input: {
  botName: string | null;
  botPrompt: string | null;
  modelName: string;
  now?: Date;
}) {
  const date = (input.now ?? new Date()).toISOString().slice(0, 10);
  const base = [
    input.botName
      ? `You are "${input.botName}", a bot inside Osirus.`
      : "You are Osirus, a precise and capable AI assistant.",
    `Today is ${date}. You run on the model ${input.modelName}.`,
    "Answer in the language the user writes in.",
    "Be direct: lead with the answer, then the reasoning that matters. No filler, no flattery.",
    "Use Markdown: short paragraphs, lists where they help, fenced code blocks with a language tag for code, tables for comparisons.",
    "If you are unsure or lack information, say so plainly instead of guessing. Never invent sources, numbers or quotes.",
    "You cannot browse the web or run code in this chat; for tasks that need tools, suggest the Rouge Agent or Code.",
  ].join("\n");
  const persona = input.botPrompt?.trim();
  return persona
    ? `${base}\n\nBot instructions from its owner:\n${persona}`
    : base;
}

export function chatErrorMessage(
  code: string,
  model: Pick<GatewayModel, "name" | "providerLabel">,
) {
  switch (code) {
    case "rate_limited":
      return `${model.providerLabel} begrenzt gerade die Anfragen für ${model.name}. Kurz warten oder ein anderes Modell wählen.`;
    case "timeout":
      return `${model.name} hat nicht rechtzeitig geantwortet. Noch einmal senden oder ein schnelleres Modell wählen.`;
    case "insufficient_credit":
      return `Das Guthaben bei ${model.providerLabel} ist aufgebraucht. Wähle ein Modell eines anderen Anbieters.`;
    case "credential_rejected":
      return `${model.providerLabel} lehnt den hinterlegten API-Key ab. Der Key muss in Vercel erneuert werden.`;
    case "model_not_configured":
      return `${model.providerLabel} bietet ${model.name} nicht mehr an. Das Modell wurde aus der Liste genommen; bitte ein anderes wählen.`;
    case "provider_not_configured":
      return `Für ${model.providerLabel} ist kein API-Key hinterlegt.`;
    case "provider_unavailable":
      return `${model.providerLabel} ist gerade nicht erreichbar. Gleich noch einmal versuchen oder ein anderes Modell wählen.`;
    case "empty_response":
      return `${model.name} hat eine leere Antwort geliefert. Noch einmal senden.`;
    case "invalid_stream":
      return `Die Antwort von ${model.name} kam beschädigt an. Noch einmal senden.`;
    default:
      return `${model.name} konnte nicht antworten. Noch einmal senden oder ein anderes Modell wählen.`;
  }
}
