import "server-only";
import type { RuntimeIdentity } from "../../arms/types";
import { queryAs } from "../../db/client";
import { fingerprint } from "../evals/random";
import type { VerdictStatus } from "../../verification/engine";
import {
  deriveOutcome,
  excludedFailureClass,
  toExperienceOutcome,
} from "../../verification/outcome";
import { PgIntelStore } from "../store/pg-store";

// What a customer run teaches the Intelligence Plane: operational metrics
// only. Which arm ran, under which strategy version and model, how it was
// verified, what it cost, which tools it touched -- never the objective, the
// answer, a file, a message or anything that identifies the tenant. These
// rows feed canary evidence and router statistics; they never become
// training data, and the capability registry ignores them when measuring.

type StageRow = {
  name: string;
  verifier_status: string | null;
  arm_id: string | null;
  strategy_version_id: string | null;
  model: string | null;
};

export async function captureProductExperience(input: {
  identity: RuntimeIdentity;
  runId: string;
}) {
  const store = new PgIntelStore();
  const settings = await store.settings();
  if (!settings.flags.intelligencePlane) return;
  const as = <T>(text: string, params: unknown[]) =>
    queryAs<T>(input.identity.userId, text, params);
  const [run] = await as<{
    status: string;
    priority: number;
    error_code: string | null;
    created_at: string;
    completed_at: string | null;
  }>(
    `select status, priority, error_code, created_at, completed_at
       from osirus.runs where id = $1::uuid`,
    [input.runId],
  );
  // Foundry trials are recorded by the research loop, with their label.
  if (!run || Number(run.priority) < 0) return;
  if (run.status !== "completed" && run.status !== "failed") return;
  const [stages, calls, tools] = await Promise.all([
    as<StageRow>(
      `select name, verifier_status, input ->> 'armId' as arm_id,
              input -> 'policy' ->> 'strategyVersionId' as strategy_version_id,
              input -> 'policy' ->> 'model' as model
         from osirus.run_stages where run_id = $1::uuid order by ordinal`,
      [input.runId],
    ),
    as<{
      tokens: string | null;
      cost: string | null;
      model: string | null;
      errors: string[] | null;
    }>(
      `select sum(coalesce(input_tokens, 0) + coalesce(output_tokens, 0)) as tokens,
              sum(coalesce(estimated_cost_usd, 0)) as cost,
              max(model) as model,
              array_agg(distinct error_code)
                filter (where error_code is not null) as errors
         from osirus.model_calls where run_id = $1::uuid`,
      [input.runId],
    ),
    as<{ tool_name: string }>(
      `select distinct tool_name from osirus.tool_calls
        where run_id = $1::uuid limit 40`,
      [input.runId],
    ),
  ]);
  const verdicts = stages
    .map((stage) => stage.verifier_status)
    .filter((status): status is string => Boolean(status));
  const arms = [
    ...new Set(stages.map((stage) => stage.arm_id).filter(Boolean)),
  ] as string[];
  const providerFailure = (calls[0]?.errors ?? []).some((code) =>
    /rate_limited|insufficient_credit|provider_|credential/.test(code),
  );
  // The canonical outcome: a completed run whose verification rejected it
  // told the customer "done" against the evidence.
  const derived = deriveOutcome({
    infrastructureError: providerFailure
      ? `provider refusal: ${(calls[0]?.errors ?? []).join(",")}`
      : null,
    finished: run.status === "completed",
    claimedSuccess: run.status === "completed",
    verdicts: verdicts as VerdictStatus[],
  });
  const outcome = toExperienceOutcome(derived.outcome);
  const ended = run.completed_at ? Date.parse(run.completed_at) : Date.now();
  await store.insertExperience({
    source: "product",
    taskRef: null,
    taskType: arms[0] ?? "general",
    capabilityIds: arms.map((arm) => `arm.${arm}`),
    difficulty: null,
    strategyVersionId:
      stages.find((stage) => stage.strategy_version_id)?.strategy_version_id ??
      null,
    model:
      stages.find((stage) => stage.model)?.model ?? calls[0]?.model ?? null,
    skills: [],
    tools: tools.map((tool) => tool.tool_name),
    trajectory: { arm: arms.join("+"), stages: stages.map((s) => s.name) },
    verification: {
      verdicts,
      capabilityOutcome: derived.outcome,
      reason: derived.reason,
    },
    outcome,
    failureClass:
      excludedFailureClass(derived.outcome, derived.reason) ??
      (run.status === "failed" ? (run.error_code ?? "failed") : null),
    repairs: 0,
    costUsd: Number(calls[0]?.cost ?? 0),
    tokens: Number(calls[0]?.tokens ?? 0),
    latencyMs: Math.max(0, ended - Date.parse(run.created_at)),
    confidence: null,
    qualityScore: 0,
    // Pseudonymous: one row per run, without the run's id.
    fingerprint: fingerprint("product", input.runId),
    partition: null,
    provenance: { kind: "product_run_metrics" },
  });
}
