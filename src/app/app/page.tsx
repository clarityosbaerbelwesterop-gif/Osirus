import { AgentsChat } from "@/components/agents-chat/agents-chat";
import { listAgents } from "@/lib/agents/store";
import { isUuid, loadChatThread } from "@/lib/gateway/threads";
import { firstName, requireProductSession } from "@/lib/product/session";

export const dynamic = "force-dynamic";

/**
 * Agents: the chat. One model call per message, streamed token by token,
 * with every model a configured key can call and the workspace's own bots.
 */
export default async function AgentsPage({
  searchParams,
}: {
  searchParams: Promise<{ session?: string; bot?: string; prompt?: string }>;
}) {
  const session = await requireProductSession();
  const params = await searchParams;
  const [thread, bots] = await Promise.all([
    isUuid(params.session)
      ? loadChatThread(session.identity, params.session).catch(() => null)
      : Promise.resolve(null),
    listAgents(session.identity).catch(() => []),
  ]);
  return (
    <AgentsChat
      // A new prompt link (e.g. from the tour) on this page starts fresh.
      key={thread?.sessionId ?? `new:${params.prompt ?? ""}`}
      initialThread={thread}
      bots={bots
        .filter((bot) => bot.status === "active")
        .map((bot) => ({ id: bot.id, name: bot.name }))}
      greetingName={firstName(session.user)}
      initialBotId={isUuid(params.bot) ? params.bot : null}
      initialPrompt={params.prompt?.slice(0, 8000) ?? null}
    />
  );
}
