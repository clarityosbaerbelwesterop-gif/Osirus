import { z } from "zod";
import { quotaEnforced, quotaStatusFor } from "@/lib/billing/enforce";
import { serializeQuota } from "@/lib/billing/quota";
import { guardWrite, json } from "@/lib/product/api";
import { getAgent } from "@/lib/agents/store";
import { completePinned } from "@/lib/models/pinned-call";
import { queryAs } from "@/lib/db/client";
import { publicRuntimeErrorMessage } from "@/lib/runtime/errors";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

const schema = z.object({
  content: z.string().trim().min(1).max(8000),
});

export async function POST(
  request: Request,
  context: { params: Promise<{ agentId: string }> },
) {
  const { agentId } = await context.params;
  if (!z.string().uuid().safeParse(agentId).success) {
    return json({ error: "invalid_request" }, 400);
  }
  const guard = await guardWrite(request, {
    schema,
    route: "agents.test",
    limit: 20,
    maxBytes: 12_000,
  });
  if (!guard.ok) return guard.response;
  if (quotaEnforced()) {
    const quota = await quotaStatusFor(guard.identity.userId);
    if (!quota.allowed) {
      const noPlan = quota.reason === "no_subscription";
      return Response.json(
        {
          error: noPlan ? "subscription_required" : "quota_exhausted",
          message: publicRuntimeErrorMessage({
            code: noPlan ? "subscription_required" : "quota_exhausted",
          }),
          quota: serializeQuota(quota),
        },
        {
          status: noPlan ? 402 : 429,
          headers: noPlan
            ? undefined
            : { "Retry-After": String(Math.ceil(quota.retryAfterMs / 1000)) },
        },
      );
    }
  }
  const agent = await getAgent(guard.identity, agentId);
  if (!agent) return json({ error: "not_found" }, 404);
  if (agent.status !== "active") {
    return json(
      {
        status: "unavailable",
        message:
          "Bald verfügbar. Der Agent ist pausiert und hat nicht geantwortet.",
      },
      409,
    );
  }
  try {
    const result = await completePinned({
      modelId: agent.model_id,
      userId: guard.identity.userId,
      messages: [
        ...(agent.system_prompt
          ? [{ role: "system" as const, content: agent.system_prompt }]
          : []),
        { role: "user" as const, content: guard.body.content },
      ],
    });
    await queryAs(
      guard.identity.userId,
      `insert into osirus.model_calls
         (organization_id, workspace_id, provider, model, logical_role, status,
          input_tokens, output_tokens, estimated_cost_usd, completed_at,
          request_metadata)
       values ($1::uuid, $2::uuid, 'unorouter', $3, 'STRONG', 'completed',
               $4, $5, $6, now(), $7::jsonb)`,
      [
        guard.identity.organizationId,
        guard.identity.workspaceId,
        result.modelId,
        result.inputTokens ?? null,
        result.outputTokens ?? null,
        result.costUsd ?? null,
        JSON.stringify({
          purpose: "agent_test",
          agentId,
          userId: guard.identity.userId,
        }),
      ],
    );
    return json({
      status: "completed",
      modelId: result.modelId,
      text: result.text,
    });
  } catch {
    return json(
      {
        status: "unavailable",
        message:
          "Bald verfügbar. Das Modell hat nicht geantwortet. Es wurde keine Ersatzantwort erzeugt.",
      },
      503,
    );
  }
}
