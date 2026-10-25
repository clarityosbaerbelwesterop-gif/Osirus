import { AgentsStudio } from "@/components/agents/agents-studio";
import { PageFrame } from "@/components/shell/page-frame";
import { listAgents } from "@/lib/agents/store";
import { env, serverKeys } from "@/lib/env";
import { listKeyModels } from "@/lib/models/key-models";
import { requireProductSession } from "@/lib/product/session";

export const dynamic = "force-dynamic";

export default async function AgentsPage() {
  const { identity } = await requireProductSession();
  const [agents, models] = await Promise.all([
    listAgents(identity),
    listKeyModels({
      baseUrl: env.UNOROUTER_BASE_URL,
      keys: serverKeys(),
    }),
  ]);
  return (
    <PageFrame
      title="Agents"
      lede="Bots mit eigenem Modell und Gruppenchats. Deploy gibt es nicht."
    >
      <AgentsStudio
        initialAgents={agents.map((agent) => ({
          id: agent.id,
          name: agent.name,
          modelId: agent.model_id,
          status: agent.status,
        }))}
        models={models.availability === "ready" ? models.models : []}
      />
    </PageFrame>
  );
}
