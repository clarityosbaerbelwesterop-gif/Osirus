/**
 * The role line of a bot's instructions ("Rolle: Software Engineer. …"),
 * shown under its name. A free-form bot has none.
 */
export function botRole(systemPrompt: string | null | undefined) {
  const match = systemPrompt?.match(
    /^\s*Rolle:\s*([^.\n]{2,60}?)\s*(?:\(|\.|\n|$)/,
  );
  return match ? match[1].trim() : null;
}
