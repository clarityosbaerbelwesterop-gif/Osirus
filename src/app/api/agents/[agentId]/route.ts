import { z } from "zod";
import { env, serverKeys } from "@/lib/env";
import { guardAction, guardWrite, json } from "@/lib/product/api";
import { deleteAgent, updateAgent } from "@/lib/agents/store";
import { isRetiredProductModel } from "@/lib/models/catalog";
import { listKeyModels } from "@/lib/models/key-models";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const schema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  systemPrompt: z.string().trim().max(8000).optional(),
  modelId: z.string().trim().min(1).max(200).optional(),
  status: z.enum(["active", "paused"]).optional(),
});

export async function PATCH(
  request: Request,
  context: { params: Promise<{ agentId: string }> },
) {
  const { agentId } = await context.params;
  if (!z.string().uuid().safeParse(agentId).success) {
    return json({ error: "invalid_request" }, 400);
  }
  const guard = await guardWrite(request, {
    schema,
    route: "agents.update",
    limit: 30,
    maxBytes: 12_000,
  });
  if (!guard.ok) return guard.response;
  if (guard.body.modelId) {
    if (isRetiredProductModel(guard.body.modelId)) {
      return json({ error: "retired_model" }, 400);
    }
    const keyModels = await listKeyModels({
      baseUrl: env.UNOROUTER_BASE_URL,
      keys: serverKeys(),
    });
    if (keyModels.availability !== "ready") {
      return json(
        { error: "key_models_unknown", message: keyModels.reason },
        503,
      );
    }
    if (!keyModels.models.some((model) => model.id === guard.body.modelId)) {
      return json({ error: "model_not_on_key" }, 400);
    }
  }
  const agent = await updateAgent({
    identity: guard.identity,
    id: agentId,
    name: guard.body.name,
    systemPrompt: guard.body.systemPrompt,
    modelId: guard.body.modelId,
    status: guard.body.status,
  });
  if (!agent) return json({ error: "not_found" }, 404);
  return json({ agent });
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ agentId: string }> },
) {
  const { agentId } = await context.params;
  if (!z.string().uuid().safeParse(agentId).success) {
    return json({ error: "invalid_request" }, 400);
  }
  const guard = await guardAction(request, {
    route: "agents.delete",
    limit: 20,
  });
  if (!guard.ok) return guard.response;
  const removed = await deleteAgent(guard.identity, agentId);
  if (!removed) return json({ error: "not_found" }, 404);
  return json({ ok: true });
}
