import { fingerprint } from "../evals/random";
import type { IntelStore } from "../store/store";
import type {
  ExperimentDecision,
  Hypothesis,
  LearningArtifact,
  StrategyVersion,
} from "../types";
import { ablationCause, ablationHypotheses, changedFields } from "./credit";
import {
  mechanismOf,
  metaPolicyOf,
  orderByMetaPolicy,
  updateMetaPolicy,
  type MetaPolicy,
} from "./meta-policy";

// Where M42 meets the research loop: the meta-policy that orders
// hypotheses, updated from every concluded experiment, and the ablation
// plan a multi-change winner leaves for the next cycle of its capability.

const META_FINGERPRINT = fingerprint("meta_policy", "global");

export async function loadMetaPolicy(store: IntelStore): Promise<MetaPolicy> {
  return metaPolicyOf(
    await store.listArtifacts({
      kind: "meta_policy",
      status: "active",
      limit: 5,
    }),
  );
}

/** Pending ablation plan for a capability, if a multi-change winner left one. */
export async function pendingAblation(store: IntelStore, capabilityId: string) {
  const [plan] = await store.listArtifacts({
    kind: "ablation_result",
    capabilityId,
    status: "proposed",
    limit: 1,
  });
  return plan ?? null;
}

/**
 * Candidate hypotheses for a cycle: a pending ablation plan's variants
 * first (they answer a question an earlier cycle opened), then the pool
 * ordered by the meta-policy's Thompson sample.
 */
export async function planHypotheses(
  store: IntelStore,
  input: {
    capabilityId: string;
    cycleId: string;
    pool: Hypothesis[];
    limit: number;
  },
): Promise<{ hypotheses: Hypothesis[]; ablation: LearningArtifact | null }> {
  const plan = await pendingAblation(store, input.capabilityId);
  const variants = (plan?.content.variants as Hypothesis[] | undefined) ?? [];
  if (plan && variants.length) {
    await store.insertGenerationRun({
      cycleId: input.cycleId,
      kind: "ablation",
      config: { capabilityId: input.capabilityId, fields: plan.content.fields },
      produced: variants.length,
      verified: 0,
      rejected: 0,
      summary: { reason: "a winner changed several fields at once" },
    });
    return { hypotheses: variants.slice(0, input.limit), ablation: plan };
  }
  const policy = await loadMetaPolicy(store);
  return {
    hypotheses: orderByMetaPolicy(input.pool, policy, input.cycleId).slice(
      0,
      input.limit,
    ),
    ablation: null,
  };
}

function gainOf(decision: ExperimentDecision, versionId: string) {
  const rows = decision.comparisons.filter(
    (entry) => entry.versionId === versionId && entry.tasks > 0,
  );
  if (!rows.length) return { gain: 0, n: 0, costRatio: null as number | null };
  const tasks = rows.reduce((sum, entry) => sum + entry.tasks, 0);
  const gain =
    rows.reduce(
      (sum, entry) =>
        sum + (entry.challenger.verified - entry.champion.verified),
      0,
    ) / tasks;
  const costRatio =
    rows.find((entry) => entry.costRatio !== null)?.costRatio ?? null;
  return { gain, n: tasks, costRatio };
}

/**
 * After a decision: fold each challenger into the meta-policy; resolve a
 * pending ablation (name the cause, or say none was isolated); and when a
 * winner changed several fields at once, leave an ablation plan.
 */
export async function recordExperimentMeta(
  store: IntelStore,
  input: {
    cycleId: string;
    capabilityId: string;
    champion: StrategyVersion;
    challengers: StrategyVersion[];
    hypotheses: Hypothesis[];
    decision: ExperimentDecision;
    ablation: LearningArtifact | null;
  },
) {
  let policy = await loadMetaPolicy(store);
  for (const version of input.challengers) {
    const hypothesis = input.hypotheses.find(
      (entry) =>
        entry.id === (version.mutation as { hypothesis?: string })?.hypothesis,
    );
    if (!hypothesis) continue;
    const { gain, costRatio } = gainOf(input.decision, version.id);
    policy = updateMetaPolicy(policy, {
      gap: hypothesis.gap,
      mechanism: mechanismOf(hypothesis),
      improved:
        input.decision.outcome === "improved" &&
        input.decision.winnerVersionId === version.id,
      effect: gain,
      // Relative cost as tokens-equivalent: a 2x cost ratio reads as +10k.
      extraTokens: costRatio !== null ? Math.max(0, costRatio - 1) * 10_000 : 0,
    });
  }
  await store.upsertArtifact({
    cycleId: input.cycleId,
    kind: "meta_policy",
    capabilityId: null,
    taskPattern: "global",
    content: policy as unknown as Record<string, unknown>,
    evidence: { lastCycle: input.cycleId },
    support: policy.stats.reduce((sum, stat) => sum + stat.tried, 0),
    status: "active",
    fingerprint: META_FINGERPRINT,
  });

  if (input.ablation) {
    const variants = input.challengers.map((version) => {
      const hypothesis = input.hypotheses.find(
        (entry) =>
          entry.id ===
          (version.mutation as { hypothesis?: string })?.hypothesis,
      );
      const { gain, n } = gainOf(input.decision, version.id);
      return {
        field: String(Object.keys(hypothesis?.intervention ?? {})[0] ?? "?"),
        gain,
        n,
      };
    });
    const cause = ablationCause({
      winnerGain: Number(input.ablation.content.winnerGain ?? 0),
      variants,
    });
    await store.upsertArtifact({
      ...input.ablation,
      content: { ...input.ablation.content, variantsMeasured: variants, cause },
      status: "active",
    });
    if (cause)
      await store.upsertArtifact({
        cycleId: input.cycleId,
        kind: "causal_memory",
        capabilityId: input.capabilityId,
        taskPattern: `${input.capabilityId}:ablation`,
        content: {
          intervention: cause.field,
          effect: `alone carries ${(cause.share * 100).toFixed(0)}% of the winner's gain`,
          direction: "improves",
        },
        evidence: {
          design: "ablation: champion plus one of the winner's changes each",
          fields: input.ablation.content.fields,
        },
        support: variants.reduce((sum, entry) => sum + entry.n, 0),
        status: "active",
        fingerprint: fingerprint(
          "causal",
          "ablation",
          input.ablation.fingerprint,
        ),
      });
    return;
  }

  const winner = input.challengers.find(
    (version) => version.id === input.decision.winnerVersionId,
  );
  if (input.decision.outcome !== "improved" || !winner) return;
  const fields = changedFields(input.champion.genome, winner.genome);
  if (fields.length < 2) return;
  const variants = ablationHypotheses(input.champion.genome, winner.genome);
  await store.upsertArtifact({
    cycleId: input.cycleId,
    kind: "ablation_result",
    capabilityId: input.capabilityId,
    taskPattern: `${input.capabilityId}:ablation`,
    content: {
      fields,
      winnerVersionId: winner.id,
      winnerGain: gainOf(input.decision, winner.id).gain,
      variants,
    },
    evidence: { experimentCycle: input.cycleId },
    support: 0,
    status: "proposed",
    fingerprint: fingerprint("ablation", winner.id),
  });
}
