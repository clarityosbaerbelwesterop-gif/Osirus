/**
 * GitOps control plane — reconciler.
 *
 * Desired state (manifests) is compared with actual state (measured run
 * records). Each job gets an input hash over its manifest and the exact
 * artifact revisions it consumes; a job is up to date only when a succeeded
 * run with that hash exists. Changing a hyperparameter, a parent adapter, or
 * a pinned revision therefore re-plans exactly the affected jobs downstream.
 *
 * The DAG: synth:<pipeline> -> train:<adapter> -> merge:<merge> -> eval:<merge>.
 * Adapter evaluation runs inside its train job (same ephemeral worker).
 */

import {
  estimateUsd,
  type GateContext,
  jobBlockers,
  type JobNode,
} from "./gate";
import { canonicalJson, sha256 } from "./load";
import type { Bundle, MergeManifest, RunRecord } from "./schema";

/** Resource requests do not change what a job produces, so they are not hashed. */
const UNHASHED_KEYS = new Set(["compute", "evalCompute", "concurrency"]);

export type JobStatus = "up-to-date" | "ready" | "waiting" | "blocked";

export interface PlannedJob extends JobNode {
  readonly status: JobStatus;
  /** null while an upstream output is missing. */
  readonly inputHash: string | null;
  readonly inputs: Readonly<Record<string, { uri: string; revision: string }>>;
  readonly estimateUsd: number | null;
  readonly blockers: readonly string[];
  readonly notes: readonly string[];
  readonly latestRun: RunRecord | null;
}

export interface Promotion {
  readonly model: string;
  readonly status: "promotable" | "not-met" | "unmeasured";
  readonly reasons: readonly string[];
}

export interface Plan {
  readonly jobs: readonly PlannedJob[];
  readonly promotions: readonly Promotion[];
}

export function jobGraph(bundle: Bundle): JobNode[] {
  const nodes: JobNode[] = [];
  for (const p of bundle.pipelines) {
    nodes.push({
      id: `synth:${p.id}`,
      stage: "synth",
      target: p.id,
      dependsOn: [],
      manifest: p,
      compute: null,
    });
  }
  for (const a of bundle.adapters) {
    const deps = a.datasets
      .filter((d) => d.uri.startsWith("pipeline:"))
      .map((d) => `synth:${d.uri.slice(9)}`);
    nodes.push({
      id: `train:${a.id}`,
      stage: "train",
      target: a.id,
      dependsOn: deps,
      manifest: a,
      compute: a.compute,
    });
  }
  for (const m of bundle.merges) {
    nodes.push({
      id: `merge:${m.id}`,
      stage: "merge",
      target: m.id,
      dependsOn: m.parents.map((p) => `train:${p}`),
      manifest: m,
      compute: m.compute,
    });
    nodes.push({
      id: `eval:${m.id}`,
      stage: "eval",
      target: m.id,
      dependsOn: [`merge:${m.id}`],
      manifest: m,
      compute: m.evalCompute,
    });
  }
  return nodes;
}

function hashedManifest(node: JobNode): unknown {
  const source = node.manifest as unknown as Record<string, unknown>;
  // eval:<merge> is defined by the merge's eval plan only; merge:<merge> by everything else.
  if (node.stage === "eval") return { evals: source.evals };
  const kept = Object.entries(source).filter(
    ([k]) =>
      !UNHASHED_KEYS.has(k) && !(node.stage === "merge" && k === "evals"),
  );
  return Object.fromEntries(kept);
}

export function jobInputHash(
  node: JobNode,
  inputs: PlannedJob["inputs"],
): string {
  return sha256(
    canonicalJson({ job: node.id, manifest: hashedManifest(node), inputs }),
  );
}

function latestRun(
  runs: readonly RunRecord[],
  jobId: string,
  inputHash: string | null,
): RunRecord | null {
  const matching = runs
    .filter(
      (r) =>
        r.jobId === jobId && (inputHash === null || r.inputHash === inputHash),
    )
    .sort((a, b) => Date.parse(b.finishedAt) - Date.parse(a.finishedAt));
  return matching[0] ?? null;
}

export function buildPlan(bundle: Bundle, ctx: GateContext): Plan {
  const planned = new Map<string, PlannedJob>();
  for (const node of jobGraph(bundle)) {
    const deps = node.dependsOn.map((id) => planned.get(id)!);
    const pending = deps.filter((d) => d.status !== "up-to-date");
    const notes: string[] = pending.map(
      (d) => `waiting for ${d.id} (${d.status})`,
    );
    const inputs: Record<string, { uri: string; revision: string }> = {};
    for (const d of deps) {
      if (d.status === "up-to-date" && d.latestRun?.outputs)
        inputs[d.id] = d.latestRun.outputs;
    }
    const inputHash = pending.length === 0 ? jobInputHash(node, inputs) : null;
    const run = inputHash ? latestRun(bundle.runs, node.id, inputHash) : null;
    const blockers = jobBlockers(bundle, node, ctx);
    let status: JobStatus;
    if (run?.status === "succeeded") status = "up-to-date";
    else if (pending.length > 0) status = "waiting";
    else status = blockers.length > 0 ? "blocked" : "ready";
    if (run?.status === "failed")
      notes.push(`last attempt ${run.runId} failed: ${run.error}`);
    const stale = latestRun(bundle.runs, node.id, null);
    if (status !== "up-to-date" && stale?.status === "succeeded") {
      notes.push(`drift: ${stale.runId} succeeded for a previous input hash`);
    }
    planned.set(node.id, {
      ...node,
      status,
      inputHash,
      inputs,
      estimateUsd: estimateUsd(node.compute),
      blockers: status === "up-to-date" ? [] : blockers,
      notes,
      latestRun: run,
    });
  }
  const jobs = [...planned.values()];
  return { jobs, promotions: promotions(bundle, planned) };
}

function metricOf(run: RunRecord | null, suite: string): number | undefined {
  return run?.metrics.find((m) => m.suite === suite)?.value;
}

function promotions(
  bundle: Bundle,
  planned: ReadonlyMap<string, PlannedJob>,
): Promotion[] {
  const out: Promotion[] = [];
  const measured = (jobId: string) => {
    const job = planned.get(jobId);
    return job?.status === "up-to-date" ? job.latestRun : null;
  };
  for (const a of bundle.adapters) {
    const run = measured(`train:${a.id}`);
    if (!run) {
      out.push({
        model: a.id,
        status: "unmeasured",
        reasons: [`train:${a.id} has no up-to-date measured run`],
      });
      continue;
    }
    const reasons = a.evals.gates.flatMap((g) => {
      const v = metricOf(run, g.suite);
      if (v === undefined) return [`${g.suite}: not measured`];
      return v >= g.min ? [] : [`${g.suite}: ${v} < gate ${g.min}`];
    });
    out.push({
      model: a.id,
      status: reasons.length ? "not-met" : "promotable",
      reasons,
    });
  }
  for (const m of bundle.merges) {
    const run = measured(`eval:${m.id}`);
    if (!run) {
      out.push({
        model: m.id,
        status: "unmeasured",
        reasons: [`eval:${m.id} has no up-to-date measured run`],
      });
      continue;
    }
    out.push(mergePromotion(m, run, (p) => measured(`train:${p}`)));
  }
  return out;
}

/** Gates plus the merge contract: no suite may fall below the best parent by more than the tolerance. */
export function mergePromotion(
  m: MergeManifest,
  run: RunRecord,
  parentRun: (parentId: string) => RunRecord | null,
): Promotion {
  const reasons: string[] = [];
  for (const g of m.evals.gates) {
    const v = metricOf(run, g.suite);
    if (v === undefined) reasons.push(`${g.suite}: not measured`);
    else if (v < g.min) reasons.push(`${g.suite}: ${v} < gate ${g.min}`);
  }
  for (const s of m.evals.suites) {
    const v = metricOf(run, s.id);
    const refs = m.parents
      .map((p) => ({ p, v: metricOf(parentRun(p), s.id) }))
      .filter((r): r is { p: string; v: number } => r.v !== undefined);
    if (v === undefined || refs.length === 0) {
      reasons.push(
        `${s.id}: regression check needs the merge and at least one parent measured`,
      );
      continue;
    }
    const best = refs.reduce((x, y) => (y.v > x.v ? y : x));
    if (v < best.v - m.evals.maxRegressionVsParents) {
      reasons.push(
        `${s.id}: ${v} regresses more than ${m.evals.maxRegressionVsParents} below parent ${best.p} (${best.v})`,
      );
    }
  }
  return {
    model: m.id,
    status: reasons.length ? "not-met" : "promotable",
    reasons,
  };
}

export function renderPlanMarkdown(plan: Plan): string {
  const lines = [
    "| Job | Status | Worst case | Blockers / notes |",
    "| --- | --- | --- | --- |",
    ...plan.jobs.map((j) => {
      const cost =
        j.estimateUsd === null ? "runner" : `$${j.estimateUsd.toFixed(2)}`;
      const why =
        [...j.blockers, ...j.notes]
          .map((r) => r.replace(/\|/g, "\\|"))
          .join("<br>") || "—";
      return `| \`${j.id}\` | ${j.status} | ${cost} | ${why} |`;
    }),
    "",
    "| Model | Promotion | Reasons |",
    "| --- | --- | --- |",
    ...plan.promotions.map(
      (p) => `| ${p.model} | ${p.status} | ${p.reasons.join("<br>") || "—"} |`,
    ),
  ];
  return lines.join("\n");
}
