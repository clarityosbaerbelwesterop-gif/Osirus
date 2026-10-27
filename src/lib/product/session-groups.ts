// Conversations by when they were last used, the way a chat history reads:
// today, yesterday, the last seven days, the last thirty, then older.

export type SessionGroupId = "today" | "yesterday" | "week" | "month" | "older";

export const SESSION_GROUP_LABEL: Record<SessionGroupId, string> = {
  today: "Heute",
  yesterday: "Gestern",
  week: "Letzte 7 Tage",
  month: "Letzte 30 Tage",
  older: "Älter",
};

const ORDER: SessionGroupId[] = [
  "today",
  "yesterday",
  "week",
  "month",
  "older",
];

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/** Which group a timestamp belongs to, by the reader's calendar days. */
export function sessionGroupFor(updatedAt: string, now: Date): SessionGroupId {
  const time = new Date(updatedAt);
  if (Number.isNaN(time.getTime())) return "older";
  const days = Math.round(
    (startOfDay(now).getTime() - startOfDay(time).getTime()) / 86_400_000,
  );
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return "week";
  if (days < 30) return "month";
  return "older";
}

/** Non-empty groups, newest first; the order inside a group is kept. */
export function groupSessions<T extends { updatedAt: string }>(
  sessions: readonly T[],
  now: Date,
): { id: SessionGroupId; label: string; items: T[] }[] {
  const groups = new Map<SessionGroupId, T[]>();
  for (const session of sessions) {
    const id = sessionGroupFor(session.updatedAt, now);
    groups.set(id, [...(groups.get(id) ?? []), session]);
  }
  return ORDER.filter((id) => groups.has(id)).map((id) => ({
    id,
    label: SESSION_GROUP_LABEL[id],
    items: groups.get(id)!,
  }));
}
