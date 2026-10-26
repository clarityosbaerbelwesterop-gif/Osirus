import "server-only";
import { queryAs } from "@/lib/db/client";
import type { ProductIdentity } from "@/lib/auth/bootstrap";
import type { GatewayModel } from "./models";
import type { GatewayUsage } from "./stream";

// Every gateway call is one osirus.model_calls row without a run. The
// billing windows count such rows by request_metadata.userId, so chat
// spends the same 5-hour and weekly budgets as a run.

/** Used when a paid model publishes no price: deliberately not cheap. */
const UNKNOWN_PRICE = { input: 3, output: 15 };

export function estimateTokens(text: string) {
  return Math.ceil(text.length / 4);
}

/** USD for one call: the provider's figure, else the list price, else a conservative estimate. */
export function callCostUsd(model: GatewayModel, usage: GatewayUsage) {
  if (typeof usage.costUsd === "number" && usage.costUsd >= 0)
    return usage.costUsd;
  if (model.free) return 0;
  const input = model.inputPerMillionUsd ?? UNKNOWN_PRICE.input;
  const output = model.outputPerMillionUsd ?? UNKNOWN_PRICE.output;
  return (
    ((usage.inputTokens ?? 0) * input + (usage.outputTokens ?? 0) * output) /
    1_000_000
  );
}

export async function recordGatewayCall(input: {
  identity: ProductIdentity;
  model: GatewayModel;
  surface: string;
  sessionId: string | null;
  status: "completed" | "failed" | "cancelled";
  usage: GatewayUsage;
  latencyMs: number;
  errorCode?: string | null;
  cached?: boolean;
}) {
  const cost = input.cached ? 0 : callCostUsd(input.model, input.usage);
  await queryAs(
    input.identity.userId,
    `insert into osirus.model_calls
       (organization_id, workspace_id, run_id, stage_id, provider, model,
        logical_role, status, request_metadata, response_metadata,
        input_tokens, output_tokens, estimated_cost_usd, latency_ms,
        error_code, completed_at)
     values ($1::uuid, $2::uuid, null, null, $3, $4, 'CHAT', $5,
             $6::jsonb, $7::jsonb, $8, $9, $10, $11, $12, now())`,
    [
      input.identity.organizationId,
      input.identity.workspaceId,
      input.model.provider,
      input.model.ref,
      input.status,
      JSON.stringify({
        userId: input.identity.userId,
        surface: input.surface,
        sessionId: input.sessionId,
        gateway: true,
      }),
      JSON.stringify({ cached: Boolean(input.cached) }),
      input.usage.inputTokens ?? null,
      input.usage.outputTokens ?? null,
      cost,
      Math.round(input.latencyMs),
      input.errorCode ?? null,
    ],
  );
}
