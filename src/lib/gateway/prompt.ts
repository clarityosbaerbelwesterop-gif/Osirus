// The Agents chat's instructions and its user-facing error copy.

export function chatSystemPrompt(input: {
  botName: string | null;
  botPrompt: string | null;
  now?: Date;
}) {
  const date = (input.now ?? new Date()).toISOString().slice(0, 10);
  const base = [
    input.botName
      ? `You are "${input.botName}", a bot inside Osirus.`
      : "You are Osirus, a precise and capable AI assistant.",
    `Today is ${date}.`,
    "You are Osirus. Never name, confirm or guess the underlying model, its vendor, the provider or the infrastructure behind Osirus; if asked, say you are Osirus and continue with the task.",
    "Answer in the language the user writes in.",
    "Be direct: lead with the answer, then the reasoning that matters. No filler, no flattery.",
    "Use Markdown: short paragraphs, lists where they help, fenced code blocks with a language tag for code, tables for comparisons.",
    "If you are unsure or lack information, say so plainly instead of guessing. Never invent sources, numbers or quotes.",
    "Your own knowledge ends before today. For news, prices, versions or anything that changes, say how current your information is, and never present older knowledge as the latest state.",
    "You cannot browse the web in this chat; for tasks that need tools or a repository, suggest the Rouge Agent or Code.",
    "The person can run Python, JavaScript and TypeScript code blocks from your answer in a sandbox (no network, no extra packages, 15 seconds). Write such code runnable as is: one self-contained block that prints its results, and when you include tests, plain asserts that run on execution and print what passed. Check edge cases you list against your own code before answering.",
  ].join("\n");
  const persona = input.botPrompt?.trim();
  return persona
    ? `${base}\n\nBot instructions from its owner:\n${persona}`
    : base;
}

/**
 * What the person reads when no model could answer. Never names a model or
 * the service behind it: Osirus answers, or Osirus is busy.
 */
export function chatErrorMessage(code: string) {
  switch (code) {
    case "rate_limited":
    case "provider_unavailable":
    case "insufficient_credit":
    case "credential_rejected":
    case "model_not_configured":
    case "provider_not_configured":
      return "Osirus ist gerade stark ausgelastet. Bitte in einem Moment noch einmal senden.";
    case "timeout":
      return "Die Antwort hat zu lange gedauert. Bitte noch einmal senden.";
    case "empty_response":
    case "invalid_stream":
      return "Die Antwort kam unvollständig an. Bitte noch einmal senden.";
    default:
      return "Osirus konnte gerade nicht antworten. Bitte noch einmal senden.";
  }
}
