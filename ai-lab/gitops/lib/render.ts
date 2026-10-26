/**
 * GitOps control plane — renders the worker payload for one planned job.
 *
 * The payload is the complete, secret-free instruction set for an ephemeral
 * worker: pinned base, pinned inputs, hyperparameters, eval suites, the
 * MergeKit config for merges, and the model card. Secrets (HF token, GitHub
 * callback token) live only in the worker's own environment.
 */

import { getGpuProfile } from "../../infra/runpod";
import type { PlannedJob } from "./plan";
import type {
  AdapterManifest,
  BaseModelRef,
  Bundle,
  EvalSuite,
  MergeManifest,
  QloraHyperparameters,
  SwarmPipeline,
} from "./schema";

export const PAYLOAD_SCHEMA = "osirus.gitops.job/v1";
export const CALLBACK_EVENT = "gitops-run-finished";

export interface ModelRef {
  readonly repo: string;
  readonly revision: string;
}

export interface JobPayload {
  readonly schema: typeof PAYLOAD_SCHEMA;
  readonly jobId: string;
  readonly stage: PlannedJob["stage"];
  readonly target: string;
  readonly runId: string;
  readonly inputHash: string;
  readonly commitSha: string;
  readonly repository: string;
  readonly provider: string;
  readonly timeoutMs: number;
  /** Catalog rate x devices; the worker reports elapsed hours x this as costUsd. */
  readonly costRateUsdPerHour: number;
  readonly callback: { readonly eventType: typeof CALLBACK_EVENT };
  readonly train?: {
    readonly base: ModelRef;
    readonly datasets: readonly ModelRef[];
    readonly hyperparameters: QloraHyperparameters;
    readonly suites: readonly EvalSuite[];
    readonly publish: string;
    readonly modelCard: string;
  };
  readonly merge?: {
    readonly mergekitYaml: string;
    readonly base: ModelRef;
    readonly publish: string;
    readonly modelCard: string;
  };
  readonly eval?: {
    readonly model: ModelRef;
    readonly suites: readonly EvalSuite[];
  };
}

const hubRepo = (uri: string) => uri.replace(/^hf:\/\/(datasets\/)?/, "");
const ref = (base: BaseModelRef): ModelRef => ({
  repo: base.upstreamId,
  revision: base.revision,
});

export function runIdFor(job: PlannedJob, now: Date): string {
  const stamp = now.toISOString().replace(/[-:T]/g, "").slice(0, 14);
  return `${job.target}-${job.stage}-${stamp}-${(job.inputHash ?? "nohash").slice(0, 8)}`;
}

function frontMatter(base: BaseModelRef, tags: readonly string[]): string {
  return [
    "---",
    `base_model: ${base.upstreamId}`,
    `license: other`,
    `license_name: ${base.license.license}`,
    "tags:",
    ...tags.map((t) => `  - ${t}`),
    "---",
  ].join("\n");
}

export function renderAdapterCard(
  a: AdapterManifest,
  job: PlannedJob,
  runId: string,
): string {
  return [
    frontMatter(a.base, ["osirus", "qlora", "peft", a.role]),
    `# ${a.displayName} (${a.id}) — QLoRA adapter`,
    "",
    `Fine-tuned adapter on **${a.base.upstreamId}@${a.base.revision}** (foreign base weights, not self-trained).`,
    `Run \`${runId}\`, input hash \`${job.inputHash}\`, seed ${a.hyperparameters.seed}.`,
    "",
    "Capabilities are only what the recorded metrics in the Osirus control plane state show;",
    "no number on this card is a projection.",
  ].join("\n");
}

export function renderMergeCard(
  m: MergeManifest,
  parents: readonly ModelRef[],
  job: PlannedJob,
  runId: string,
): string {
  return [
    frontMatter(m.base, ["osirus", "merge", "mergekit", m.method, m.role]),
    `# ${m.displayName} (${m.id}) — ${m.method} merge`,
    "",
    `Merged on **${m.base.upstreamId}@${m.base.revision}** (foreign base weights, not self-trained) from:`,
    ...parents.map((p) => `- \`${p.repo}@${p.revision}\``),
    "",
    `Run \`${runId}\`, input hash \`${job.inputHash}\`. Evaluated separately by \`eval:${m.id}\`;`,
    "promotion requires every eval gate and no regression beyond the configured tolerance vs. each parent.",
  ].join("\n");
}

/** MergeKit config. JSON-quoted scalars are valid YAML and immune to quoting edge cases. */
export function renderMergekitYaml(
  m: MergeManifest,
  parents: readonly (ModelRef & { id: string })[],
): string {
  const q = JSON.stringify;
  const base = `${m.base.upstreamId}@${m.base.revision}`;
  const sparse = m.method === "ties" || m.method === "dare_ties";
  const lines = [
    `# Generated from ai-lab/gitops/models/${m.id}.json. Edit the manifest, not this file.`,
    `merge_method: ${m.method}`,
    `base_model: ${q(base)}`,
    "models:",
  ];
  for (const p of parents) {
    lines.push(`  - model: ${q(`${base}+${p.repo}@${p.revision}`)}`);
    lines.push("    parameters:");
    lines.push(`      weight: ${m.weights[p.id]}`);
    if (sparse) lines.push(`      density: ${m.density}`);
  }
  lines.push("parameters:", `  normalize: ${m.normalize}`);
  if (sparse) lines.push("  int8_mask: true");
  lines.push(`dtype: ${m.dtype}`);
  return `${lines.join("\n")}\n`;
}

export function renderPayload(
  bundle: Bundle,
  job: PlannedJob,
  opts: { commitSha: string; now: Date; preview?: boolean },
): JobPayload {
  // A blocked job with all inputs resolved can be previewed (dry run), never dispatched.
  const renderable =
    job.status === "ready" ||
    (opts.preview === true && job.status === "blocked");
  if (!renderable || !job.inputHash) {
    throw new Error(
      `${job.id} is ${job.status}; only ready jobs are rendered for dispatch`,
    );
  }
  if (!job.compute)
    throw new Error(
      `${job.id} runs on the Actions runner, not on a remote worker`,
    );
  const runId = runIdFor(job, opts.now);
  const common = {
    schema: PAYLOAD_SCHEMA,
    jobId: job.id,
    stage: job.stage,
    target: job.target,
    runId,
    inputHash: job.inputHash,
    commitSha: opts.commitSha,
    repository: bundle.controlPlane.repository,
    provider: job.compute.provider,
    timeoutMs: Math.round(job.compute.maxRuntimeHours * 3_600_000),
    costRateUsdPerHour:
      (getGpuProfile(job.compute.profileId)?.approxUsdPerHour ?? 0) *
      job.compute.gpuCount,
    callback: { eventType: CALLBACK_EVENT },
  } as const;

  if (job.stage === "train") {
    const a = job.manifest as AdapterManifest;
    const datasets = a.datasets.map((d) => {
      if (!d.uri.startsWith("pipeline:"))
        return { repo: hubRepo(d.uri), revision: d.revision };
      const produced = job.inputs[`synth:${d.uri.slice(9)}`];
      return { repo: hubRepo(produced.uri), revision: produced.revision };
    });
    return {
      ...common,
      train: {
        base: ref(a.base),
        datasets,
        hyperparameters: a.hyperparameters,
        suites: a.evals.suites,
        publish: a.publish.hubRepo,
        modelCard: renderAdapterCard(a, job, runId),
      },
    };
  }
  if (job.stage === "merge") {
    const m = job.manifest as MergeManifest;
    const parents = m.parents.map((id) => {
      const out = job.inputs[`train:${id}`];
      return { id, repo: hubRepo(out.uri), revision: out.revision };
    });
    return {
      ...common,
      merge: {
        mergekitYaml: renderMergekitYaml(m, parents),
        base: ref(m.base),
        publish: m.publish.hubRepo,
        modelCard: renderMergeCard(m, parents, job, runId),
      },
    };
  }
  if (job.stage === "eval") {
    const m = job.manifest as MergeManifest;
    const merged = job.inputs[`merge:${m.id}`];
    return {
      ...common,
      eval: {
        model: { repo: hubRepo(merged.uri), revision: merged.revision },
        suites: m.evals.suites,
      },
    };
  }
  throw new Error(
    `stage ${job.stage} has no remote payload (pipeline ${(job.manifest as SwarmPipeline).id})`,
  );
}
