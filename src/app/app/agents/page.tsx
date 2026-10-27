import { BotsHub } from "@/components/bots/bots-hub";
import { PageFrame } from "@/components/shell/page-frame";
import { botRole } from "@/lib/agents/role";
import { listAgents, listGroupChats } from "@/lib/agents/store";
import { botTier } from "@/lib/gateway/routing";
import { requireProductSession } from "@/lib/product/session";

export const dynamic = "force-dynamic";

/** Bots: the team, each bot's own room, and the group chats that stay. */
export default async function BotsPage() {
  const { identity } = await requireProductSession();
  const [agents, groups] = await Promise.all([
    listAgents(identity),
    listGroupChats(identity).catch(() => []),
  ]);
  return (
    <PageFrame
      title="Bots"
      lede="Dein Team aus Spezialisten. Jeder Bot hat seinen eigenen Raum und erinnert sich an eure Unterhaltungen; im Gruppenchat arbeiten mehrere zusammen."
    >
      <BotsHub
        bots={agents.map((agent) => ({
          id: agent.id,
          name: agent.name,
          status: agent.status,
          role: botRole(agent.system_prompt),
          tier: botTier(agent),
        }))}
        groups={groups}
      />
    </PageFrame>
  );
}
