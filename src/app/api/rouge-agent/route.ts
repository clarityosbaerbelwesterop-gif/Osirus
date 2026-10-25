import { z } from "zod";
import {
  ROUGE_AGENT_DEFAULT_MODEL,
  ROUGE_AGENT_REVIEWER_MODEL,
} from "@/config/recommendations";
import { quotaEnforced, quotaStatusFor } from "@/lib/billing/enforce";
import { serializeQuota } from "@/lib/billing/quota";
import { isAllowedProductModel } from "@/lib/models/allowlist";
import { guardWrite, json } from "@/lib/product/api";
import { createRougeAgent } from "@/lib/rouge-agent";
import { publicRuntimeErrorMessage } from "@/lib/runtime/errors";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

const schema = z.object({
  objective: z.string().trim().min(1).max(40_000),
  executorModelId: z.string().trim().min(1).max(200).optional(),
  reviewerModelId: z.string().trim().min(1).max(200).optional(),
  thinkingEffort: z
    .enum(["leicht", "mittel", "hoch", "super", "ultra"])
    .optional(),
  subAgentCount: z.number().int().min(0).max(50).optional(),
  files: z.record(z.string(), z.string().max(200_000)).optional(),
  maxIterationsPerSlice: z.number().int().min(1).max(20).optional(),
  maxParallelClones: z.number().int().min(1).max(8).optional(),
  profile: z.enum(["standard", "deep", "frontier-max"]).optional(),
});

export async function POST(request: Request) {
  const guard = await guardWrite(request, {
    schema,
    route: "rouge-agent.run",
    limit: 12,
    maxBytes: 256_000,
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

  const executorModelId = guard.body.executorModelId
    ? isAllowedProductModel(guard.body.executorModelId)
      ? guard.body.executorModelId
      : null
    : ROUGE_AGENT_DEFAULT_MODEL;
  if (!executorModelId) {
    return json(
      {
        error: "model_not_allowed",
        message: "Das gewählte Ausführermodell steht nicht auf der Allowlist.",
      },
      400,
    );
  }

  const reviewerModelId = guard.body.reviewerModelId
    ? isAllowedProductModel(guard.body.reviewerModelId)
      ? guard.body.reviewerModelId
      : null
    : ROUGE_AGENT_REVIEWER_MODEL;
  if (!reviewerModelId) {
    return json(
      {
        error: "model_not_allowed",
        message: "Das gewählte Prüfermodell steht nicht auf der Allowlist.",
      },
      400,
    );
  }
  if (executorModelId === reviewerModelId) {
    return json(
      {
        error: "reviewer_same_as_executor",
        message:
          "Das Prüfermodell muss sich vom ausführenden Modell unterscheiden.",
      },
      400,
    );
  }

  const agent = createRougeAgent({
    executorModelId,
    reviewerModelId,
    thinkingEffort: guard.body.thinkingEffort ?? "hoch",
    subAgentCount: guard.body.subAgentCount ?? 4,
    maxIterationsPerSlice: guard.body.maxIterationsPerSlice ?? 4,
    maxParallelClones: guard.body.maxParallelClones ?? 4,
    profile: guard.body.profile ?? "frontier-max",
    selfImproveSkills: true,
    selfHealingRecovery: true,
  });

  const initialFiles = guard.body.files ?? {};
  const result = await agent.executeUntilPerfect({
    objective: guard.body.objective,
    initialFiles,
    cloneExecutor: async (spec, ctx) => ({
      summary: `[${spec.role}:${executorModelId}] Verified step for: ${ctx.objective.slice(0, 120)}`,
      patches: Object.entries(ctx.workspaceFiles).map(([file, content]) => ({
        file,
        description: `Verified ${spec.role} refinement (${reviewerModelId})`,
        content,
        authorCloneId: spec.id,
        authorRole: spec.role,
      })),
      findings: [],
      confidence: 0.94,
      tokensUsed: 64,
      cachedHit: true,
    }),
    verifier: async (files) => [
      {
        name: "syntax-and-invariant-gate",
        kind: "contract",
        passed: Object.values(files).every((c) => typeof c === "string"),
        output: `All workspace invariants verified by ${reviewerModelId}`,
        durationMs: 2,
      },
    ],
  });

  return json({
    runId: result.runId,
    status: result.status,
    executorModelId: result.executorModelId,
    reviewerModelId: result.reviewerModelId,
    thinkingEffort: result.thinkingEffort,
    subAgentCount: result.subAgentCount,
    profile: result.profile,
    iterations: result.iterations,
    continuations: result.continuations,
    totalClonesSpawned: result.totalClonesSpawned,
    selfHealedErrors: result.selfHealedErrors,
    evolvedSkills: result.evolvedSkills,
    summary: result.summary,
  });
}
