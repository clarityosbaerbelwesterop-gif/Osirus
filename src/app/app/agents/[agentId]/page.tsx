import type { Route } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AgentsChat } from "@/components/agents-chat/agents-chat";
import { PageFrame } from "@/components/shell/page-frame";
import { botRole } from "@/lib/agents/role";
import { getAgent, listAgents, listBotConversations } from "@/lib/agents/store";
import { isUuid, loadChatThread } from "@/lib/gateway/threads";
import { firstName, requireProductSession } from "@/lib/product/session";

export const dynamic = "force-dynamic";

/** A bot's own room: one chat partner, its conversations, its orb. */
export default async function BotRoomPage({
  params,
  searchParams,
}: {
  params: Promise<{ agentId: string }>;
  searchParams: Promise<{ session?: string; prompt?: string }>;
}) {
  const [{ agentId }, query] = await Promise.all([params, searchParams]);
  if (!isUuid(agentId)) notFound();
  const session = await requireProductSession();
  const [bot, bots, thread, conversations] = await Promise.all([
    getAgent(session.identity, agentId),
    listAgents(session.identity).catch(() => []),
    isUuid(query.session)
      ? loadChatThread(session.identity, query.session).catch(() => null)
      : Promise.resolve(null),
    listBotConversations(session.identity, agentId).catch(() => []),
  ]);
  // A removed bot's threads stay in the history and open as plain chats.
  if (!bot) {
    if (thread) redirect(`/app?session=${thread.sessionId}` as Route);
    notFound();
  }
  if (bot.status !== "active") {
    return (
      <PageFrame title={bot.name} lede="Dieser Bot ist pausiert.">
        <p>
          Aktiviere ihn unter <Link href={"/app/agents" as Route}>Bots</Link>,
          dann antwortet er wieder.
        </p>
      </PageFrame>
    );
  }
  return (
    <AgentsChat
      key={thread?.sessionId ?? `room:${agentId}:${query.prompt ?? ""}`}
      initialThread={thread}
      bots={bots
        .filter((item) => item.status === "active")
        .map((item) => ({ id: item.id, name: item.name }))}
      greetingName={firstName(session.user)}
      initialPrompt={query.prompt?.slice(0, 8000) ?? null}
      room={{
        bot: { id: bot.id, name: bot.name },
        role: botRole(bot.system_prompt),
        conversations,
      }}
    />
  );
}
