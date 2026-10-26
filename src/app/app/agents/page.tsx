import { AgentsStudio } from "@/components/agents/agents-studio";
import { PageFrame } from "@/components/shell/page-frame";
import { listAgents } from "@/lib/agents/store";
import { botTier } from "@/lib/gateway/routing";
import { requireProductSession } from "@/lib/product/session";

export const dynamic = "force-dynamic";

/** Bots: own personas with a role, used in Agents by click or with @Name. */
export default async function BotsPage() {
  const { identity } = await requireProductSession();
  const agents = await listAgents(identity);
  return (
    <PageFrame
      title="Bots"
      lede="Eigene Bots mit Rolle und Persona. In Agents per Klick oder mit @Name ansprechen."
    >
      <AgentsStudio
        initialAgents={agents.map((agent) => ({
          id: agent.id,
          name: agent.name,
          status: agent.status,
          tier: botTier(agent),
        }))}
      />
    </PageFrame>
  );
}
