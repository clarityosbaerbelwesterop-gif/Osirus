// Reads the Agents chat stream: "data: {json}" frames separated by a blank line.

export type ChatStreamEvent =
  | {
      type: "start";
      sessionId: string;
      title: string;
      created: boolean;
      cached: boolean;
    }
  | { type: "text"; text: string }
  /** Web sources the answer may cite as [n]. */
  | {
      type: "sources";
      sources: Array<{ n: number; title: string; url: string; domain: string }>;
    }
  /** The answer starts over (another model took over before any text). */
  | { type: "reset" }
  | { type: "reasoning"; text: string }
  | {
      type: "done";
      messageId: string | null;
      latencyMs: number;
      usage?: { inputTokens?: number; outputTokens?: number };
    }
  | { type: "error"; code: string; message: string; retryAfterMs?: number };

export function parseChatFrames(buffer: string): {
  events: ChatStreamEvent[];
  rest: string;
} {
  const frames = buffer.split(/\r?\n\r?\n/);
  const rest = frames.pop() ?? "";
  const events: ChatStreamEvent[] = [];
  for (const frame of frames) {
    const payload = frame
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim())
      .join("\n");
    if (!payload) continue;
    try {
      events.push(JSON.parse(payload) as ChatStreamEvent);
    } catch {
      // a broken frame is skipped; the stream goes on
    }
  }
  return { events, rest };
}

export async function* readChatStream(
  response: Response,
): AsyncGenerator<ChatStreamEvent> {
  if (!response.body) return;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parsed = parseChatFrames(buffer);
      buffer = parsed.rest;
      for (const event of parsed.events) yield event;
    }
    const tail = parseChatFrames(`${buffer}\n\n`);
    for (const event of tail.events) yield event;
  } finally {
    reader.releaseLock();
  }
}
