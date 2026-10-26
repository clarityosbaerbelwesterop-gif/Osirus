import { AgentsStudio } from "@/components/agents/agents-studio";
import { PageFrame } from "@/components/shell/page-frame";
import { listAgents } from "@/lib/agents/store";
import { modelAccessFor, modelAllowed } from "@/lib/gateway/access";
import { listGatewayModels } from "@/lib/gateway/models";
import { requireProductSession } from "@/lib/product/session";

export const dynamic = "force-dynamic";

/** Bots: own personas with a model and instructions, used in Agents with @Name. */
export default async function BotsPage() {
  const { identity, user } = await requireProductSession();
  const [agents, listing, access] = await Promise.all([
    listAgents(identity),
    listGatewayModels(),
    modelAccessFor({
      userId: identity.userId,
      email: user.email,
      emailVerified: user.emailVerified,
    }),
  ]);
  return (
    <PageFrame
      title="Bots"
      lede="Eigene Bots mit Persona und Modell. In Agents per Klick oder mit @Name ansprechen."
    >
      <AgentsStudio
        initialAgents={agents.map((agent) => ({
          id: agent.id,
          name: agent.name,
          modelId: agent.model_id,
          status: agent.status,
        }))}
        models={listing.models
          .filter((model) => modelAllowed(model, access))
          .map((model) => ({
            id: model.ref,
            label: `${model.name} · ${model.providerLabel}`,
          }))}
      />
    </PageFrame>
  );
}
