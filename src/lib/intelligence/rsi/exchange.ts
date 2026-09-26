import { z } from "zod";
import { fingerprint } from "../evals/random";
import { onAllowlist } from "../software-rsi/policy";
import type { IntelStore } from "../store/store";
import type { LearningArtifact } from "../types";
import { reserveCalls, settleCalls } from "./budget";
import type { LiveEvidence, LiveOrderContent } from "./phases";

// What the GitHub Actions runners take from, and hand back to, the cycle.
//
// Actions holds the free model's keys, never a database credential. It asks
// the OIDC-authenticated endpoints for work -- a live order, or a code
// hypothesis -- and reports what happened. Every take reserves model calls
// from the cycle's envelope first; every report settles them against what
// was spent. Reports are validated and bounded here, and decisions are
// recomputed by the cycle from the raw rows, never taken from the runner.

const HOUR = 3_600_000;
/** A code hypothesis is attempted at most once a day. */
const CODE_ATTEMPT_INTERVAL_MS = 24 * HOUR;
const CODE_CALLS = 3;

export async function takeLiveOrder(intel: IntelStore, now = new Date()) {
  const orders = await intel.listArtifacts({ kind: "live_order", limit: 50 });
  const order = orders.find(
    (artifact) => (artifact.content as LiveOrderContent).state === "open",
  );
  if (!order) return null;
  const content = order.content as LiveOrderContent;
  const { granted, budget } = await reserveCalls(intel, content.calls, now);
  if (granted < 2) {
    // Not even a pair: give back what was reserved and leave it open.
    if (granted)
      await settleCalls(intel, {
        reserved: granted,
        spent: 0,
        tokens: 0,
        day: budget.day,
      });
    return null;
  }
  const taken: LiveOrderContent = {
    ...content,
    state: "taken",
    takenAt: now.toISOString(),
    reserved: granted,
  };
  await intel.upsertArtifact({
    ...order,
    content: taken as unknown as Record<string, unknown>,
    evidence: { ...order.evidence, reservationDay: budget.day },
  });
  return taken;
}

const trialRow = z.object({
  taskId: z.string().max(120),
  partition: z.enum(["dev", "holdout", "adversarial"]),
  side: z.enum(["champion", "challenger"]),
  verified: z.boolean(),
  falseCompletion: z.boolean(),
  failureClass: z.string().max(120).nullable(),
  modelCalls: z.number().int().min(0).max(200),
  tokens: z.number().int().min(0).max(2_000_000),
  latencyMs: z
    .number()
    .int()
    .min(0)
    .max(24 * HOUR),
});

const side = z
  .object({
    verified: z.boolean(),
    modelCalls: z.number().int().min(0).max(200),
    tokens: z.number().int().min(0).max(2_000_000),
  })
  .nullable();

export const liveEvidenceSchema = z.object({
  orderId: z.string().uuid(),
  evidence: z.object({
    trials: z.array(trialRow).max(40),
    benchmark: z
      .array(
        z.object({
          taskId: z.string().max(120),
          family: z.string().max(80),
          raw: side,
          osirus: side,
          excluded: z.string().max(200).nullable().optional(),
        }),
      )
      .max(20),
    spent: z.object({
      modelCalls: z.number().int().min(0).max(500),
      tokens: z.number().int().min(0).max(10_000_000),
    }),
    runner: z.object({
      runId: z.string().max(40).nullable(),
      startedAt: z.string().max(40),
      finishedAt: z.string().max(40),
    }),
  }),
});

export async function reportLiveEvidence(
  intel: IntelStore,
  input: z.infer<typeof liveEvidenceSchema>,
) {
  const orders = await intel.listArtifacts({ kind: "live_order", limit: 50 });
  const order = orders.find(
    (artifact) =>
      (artifact.content as LiveOrderContent).orderId === input.orderId,
  );
  const content = order?.content as LiveOrderContent | undefined;
  if (!order || !content || content.state !== "taken")
    return { accepted: false as const, reason: "order_not_taken" };
  const known = new Set([
    ...content.tasks.map((task) => task.id),
    ...content.benchmark.map((task) => task.id),
  ]);
  // Rows about tasks the order never named are refused, not stored.
  if (
    input.evidence.trials.some((row) => !known.has(row.taskId)) ||
    input.evidence.benchmark.some((row) => !known.has(row.taskId))
  )
    return { accepted: false as const, reason: "unknown_task" };
  await settleCalls(intel, {
    reserved: content.reserved ?? 0,
    spent: input.evidence.spent.modelCalls,
    tokens: input.evidence.spent.tokens,
    day: String(
      order.evidence.reservationDay ?? new Date().toISOString().slice(0, 10),
    ),
  });
  const evidence: LiveEvidence = input.evidence;
  await intel.upsertArtifact({
    ...order,
    content: {
      ...content,
      state: "evidence",
      evidence,
    } as unknown as Record<string, unknown>,
  });
  for (const row of input.evidence.benchmark)
    await intel.upsertArtifact({
      cycleId: null,
      kind: "benchmark_result",
      capabilityId: null,
      taskPattern: `raw_vs_osirus:${row.family}`,
      content: {
        taskId: row.taskId,
        family: row.family,
        model: content.model,
        raw: row.raw,
        osirus: row.osirus,
        excluded: row.excluded ?? null,
        mode: "live",
        order: content.orderId,
      },
      evidence: { runner: input.evidence.runner },
      support: 1,
      status: "active",
      fingerprint: fingerprint("benchmark", content.orderId, row.taskId),
    });
  return { accepted: true as const };
}

export type CodeHypothesisContent = {
  statement: string;
  expected: string;
  file: string;
  symbol: string;
  arena: string;
  levels: number[];
  failing: string[];
  trustRoot: boolean;
  rsiCycle: string;
  attempts?: number;
  lastAttemptAt?: string | null;
  reservation?: { calls: number; day: string } | null;
  outcomes?: Array<Record<string, unknown>>;
};

/**
 * The next code hypothesis the pipeline may attempt: not in the trust root,
 * its file on the allowlist, not attempted in the last day, and model calls
 * reserved for it.
 */
export async function takeCodeHypothesis(intel: IntelStore, now = new Date()) {
  const candidates = (
    await intel.listArtifacts({ kind: "code_hypothesis", limit: 100 })
  )
    .filter((artifact) => artifact.status === "proposed")
    .filter((artifact) => {
      const content = artifact.content as CodeHypothesisContent;
      const last = content.lastAttemptAt
        ? Date.parse(content.lastAttemptAt)
        : 0;
      return (
        !content.trustRoot &&
        onAllowlist(content.file) &&
        now.getTime() - last >= CODE_ATTEMPT_INTERVAL_MS
      );
    })
    .sort((a, b) => b.support - a.support);
  const chosen = candidates[0];
  if (!chosen) return null;
  const { granted, budget } = await reserveCalls(intel, CODE_CALLS, now);
  if (granted < 1) return null;
  const content = chosen.content as CodeHypothesisContent;
  const next: CodeHypothesisContent = {
    ...content,
    attempts: (content.attempts ?? 0) + 1,
    lastAttemptAt: now.toISOString(),
    reservation: { calls: granted, day: budget.day },
  };
  await intel.upsertArtifact({
    ...chosen,
    content: next as unknown as Record<string, unknown>,
  });
  return { id: chosen.fingerprint, calls: granted, hypothesis: next };
}

export const codeReportSchema = z.object({
  id: z.string().min(8).max(80),
  // infrastructure_failure: the provider stopped the attempt. It is not a
  // result about the code, never "no improvement".
  outcome: z.enum([
    "pr_opened",
    "no_improvement",
    "refused",
    "failed",
    "infrastructure_failure",
  ]),
  prUrl: z
    .string()
    .regex(/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+$/)
    .nullable(),
  branch: z.string().max(80).nullable(),
  summary: z.string().max(2_000),
  measurements: z
    .object({
      baseline: z.object({ held: z.number(), instances: z.number() }),
      patched: z.object({ held: z.number(), instances: z.number() }),
      regressions: z.array(z.string().max(120)).max(40),
      testsPassed: z.boolean(),
    })
    .nullable(),
  spent: z.object({
    modelCalls: z.number().int().min(0).max(20),
    tokens: z.number().int().min(0).max(2_000_000),
  }),
});

export async function reportCodeAttempt(
  intel: IntelStore,
  input: z.infer<typeof codeReportSchema>,
) {
  const artifact = (
    await intel.listArtifacts({ kind: "code_hypothesis", limit: 100 })
  ).find((entry) => entry.fingerprint === input.id);
  if (!artifact)
    return { accepted: false as const, reason: "unknown_hypothesis" };
  const content = artifact.content as CodeHypothesisContent;
  if (!content.reservation)
    return { accepted: false as const, reason: "not_taken" };
  await settleCalls(intel, {
    reserved: content.reservation.calls,
    spent: input.spent.modelCalls,
    tokens: input.spent.tokens,
    day: content.reservation.day,
  });
  const outcome = {
    at: new Date().toISOString(),
    outcome: input.outcome,
    prUrl: input.prUrl,
    branch: input.branch,
    summary: input.summary,
    measurements: input.measurements,
  };
  // A pull request waits for the operator: the hypothesis is active, not
  // done. Anything else stays proposed and may be tried again tomorrow.
  const status: LearningArtifact["status"] =
    input.outcome === "pr_opened" ? "active" : "proposed";
  await intel.upsertArtifact({
    ...artifact,
    content: {
      ...content,
      reservation: null,
      outcomes: [...(content.outcomes ?? []), outcome].slice(-10),
    } as unknown as Record<string, unknown>,
    status,
  });
  return { accepted: true as const };
}
