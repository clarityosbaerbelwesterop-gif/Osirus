import type { Metadata } from "next";
import {
  HistoryBrowser,
  type HistoryEntry,
} from "@/components/bots/history-browser";
import { PageFrame } from "@/components/shell/page-frame";
import { listAgents, listGroupChats } from "@/lib/agents/store";
import { sessionHref } from "@/lib/product/surfaces";
import { requireProductSession } from "@/lib/product/session";
import { RuntimeRepository } from "@/lib/runtime/repository";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Verlauf" };

const KIND = {
  ai: "chat",
  bot: "bot",
  agent: "rouge",
  work: "rouge",
  coding: "code",
} as const;

/** Every conversation of the workspace: chats, bots, groups, Rouge, Code. */
export default async function HistoryPage() {
  const { identity } = await requireProductSession();
  const repository = new RuntimeRepository(identity.userId);
  const [sessions, groups, bots] = await Promise.all([
    repository.listWorkspaceSessions(identity.workspaceId, undefined, 500),
    listGroupChats(identity).catch(() => []),
    listAgents(identity).catch(() => []),
  ]);
  const botName = new Map(bots.map((bot) => [bot.id, bot.name]));
  const entries: HistoryEntry[] = [
    ...sessions.map((session) => ({
      id: session.id,
      title: session.title,
      updatedAt: session.updatedAt,
      kind: KIND[session.surface ?? "ai"],
      href: sessionHref(session),
      seeds: session.botId ? [session.botId] : [],
      detail: session.botId ? (botName.get(session.botId) ?? null) : null,
    })),
    ...groups.map((group) => ({
      id: group.id,
      title: group.title,
      updatedAt: group.updatedAt,
      kind: "group" as const,
      href: `/app/agents/groups/${group.id}`,
      seeds: group.members.map((member) => member.id),
      detail: group.members.map((member) => member.name).join(", ") || null,
    })),
  ].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return (
    <PageFrame
      title="Verlauf"
      lede="Alles, was du mit Osirus besprochen und erledigt hast: Chats, Bots, Gruppen, Rouge Agent und Code."
    >
      <HistoryBrowser entries={entries} />
    </PageFrame>
  );
}
