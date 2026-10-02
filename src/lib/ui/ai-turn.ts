// AI mode's request to /api/rouge: the conversation the chat shows, bounded
// to what the route accepts. The route is stateless -- it answers from what
// it is sent -- so the history is built here, from the visible messages.

/** The route accepts at most 40 messages and 120,000 characters. */
const MAX_MESSAGES = 39; // plus the new user turn = 40
const MAX_TOTAL_CHARS = 100_000;
const MAX_MESSAGE_CHARS = 20_000; // the route's per-message limit

export type AiTurnMessage = {
  role: "user" | "assistant";
  content: string;
};

type ChatMessageLike = {
  id: string;
  role: string;
  content: string;
};

/**
 * The conversation for one AI-mode turn: visible user/assistant messages,
 * oldest first, ending with the new user turn. Placeholder rows (`pending:`)
 * and empty content are dropped; the tail is kept within the route's limits,
 * oldest messages first to go.
 */
export function aiConversation(
  messages: readonly ChatMessageLike[],
  next: string,
): AiTurnMessage[] {
  const usable = messages.filter(
    (message) =>
      (message.role === "user" || message.role === "assistant") &&
      !message.id.startsWith("pending:") &&
      message.content.trim().length > 0,
  );
  const history: AiTurnMessage[] = [];
  let total = next.length;
  for (
    let index = usable.length - 1;
    index >= 0 && history.length < MAX_MESSAGES;
    index -= 1
  ) {
    const message = usable[index]!;
    const content = message.content.slice(0, MAX_MESSAGE_CHARS);
    if (total + content.length > MAX_TOTAL_CHARS) break;
    history.unshift({
      role: message.role === "user" ? "user" : "assistant",
      content,
    });
    total += content.length;
  }
  history.push({ role: "user", content: next });
  return history;
}
