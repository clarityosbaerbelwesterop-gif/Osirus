/**
 * Who speaks in a group chat.
 *
 * Open owner decision: only mentioned agents, or a moderator.
 * Until that is decided, only an explicit @Name is asked.
 * A message with no mention gets no agent reply.
 */

export type MentionAgent = { id: string; name: string };

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function agentsMentioned(
  content: string,
  members: readonly MentionAgent[],
): MentionAgent[] {
  const hits: { agent: MentionAgent; index: number; length: number }[] = [];
  for (const agent of members) {
    const name = agent.name.trim();
    if (!name) continue;
    const pattern = new RegExp(`@${escapeRegExp(name)}(?=$|[\\s.,!?;:])`, "gi");
    for (const match of content.matchAll(pattern)) {
      if (match.index === undefined) continue;
      hits.push({ agent, index: match.index, length: name.length });
    }
  }
  hits.sort((a, b) => a.index - b.index || b.length - a.length);
  const kept: MentionAgent[] = [];
  const seen = new Set<string>();
  for (const hit of hits) {
    const covered = hits.some(
      (other) =>
        other !== hit && other.index === hit.index && other.length > hit.length,
    );
    if (covered || seen.has(hit.agent.id)) continue;
    seen.add(hit.agent.id);
    kept.push(hit.agent);
  }
  return kept;
}

/** "@alle" (or "@all") asks every bot of the group. */
export function everyoneMentioned(content: string) {
  return /(^|\s)@(alle|all)(?=$|[\s.,!?;:])/i.test(content);
}
