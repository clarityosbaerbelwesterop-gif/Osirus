import { createHash } from "node:crypto";
import type { GatewayMessage } from "./stream";

// Exact-answer cache per server instance: the same model asked the very
// same conversation within 30 minutes gets the stored answer without a new
// model call. "Regenerate" bypasses it. Answers are kept per workspace so
// one person never sees another's cached text.

const MAX_ENTRIES = 400;
const TTL_MS = 30 * 60 * 1000;

type Entry = { at: number; text: string; reasoning: string };

const entries = new Map<string, Entry>();

export function answerCacheKey(input: {
  scope: string;
  ref: string;
  messages: readonly GatewayMessage[];
}) {
  return createHash("sha256")
    .update(JSON.stringify([input.scope, input.ref, input.messages]))
    .digest("hex");
}

export function cachedAnswer(key: string, now = Date.now()): Entry | null {
  const entry = entries.get(key);
  if (!entry) return null;
  if (now - entry.at > TTL_MS) {
    entries.delete(key);
    return null;
  }
  // Refresh recency.
  entries.delete(key);
  entries.set(key, entry);
  return entry;
}

export function storeAnswer(
  key: string,
  value: { text: string; reasoning: string },
  now = Date.now(),
) {
  if (!value.text.trim()) return;
  entries.delete(key);
  entries.set(key, { at: now, ...value });
  while (entries.size > MAX_ENTRIES) {
    const oldest = entries.keys().next().value;
    if (oldest === undefined) break;
    entries.delete(oldest);
  }
}

export function resetAnswerCache() {
  entries.clear();
}
