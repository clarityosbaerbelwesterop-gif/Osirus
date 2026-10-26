import { z } from "zod";
import { env, serverKeys } from "@/lib/env";
import { apiIdentity, guardWrite, json } from "@/lib/product/api";
import { createAgent, listAgents } from "@/lib/agents/store";
import { isRetiredProductModel } from "@/lib/models/catalog";
import { listKeyModels, listNvidiaTopModels } from "@/lib/models/key-models";
import { resolveGatewayModel } from "@/lib/gateway/models";
import { isGatewayRef } from "@/lib/gateway/providers";
import { botTier } from "@/lib/gateway/routing";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// A bot has a role, not a model: "auto" lets Osirus pick the model from
// what the bot does (gateway/routing.ts). An explicit model id is still
// accepted from API clients.
const schema = z.object({
  name: z.string().trim().min(1).max(80),
  systemPrompt: z.string().trim().max(8000).optional().default(""),
  modelId: z.string().trim().min(1).max(200).optional().default("auto"),
});

async function allowedModelIds() {
  const [nvidia, unorouter] = await Promise.all([
    listNvidiaTopModels(),
    listKeyModels({
      baseUrl: env.UNOROUTER_BASE_URL,
      keys: serverKeys(),
    }),
  ]);
  const merged = [
    ...(nvidia.availability === "ready" ? nvidia.models : []),
    ...(unorouter.availability === "ready" ? unorouter.models : []),
  ];
  return merged.length
    ? ({ availability: "ready" as const, models: merged } as const)
    : unorouter;
}

/** What the browser learns about a bot: never its model. */
function publicAgent(agent: {
  id: string;
  name: string;
  system_prompt: string | null;
  status: string;
}) {
  return {
    id: agent.id,
    name: agent.name,
    status: agent.status,
    tier: botTier(agent),
  };
}

export async function GET() {
  const identity = await apiIdentity();
  if (!identity) return json({ error: "unauthorized" }, 401);
  const agents = await listAgents(identity);
  return json({ agents: agents.map(publicAgent) });
}

export async function POST(request: Request) {
  const guard = await guardWrite(request, {
    schema,
    route: "agents.create",
    limit: 20,
    maxBytes: 12_000,
  });
  if (!guard.ok) return guard.response;
  if (guard.body.modelId === "auto") {
    const agent = await createAgent({
      identity: guard.identity,
      name: guard.body.name,
      systemPrompt: guard.body.systemPrompt,
      modelId: "auto",
    });
    if (!agent) return json({ error: "not_created" }, 409);
    return json({ agent: publicAgent(agent) }, 201);
  }
  if (isRetiredProductModel(guard.body.modelId)) {
    return json(
      {
        error: "retired_model",
        message: "Dieses Modell wird nicht angeboten.",
      },
      400,
    );
  }
  if (isGatewayRef(guard.body.modelId)) {
    if (!(await resolveGatewayModel(guard.body.modelId))) {
      return json(
        {
          error: "model_not_on_key",
          message: "Dieses Modell ist gerade nicht verfügbar.",
        },
        400,
      );
    }
    const agent = await createAgent({
      identity: guard.identity,
      name: guard.body.name,
      systemPrompt: guard.body.systemPrompt,
      modelId: guard.body.modelId,
    });
    if (!agent) return json({ error: "not_created" }, 409);
    return json({ agent: publicAgent(agent) }, 201);
  }
  const keyModels = await allowedModelIds();
  if (keyModels.availability !== "ready") {
    return json(
      {
        error: "key_models_unknown",
        message: keyModels.reason,
      },
      503,
    );
  }
  if (!keyModels.models.some((model) => model.id === guard.body.modelId)) {
    return json(
      {
        error: "model_not_on_key",
        message: "Der Key führt dieses Modell nicht.",
      },
      400,
    );
  }
  const agent = await createAgent({
    identity: guard.identity,
    name: guard.body.name,
    systemPrompt: guard.body.systemPrompt,
    modelId: guard.body.modelId,
  });
  if (!agent) return json({ error: "not_created" }, 409);
  return json({ agent: publicAgent(agent) }, 201);
}
