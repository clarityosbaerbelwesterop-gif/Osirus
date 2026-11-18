import { after } from "next/server";
import { z } from "zod";
import { env, serverKeys } from "@/lib/env";
import { guardAction, guardWrite, json } from "@/lib/product/api";
import {
  BotNameTakenError,
  deleteAgent,
  updateAgent,
} from "@/lib/agents/store";
import { isRetiredProductModel } from "@/lib/models/catalog";
import { listKeyModels, listNvidiaTopModels } from "@/lib/models/key-models";
import { resolveGatewayModel } from "@/lib/gateway/models";
import { isGatewayRef } from "@/lib/gateway/providers";
import { botTier } from "@/lib/gateway/routing";

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
  if (guard.body.modelId && isGatewayRef(guard.body.modelId)) {
    if (!(await resolveGatewayModel(guard.body.modelId))) {
      return json({ error: "model_not_on_key" }, 400);
    }
  } else if (guard.body.modelId) {
    if (isRetiredProductModel(guard.body.modelId)) {
      return json({ error: "retired_model" }, 400);
    }
    const [nvidia, keyModels] = await Promise.all([
      listNvidiaTopModels(),
      listKeyModels({
        baseUrl: env.UNOROUTER_BASE_URL,
        keys: serverKeys(),
      }),
    ]);
    const allowed = [
      ...(nvidia.availability === "ready" ? nvidia.models : []),
      ...(keyModels.availability === "ready" ? keyModels.models : []),
    ];
    if (!allowed.length) {
      return json(
        {
          error: "key_models_unknown",
          message:
            keyModels.availability === "unknown"
              ? keyModels.reason
              : "Bald verfügbar.",
        },
        503,
      );
    }
    if (!allowed.some((model) => model.id === guard.body.modelId)) {
      return json({ error: "model_not_on_key" }, 400);
    }
  }
  let agent;
  try {
    agent = await updateAgent({
      identity: guard.identity,
      id: agentId,
      name: guard.body.name,
      systemPrompt: guard.body.systemPrompt,
      modelId: guard.body.modelId,
      status: guard.body.status,
    });
  } catch (error) {
    if (error instanceof BotNameTakenError)
      return json({ error: error.code, message: error.message }, 409);
    throw error;
  }
  if (!agent) return json({ error: "not_found" }, 404);
  return json({
    agent: {
      id: agent.id,
      name: agent.name,
      status: agent.status,
      tier: botTier(agent),
    },
  });
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
  // The bot's cloud computer and its files go with it.
  const { resolveSandbox } = await import("@/lib/sandbox");
  const driver = await resolveSandbox();
  const workspaceId = guard.identity.workspaceId;
  const removeComputers = async () => {
    const { deleteComputers } = await import("@/lib/agents/bot-computer");
    await deleteComputers(driver, workspaceId, [agentId]).catch(
      () => undefined,
    );
  };
  try {
    after(removeComputers);
  } catch {
    // Outside a request scope (scripts, tests): run it right away.
    void removeComputers();
  }
  return json({ ok: true });
}
