import { z } from "zod";
import {
  assertFreePlanAllowed,
  quotaEnforced,
  quotaStatusFor,
} from "@/lib/billing/enforce";
import { serializeQuota } from "@/lib/billing/quota";
import { env, serverKeys } from "@/lib/env";
import { guardWrite, json } from "@/lib/product/api";
import { listKeyModels } from "@/lib/models/key-models";
import { completePinned } from "@/lib/models/pinned-call";
import { publicRuntimeErrorMessage } from "@/lib/runtime/errors";
import { executeWork, type WorkCaller } from "@/lib/work/execute";
import { recommendWork } from "@/lib/work/recommend";
import { applyWorkSelection } from "@/lib/work/selection";
import {
  finishWorkRun,
  openWorkRun,
  recordWorkModelCall,
} from "@/lib/work/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

const schema = z.object({
  prompt: z.string().trim().min(1).max(20_000),
  executorModelId: z.string().trim().min(1).max(200).optional(),
  reviewerModelId: z.string().trim().min(1).max(200).optional(),
  subAgentCount: z.number().int().min(0).max(50).optional(),
});

export async function POST(request: Request) {
  const guard = await guardWrite(request, {
    schema,
    route: "work.runs",
    limit: 8,
    maxBytes: 24_000,
  });
  if (!guard.ok) return guard.response;

  let userPlan: string | null = null;
  if (quotaEnforced()) {
    const quota = await quotaStatusFor(guard.identity.userId);
    userPlan = quota.plan;
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

  const recommendation = recommendWork(guard.body.prompt);
  const keyModels = await listKeyModels({
    baseUrl: env.UNOROUTER_BASE_URL,
    keys: serverKeys(),
  });
  const applied = applyWorkSelection({
    recommendation,
    executorModelId: guard.body.executorModelId,
    reviewerModelId: guard.body.reviewerModelId,
    subAgentCount: guard.body.subAgentCount,
    allowedModelIds:
      keyModels.availability === "ready"
        ? keyModels.models.map((model) => model.id)
        : null,
  });
  if (!applied.ok) {
    return json(
      { error: applied.error, message: applied.message },
      applied.error === "key_models_unknown" ? 503 : 400,
    );
  }
  if (userPlan === "free" && guard.body.subAgentCount !== undefined) {
    try {
      assertFreePlanAllowed({ subAgents: applied.selection.subAgentCount });
    } catch {
      return json(
        {
          error: "subagent_limit",
          message: publicRuntimeErrorMessage({ code: "subagent_limit" }),
        },
        403,
      );
    }
  }

  const opened = await openWorkRun({
    identity: guard.identity,
    prompt: guard.body.prompt,
    recommendation,
    selection: applied.selection,
  });
  const caller: WorkCaller = {
    async complete(call) {
      try {
        const result = await completePinned({
          modelId: call.modelId,
          messages: call.messages,
          userId: guard.identity.userId,
          role: call.purpose === "reviewer" ? "VERIFY" : "STRONG",
        });
        await recordWorkModelCall({
          identity: guard.identity,
          runId: opened.runId,
          model: result.modelId,
          role: call.purpose === "reviewer" ? "VERIFY" : "STRONG",
          status: "completed",
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
          costUsd: result.costUsd,
        });
        return result;
      } catch (error) {
        await recordWorkModelCall({
          identity: guard.identity,
          runId: opened.runId,
          model: call.modelId,
          role: call.purpose === "reviewer" ? "VERIFY" : "STRONG",
          status: "failed",
          errorCode:
            error instanceof Error ? error.message.slice(0, 80) : "failed",
        }).catch(() => undefined);
        throw error;
      }
    },
  };
  const execution = await executeWork({
    prompt: guard.body.prompt,
    selection: applied.selection,
    caller,
  });
  await finishWorkRun({
    identity: guard.identity,
    runId: opened.runId,
    execution,
  });
  return json({
    sessionId: opened.sessionId,
    runId: opened.runId,
    recommendation,
    selection: applied.selection,
    execution,
  });
}
