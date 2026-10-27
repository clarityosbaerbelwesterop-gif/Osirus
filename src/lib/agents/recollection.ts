// A bot's memory of the person: the last turns of their earlier
// conversations with this bot, read before a new answer. Archived
// conversations are forgotten. Nothing leaves the workspace.

export type RecollectionTurn = {
  sessionTitle: string;
  role: "user" | "assistant";
  content: string;
};

const PER_TURN = 400;
const TOTAL = 4000;

/** The block a bot reads first; null when there is nothing to remember. */
export function recollectionPrompt(
  botName: string,
  turns: readonly RecollectionTurn[],
): string | null {
  if (!turns.length) return null;
  const lines: string[] = [];
  let title = "";
  for (const turn of turns) {
    if (turn.sessionTitle !== title) {
      title = turn.sessionTitle;
      lines.push(`\n[${title}]`);
    }
    const text = turn.content.replace(/\s+/g, " ").trim();
    lines.push(
      `${turn.role === "user" ? "Person" : botName}: ${text.length > PER_TURN ? `${text.slice(0, PER_TURN)} …` : text}`,
    );
  }
  const body = lines.join("\n").trim();
  return `\n\nDein Gedächtnis: Ausschnitte aus früheren Unterhaltungen mit dieser Person (ältere zuerst). Nutze es, wo es hilft, etwa für Vorlieben, Projekte und offene Punkte; zitiere es nicht ungefragt und erfinde nichts dazu.\n${body.length > TOTAL ? body.slice(body.length - TOTAL) : body}`;
}
