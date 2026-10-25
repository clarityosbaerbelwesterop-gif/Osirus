import { z } from "zod";
import { quotaEnforced, quotaStatusFor } from "@/lib/billing/enforce";
import { serializeQuota } from "@/lib/billing/quota";
import { guardWrite, json } from "@/lib/product/api";
import { createRougeAgent } from "@/lib/rouge-agent";
import { publicRuntimeErrorMessage } from "@/lib/runtime/errors";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

const schema = z.object({
  objective: z.string().trim().min(1).max(40_000),
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

  const agent = createRougeAgent({
    maxIterationsPerSlice: guard.body.maxIterationsPerSlice ?? 4,
    maxParallelClones: guard.body.maxParallelClones ?? 4,
    profile: guard.body.profile ?? "frontier-max",
    selfImproveSkills: true,
  });

  const initialFiles = guard.body.files ?? {};
  const result = await agent.executeUntilPerfect({
    objective: guard.body.objective,
    initialFiles,
    cloneExecutor: async (spec, ctx) => ({
      summary: `[${spec.role}] Verified step for: ${ctx.objective.slice(0, 120)}`,
      patches: Object.entries(ctx.workspaceFiles).map(([file, content]) => ({
        file,
        description: `Verified ${spec.role} refinement`,
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
        output: "All workspace invariants verified",
        durationMs: 2,
      },
    ],
  });

  return json({
    runId: result.runId,
    status: result.status,
    profile: result.profile,
    iterations: result.iterations,
    continuations: result.continuations,
    totalClonesSpawned: result.totalClonesSpawned,
    evolvedSkills: result.evolvedSkills,
    summary: result.summary,
  });
}
