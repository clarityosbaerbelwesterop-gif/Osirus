/**
 * GitOps control plane — declarative manifest types and structural validators.
 *
 * The repository is the state manager: every hyperparameter, pipeline, compute
 * request, owner authorization, and measured run record is a JSON file under
 * `ai-lab/gitops/`. This module defines those shapes and validates them. It
 * follows the ai-lab contract convention: validators return `string[]`
 * (empty = valid) and nothing here performs I/O.
 *
 * Structural validity is not dispatch readiness: a manifest can be valid and
 * still blocked (unpinned revision, license under review, gate closed). Those
 * blockers are computed in `gate.ts`, so the plan can show both.
 */

import { GPU_PROFILES, type GpuProfileId } from "../../infra/runpod";

export const JOB_STAGES = ["synth", "train", "merge", "eval"] as const;
export type JobStage = (typeof JOB_STAGES)[number];

/** `<stage>:<target>`; the only job id shape the workflows accept. */
export const JOB_ID_PATTERN =
  /^(synth|train|merge|eval):[a-z0-9][a-z0-9-]{0,62}$/;
const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,62}$/;
const RUN_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,95}$/;
const ENV_REF_PATTERN = /^[A-Z][A-Z0-9_]{1,63}$/;
const HUB_REPO_PATTERN = /^[A-Za-z0-9][\w.-]{0,95}\/[A-Za-z0-9][\w.-]{0,95}$/;
/** A Hugging Face commit sha. Anything else is not a reproducible pin. */
export const PINNED_REVISION = /^[0-9a-f]{40}$/;

export type Review = "approved" | "pending" | "rejected";

/** License or terms-of-service review; `approved` requires evidence. */
export interface LicenseReview {
  readonly license: string;
  readonly review: Review;
  readonly evidence: string | null;
}

export interface BaseModelRef {
  /** Honest upstream identifier. Foreign weights are never relabeled. */
  readonly upstreamId: string;
  /** 40-hex commit sha, or "unpinned" (valid, but blocks dispatch). */
  readonly revision: string;
  readonly parametersB: number;
  readonly license: LicenseReview;
}

export interface DatasetRef {
  readonly id: string;
  /** `hf://datasets/<org>/<name>` or `pipeline:<pipeline-id>`. */
  readonly uri: string;
  /** Pinned sha for hf:// sources; ignored for pipeline sources (state wins). */
  readonly revision: string;
  readonly license: LicenseReview;
}

export interface QloraHyperparameters {
  readonly rank: number;
  readonly alpha: number;
  readonly dropout: number;
  /** Module-name list, or one regex string (PEFT full-match semantics). */
  readonly targetModules: string | readonly string[];
  readonly quantization: "nf4";
  readonly doubleQuant: boolean;
  readonly computeDtype: "bfloat16";
  readonly learningRate: number;
  readonly epochs: number;
  readonly maxSeqLength: number;
  readonly microBatchSize: number;
  readonly gradientAccumulation: number;
  readonly warmupRatio: number;
  readonly lrScheduler: "cosine" | "linear" | "constant";
  readonly gradientCheckpointing: boolean;
  readonly seed: number;
}

export interface ComputeRequest {
  readonly provider: string;
  readonly profileId: GpuProfileId;
  readonly gpuCount: number;
  /** Hard wall clock; becomes the provider execution timeout (kill switch). */
  readonly maxRuntimeHours: number;
  readonly minRamGb?: number;
  readonly minDiskGb?: number;
}

export interface EvalSuite {
  readonly id: string;
  readonly harness: "lm-eval";
  readonly task: string;
  /** lm-eval result key, e.g. "exact_match,strict-match". */
  readonly metric: string;
  readonly limit: number | null;
  /** Task executes model-written code (HumanEval/MBPP); runs in the worker. */
  readonly unsafeCode: boolean;
}

export interface EvalGate {
  readonly suite: string;
  readonly min: number;
}

export interface EvalPlan {
  readonly suites: readonly EvalSuite[];
  readonly gates: readonly EvalGate[];
}

export interface PublishTarget {
  readonly hubRepo: string;
  readonly private: true;
}

export interface AdapterManifest {
  readonly kind: "qlora-adapter";
  readonly id: string;
  readonly displayName: string;
  readonly role: string;
  readonly base: BaseModelRef;
  readonly datasets: readonly DatasetRef[];
  readonly hyperparameters: QloraHyperparameters;
  readonly compute: ComputeRequest;
  readonly evals: EvalPlan;
  readonly publish: PublishTarget;
}

export const MERGE_METHODS = [
  "ties",
  "dare_ties",
  "linear",
  "task_arithmetic",
] as const;
export type MergeMethod = (typeof MERGE_METHODS)[number];

export interface MergeManifest {
  readonly kind: "merge";
  readonly id: string;
  readonly displayName: string;
  readonly role: string;
  /** Must equal every parent's base (id and revision): task vectors only add up on one base. */
  readonly base: BaseModelRef;
  readonly parents: readonly string[];
  readonly method: MergeMethod;
  readonly weights: Readonly<Record<string, number>>;
  /** Fraction of task-vector entries kept (ties/dare only). */
  readonly density: number | null;
  readonly normalize: boolean;
  readonly dtype: "bfloat16";
  /** The merge itself is CPU-only; evolutionary search needs GPU fitness evals. */
  readonly evolution: {
    readonly enabled: boolean;
    readonly generations: number;
    readonly population: number;
  };
  readonly compute: ComputeRequest;
  readonly evalCompute: ComputeRequest;
  readonly evals: EvalPlan & { readonly maxRegressionVsParents: number };
  readonly publish: PublishTarget;
}

export interface Teacher {
  readonly id: string;
  readonly model: string;
  /** Env var holding the OpenAI-compatible base URL. */
  readonly endpointRef: string;
  readonly apiKeyRef: string;
  /** Do the provider's terms allow training models on these outputs? */
  readonly outputsMayTrainModels: LicenseReview;
}

export interface SandboxSpec {
  readonly image: string;
  readonly timeoutSeconds: number;
  readonly memoryMb: number;
  readonly cpus: number;
  readonly pidsLimit: number;
}

export interface SwarmAgent {
  readonly role: string;
  readonly count: number;
  readonly instructions: string;
}

export interface SwarmPipeline {
  readonly kind: "synthetic-data";
  readonly id: string;
  readonly teachers: readonly Teacher[];
  readonly agents: readonly SwarmAgent[];
  readonly topics: readonly string[];
  readonly tasksPerAgent: number;
  readonly concurrency: number;
  readonly maxTeacherRequests: number;
  readonly verification: {
    readonly sandbox: SandboxSpec;
    readonly prm: {
      readonly required: boolean;
      readonly endpointRef: string;
      readonly apiKeyRef: string;
      readonly threshold: number;
      readonly aggregation: "min" | "mean" | "last";
    };
  };
  readonly dedup: { readonly jaccardThreshold: number };
  readonly decontamination: {
    readonly ngramSize: number;
    readonly evalSources: readonly string[];
  };
  readonly publish: PublishTarget;
}

export const PROVIDER_KINDS = ["runpod-serverless", "modal-webhook"] as const;

export interface ProviderSpec {
  readonly id: string;
  readonly kind: (typeof PROVIDER_KINDS)[number];
  /** Env var holding the RunPod endpoint id or the Modal web endpoint URL. */
  readonly endpointRef: string;
  readonly apiKeyRef: string;
}

export interface ComputeCatalog {
  readonly providers: readonly ProviderSpec[];
  readonly budget: {
    readonly maxUsdPerRun: number;
    readonly maxUsdTotal: number;
  };
}

/** Written owner authorization, merged by pull request. */
export interface Authorization {
  readonly id: string;
  /** Job ids this authorization releases, e.g. "train:rouge-1". */
  readonly scope: readonly string[];
  readonly maxUsd: number;
  readonly approvedBy: string;
  readonly approvedAt: string;
  readonly expiresAt: string;
  readonly evidence: string;
}

export interface ControlPlane {
  readonly version: 1;
  readonly repository: string;
  /** Owner-flipped by pull request; the runtime env must agree. */
  readonly trainingReady: boolean;
  readonly authorizations: readonly Authorization[];
}

export interface TestTimeCompute {
  readonly strategy: "mcts";
  readonly maxRollouts: number;
  readonly maxDepth: number;
  readonly branching: number;
  readonly exploration: number;
  readonly prmAggregation: "min" | "mean" | "last";
}

export interface RunMetric {
  readonly suite: string;
  readonly metric: string;
  readonly value: number;
}

/** A measured outcome reported by a worker. Failures are recorded too. */
export interface RunRecord {
  readonly runId: string;
  readonly jobId: string;
  readonly inputHash: string;
  readonly status: "succeeded" | "failed";
  readonly provider: string;
  readonly providerJobId: string;
  readonly commitSha: string;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly outputs: { readonly uri: string; readonly revision: string } | null;
  readonly metrics: readonly RunMetric[];
  readonly costUsd: number | null;
  readonly error: string | null;
}

export interface Bundle {
  readonly controlPlane: ControlPlane;
  readonly compute: ComputeCatalog;
  readonly adapters: readonly AdapterManifest[];
  readonly merges: readonly MergeManifest[];
  readonly pipelines: readonly SwarmPipeline[];
  readonly inference: TestTimeCompute;
  readonly runs: readonly RunRecord[];
}

/* ---------------------------------------------------------------------------
 * Compact structural checker
 * ------------------------------------------------------------------------ */

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj =>
  typeof v === "object" && v !== null && !Array.isArray(v);

class Check {
  readonly errors: string[] = [];
  constructor(private readonly where: string) {}

  fail(path: string, message: string): void {
    this.errors.push(`${this.where}: ${path} ${message}`);
  }

  obj(v: unknown, path: string): Obj {
    if (isObj(v)) return v;
    this.fail(path, "must be an object");
    return {};
  }

  str(v: unknown, path: string, pattern?: RegExp): v is string {
    if (typeof v !== "string" || v.trim() === "") {
      this.fail(path, "must be a non-empty string");
      return false;
    }
    if (pattern && !pattern.test(v)) {
      this.fail(path, `must match ${pattern}`);
      return false;
    }
    return true;
  }

  num(
    v: unknown,
    path: string,
    opts: { min?: number; max?: number; int?: boolean; gt?: number } = {},
  ): v is number {
    const ok =
      typeof v === "number" &&
      Number.isFinite(v) &&
      (!opts.int || Number.isInteger(v)) &&
      (opts.min === undefined || v >= opts.min) &&
      (opts.max === undefined || v <= opts.max) &&
      (opts.gt === undefined || v > opts.gt);
    if (!ok) {
      const range = [
        opts.int ? "integer" : "number",
        opts.min !== undefined ? `>= ${opts.min}` : "",
        opts.gt !== undefined ? `> ${opts.gt}` : "",
        opts.max !== undefined ? `<= ${opts.max}` : "",
      ]
        .filter(Boolean)
        .join(" ");
      this.fail(path, `must be a finite ${range}`);
    }
    return ok;
  }

  bool(v: unknown, path: string): void {
    if (typeof v !== "boolean") this.fail(path, "must be a boolean");
  }

  oneOf(v: unknown, path: string, allowed: readonly unknown[]): void {
    if (!allowed.includes(v)) {
      this.fail(path, `must be one of ${allowed.join(", ")}`);
    }
  }

  literal(v: unknown, path: string, expected: unknown): void {
    if (v !== expected) this.fail(path, `must be ${JSON.stringify(expected)}`);
  }

  arr(v: unknown, path: string, opts: { min?: number } = {}): unknown[] {
    if (!Array.isArray(v)) {
      this.fail(path, "must be an array");
      return [];
    }
    if (opts.min !== undefined && v.length < opts.min) {
      this.fail(
        path,
        `must have at least ${opts.min} entr${opts.min === 1 ? "y" : "ies"}`,
      );
    }
    return v;
  }

  date(v: unknown, path: string): void {
    if (typeof v !== "string" || Number.isNaN(Date.parse(v))) {
      this.fail(path, "must be an ISO 8601 date string");
    }
  }

  license(v: unknown, path: string): void {
    const o = this.obj(v, path);
    this.str(o.license, `${path}.license`);
    this.oneOf(o.review, `${path}.review`, ["approved", "pending", "rejected"]);
    if (o.evidence !== null) this.str(o.evidence, `${path}.evidence`);
    if (o.review === "approved" && o.evidence === null) {
      this.fail(path, "is approved without evidence (link the review)");
    }
  }

  base(v: unknown, path: string): void {
    const o = this.obj(v, path);
    this.str(o.upstreamId, `${path}.upstreamId`, HUB_REPO_PATTERN);
    if (this.str(o.revision, `${path}.revision`) && o.revision !== "unpinned") {
      this.str(o.revision, `${path}.revision`, PINNED_REVISION);
    }
    this.num(o.parametersB, `${path}.parametersB`, { gt: 0, max: 2000 });
    this.license(o.license, `${path}.license`);
  }

  compute(v: unknown, path: string, providers: readonly string[]): void {
    const o = this.obj(v, path);
    this.oneOf(o.provider, `${path}.provider`, providers);
    this.oneOf(
      o.profileId,
      `${path}.profileId`,
      GPU_PROFILES.map((p) => p.id),
    );
    this.num(o.gpuCount, `${path}.gpuCount`, { int: true, min: 1, max: 8 });
    this.num(o.maxRuntimeHours, `${path}.maxRuntimeHours`, { gt: 0, max: 24 });
    if (o.minRamGb !== undefined) {
      this.num(o.minRamGb, `${path}.minRamGb`, { int: true, min: 1 });
    }
    if (o.minDiskGb !== undefined) {
      this.num(o.minDiskGb, `${path}.minDiskGb`, { int: true, min: 1 });
    }
  }

  evals(v: unknown, path: string): Obj {
    const o = this.obj(v, path);
    const ids = new Set<string>();
    this.arr(o.suites, `${path}.suites`, { min: 1 }).forEach((s, i) => {
      const p = `${path}.suites[${i}]`;
      const so = this.obj(s, p);
      if (this.str(so.id, `${p}.id`, ID_PATTERN)) {
        if (ids.has(so.id)) this.fail(`${p}.id`, "is duplicated");
        ids.add(so.id);
      }
      this.literal(so.harness, `${p}.harness`, "lm-eval");
      this.str(so.task, `${p}.task`, /^[\w.,-]+$/);
      this.str(so.metric, `${p}.metric`, /^[\w.,-]+$/);
      if (so.limit !== null)
        this.num(so.limit, `${p}.limit`, { int: true, min: 1 });
      this.bool(so.unsafeCode, `${p}.unsafeCode`);
    });
    this.arr(o.gates, `${path}.gates`).forEach((g, i) => {
      const go = this.obj(g, `${path}.gates[${i}]`);
      if (typeof go.suite !== "string" || !ids.has(go.suite)) {
        this.fail(`${path}.gates[${i}].suite`, "must name a declared suite");
      }
      this.num(go.min, `${path}.gates[${i}].min`, { min: 0, max: 1 });
    });
    return o;
  }

  publish(v: unknown, path: string): void {
    const o = this.obj(v, path);
    this.str(o.hubRepo, `${path}.hubRepo`, HUB_REPO_PATTERN);
    this.literal(o.private, `${path}.private`, true);
  }

  envRef(v: unknown, path: string): void {
    this.str(v, path, ENV_REF_PATTERN);
  }
}

/* ---------------------------------------------------------------------------
 * Per-file validators
 * ------------------------------------------------------------------------ */

export function validateControlPlane(
  v: unknown,
  where = "control-plane.json",
): string[] {
  const c = new Check(where);
  const o = c.obj(v, "$");
  c.literal(o.version, "version", 1);
  c.str(o.repository, "repository", HUB_REPO_PATTERN);
  c.bool(o.trainingReady, "trainingReady");
  const ids = new Set<string>();
  c.arr(o.authorizations, "authorizations").forEach((a, i) => {
    const p = `authorizations[${i}]`;
    const ao = c.obj(a, p);
    if (c.str(ao.id, `${p}.id`, ID_PATTERN)) {
      if (ids.has(ao.id)) c.fail(`${p}.id`, "is duplicated");
      ids.add(ao.id);
    }
    c.arr(ao.scope, `${p}.scope`, { min: 1 }).forEach((s, j) =>
      c.str(s, `${p}.scope[${j}]`, JOB_ID_PATTERN),
    );
    c.num(ao.maxUsd, `${p}.maxUsd`, { gt: 0 });
    c.str(ao.approvedBy, `${p}.approvedBy`);
    c.date(ao.approvedAt, `${p}.approvedAt`);
    c.date(ao.expiresAt, `${p}.expiresAt`);
    c.str(ao.evidence, `${p}.evidence`, /^https:\/\//);
  });
  return c.errors;
}

export function validateComputeCatalog(
  v: unknown,
  where = "compute/providers.json",
): string[] {
  const c = new Check(where);
  const o = c.obj(v, "$");
  const ids = new Set<string>();
  c.arr(o.providers, "providers", { min: 1 }).forEach((p, i) => {
    const po = c.obj(p, `providers[${i}]`);
    if (c.str(po.id, `providers[${i}].id`, ID_PATTERN)) {
      if (ids.has(po.id)) c.fail(`providers[${i}].id`, "is duplicated");
      ids.add(po.id);
    }
    c.oneOf(po.kind, `providers[${i}].kind`, PROVIDER_KINDS);
    c.envRef(po.endpointRef, `providers[${i}].endpointRef`);
    c.envRef(po.apiKeyRef, `providers[${i}].apiKeyRef`);
  });
  const b = c.obj(o.budget, "budget");
  if (
    c.num(b.maxUsdPerRun, "budget.maxUsdPerRun", { gt: 0 }) &&
    c.num(b.maxUsdTotal, "budget.maxUsdTotal", { gt: 0 }) &&
    b.maxUsdPerRun > b.maxUsdTotal
  ) {
    c.fail("budget.maxUsdPerRun", "must not exceed budget.maxUsdTotal");
  }
  return c.errors;
}

export function validateAdapter(
  v: unknown,
  providers: readonly string[],
  where = "models/<adapter>.json",
): string[] {
  const c = new Check(where);
  const o = c.obj(v, "$");
  c.literal(o.kind, "kind", "qlora-adapter");
  c.str(o.id, "id", ID_PATTERN);
  c.str(o.displayName, "displayName");
  c.str(o.role, "role");
  c.base(o.base, "base");
  c.arr(o.datasets, "datasets", { min: 1 }).forEach((d, i) => {
    const p = `datasets[${i}]`;
    const dobj = c.obj(d, p);
    c.str(dobj.id, `${p}.id`, ID_PATTERN);
    c.str(
      dobj.uri,
      `${p}.uri`,
      /^(hf:\/\/datasets\/[\w.-]+\/[\w.-]+|pipeline:[a-z0-9-]+)$/,
    );
    c.str(dobj.revision, `${p}.revision`);
    c.license(dobj.license, `${p}.license`);
  });
  const h = c.obj(o.hyperparameters, "hyperparameters");
  c.num(h.rank, "hyperparameters.rank", { int: true, min: 1, max: 1024 });
  c.num(h.alpha, "hyperparameters.alpha", { gt: 0 });
  c.num(h.dropout, "hyperparameters.dropout", { min: 0, max: 0.5 });
  if (typeof h.targetModules === "string") {
    try {
      new RegExp(h.targetModules);
    } catch {
      c.fail("hyperparameters.targetModules", "is not a valid regex");
    }
  } else {
    c.arr(h.targetModules, "hyperparameters.targetModules", { min: 1 }).forEach(
      (m, i) => c.str(m, `hyperparameters.targetModules[${i}]`, /^[\w.]+$/),
    );
  }
  c.literal(h.quantization, "hyperparameters.quantization", "nf4");
  c.bool(h.doubleQuant, "hyperparameters.doubleQuant");
  c.literal(h.computeDtype, "hyperparameters.computeDtype", "bfloat16");
  c.num(h.learningRate, "hyperparameters.learningRate", { gt: 0, max: 0.01 });
  c.num(h.epochs, "hyperparameters.epochs", { gt: 0, max: 20 });
  c.num(h.maxSeqLength, "hyperparameters.maxSeqLength", {
    int: true,
    min: 128,
    max: 131072,
  });
  c.num(h.microBatchSize, "hyperparameters.microBatchSize", {
    int: true,
    min: 1,
    max: 256,
  });
  c.num(h.gradientAccumulation, "hyperparameters.gradientAccumulation", {
    int: true,
    min: 1,
    max: 1024,
  });
  c.num(h.warmupRatio, "hyperparameters.warmupRatio", { min: 0, max: 0.5 });
  c.oneOf(h.lrScheduler, "hyperparameters.lrScheduler", [
    "cosine",
    "linear",
    "constant",
  ]);
  c.bool(h.gradientCheckpointing, "hyperparameters.gradientCheckpointing");
  c.num(h.seed, "hyperparameters.seed", { int: true, min: 0 });
  c.compute(o.compute, "compute", providers);
  c.evals(o.evals, "evals");
  c.publish(o.publish, "publish");
  return c.errors;
}

export function validateMerge(
  v: unknown,
  providers: readonly string[],
  where = "models/<merge>.json",
): string[] {
  const c = new Check(where);
  const o = c.obj(v, "$");
  c.literal(o.kind, "kind", "merge");
  c.str(o.id, "id", ID_PATTERN);
  c.str(o.displayName, "displayName");
  c.str(o.role, "role");
  c.base(o.base, "base");
  const parents = c.arr(o.parents, "parents", { min: 2 });
  parents.forEach((p, i) => c.str(p, `parents[${i}]`, ID_PATTERN));
  if (new Set(parents).size !== parents.length)
    c.fail("parents", "must be distinct");
  c.oneOf(o.method, "method", MERGE_METHODS);
  const w = c.obj(o.weights, "weights");
  const wKeys = Object.keys(w).sort();
  if (
    JSON.stringify(wKeys) !== JSON.stringify([...parents].map(String).sort())
  ) {
    c.fail("weights", "must have exactly one entry per parent");
  }
  for (const k of wKeys) c.num(w[k], `weights.${k}`, { gt: 0, max: 2 });
  const sparse = o.method === "ties" || o.method === "dare_ties";
  if (sparse) c.num(o.density, "density", { gt: 0, max: 1 });
  else if (o.density !== null)
    c.fail("density", `must be null for method ${String(o.method)}`);
  c.bool(o.normalize, "normalize");
  c.literal(o.dtype, "dtype", "bfloat16");
  const e = c.obj(o.evolution, "evolution");
  c.bool(e.enabled, "evolution.enabled");
  c.num(e.generations, "evolution.generations", {
    int: true,
    min: 1,
    max: 200,
  });
  c.num(e.population, "evolution.population", { int: true, min: 2, max: 64 });
  c.compute(o.compute, "compute", providers);
  c.compute(o.evalCompute, "evalCompute", providers);
  const ev = c.evals(o.evals, "evals");
  c.num(ev.maxRegressionVsParents, "evals.maxRegressionVsParents", {
    min: 0,
    max: 0.5,
  });
  c.publish(o.publish, "publish");
  return c.errors;
}

export function validatePipeline(
  v: unknown,
  where = "pipelines/<pipeline>.json",
): string[] {
  const c = new Check(where);
  const o = c.obj(v, "$");
  c.literal(o.kind, "kind", "synthetic-data");
  c.str(o.id, "id", ID_PATTERN);
  c.arr(o.teachers, "teachers", { min: 1 }).forEach((t, i) => {
    const p = `teachers[${i}]`;
    const to = c.obj(t, p);
    c.str(to.id, `${p}.id`, ID_PATTERN);
    c.str(to.model, `${p}.model`);
    c.envRef(to.endpointRef, `${p}.endpointRef`);
    c.envRef(to.apiKeyRef, `${p}.apiKeyRef`);
    c.license(to.outputsMayTrainModels, `${p}.outputsMayTrainModels`);
  });
  c.arr(o.agents, "agents", { min: 1 }).forEach((a, i) => {
    const ao = c.obj(a, `agents[${i}]`);
    c.str(ao.role, `agents[${i}].role`, ID_PATTERN);
    c.num(ao.count, `agents[${i}].count`, { int: true, min: 1, max: 64 });
    c.str(ao.instructions, `agents[${i}].instructions`);
  });
  c.arr(o.topics, "topics", { min: 1 }).forEach((t, i) =>
    c.str(t, `topics[${i}]`),
  );
  c.num(o.tasksPerAgent, "tasksPerAgent", { int: true, min: 1, max: 10000 });
  c.num(o.concurrency, "concurrency", { int: true, min: 1, max: 64 });
  c.num(o.maxTeacherRequests, "maxTeacherRequests", {
    int: true,
    min: 1,
    max: 100000,
  });
  const ver = c.obj(o.verification, "verification");
  const sb = c.obj(ver.sandbox, "verification.sandbox");
  c.str(sb.image, "verification.sandbox.image", /^[\w./:@-]+$/);
  c.num(sb.timeoutSeconds, "verification.sandbox.timeoutSeconds", {
    int: true,
    min: 1,
    max: 600,
  });
  c.num(sb.memoryMb, "verification.sandbox.memoryMb", {
    int: true,
    min: 64,
    max: 8192,
  });
  c.num(sb.cpus, "verification.sandbox.cpus", { gt: 0, max: 4 });
  c.num(sb.pidsLimit, "verification.sandbox.pidsLimit", {
    int: true,
    min: 8,
    max: 1024,
  });
  const prm = c.obj(ver.prm, "verification.prm");
  c.bool(prm.required, "verification.prm.required");
  c.envRef(prm.endpointRef, "verification.prm.endpointRef");
  c.envRef(prm.apiKeyRef, "verification.prm.apiKeyRef");
  c.num(prm.threshold, "verification.prm.threshold", { min: 0, max: 1 });
  c.oneOf(prm.aggregation, "verification.prm.aggregation", [
    "min",
    "mean",
    "last",
  ]);
  const dd = c.obj(o.dedup, "dedup");
  c.num(dd.jaccardThreshold, "dedup.jaccardThreshold", { gt: 0, max: 1 });
  const dc = c.obj(o.decontamination, "decontamination");
  c.num(dc.ngramSize, "decontamination.ngramSize", {
    int: true,
    min: 5,
    max: 50,
  });
  c.arr(dc.evalSources, "decontamination.evalSources", { min: 1 }).forEach(
    (s, i) => c.str(s, `decontamination.evalSources[${i}]`),
  );
  c.publish(o.publish, "publish");
  return c.errors;
}

export function validateTestTimeCompute(
  v: unknown,
  where = "inference/test-time-compute.json",
): string[] {
  const c = new Check(where);
  const o = c.obj(v, "$");
  c.literal(o.strategy, "strategy", "mcts");
  c.num(o.maxRollouts, "maxRollouts", { int: true, min: 1, max: 10000 });
  c.num(o.maxDepth, "maxDepth", { int: true, min: 1, max: 64 });
  c.num(o.branching, "branching", { int: true, min: 1, max: 32 });
  c.num(o.exploration, "exploration", { min: 0, max: 10 });
  c.oneOf(o.prmAggregation, "prmAggregation", ["min", "mean", "last"]);
  return c.errors;
}

export function validateRunRecord(
  v: unknown,
  where = "state/runs/<run>.json",
): string[] {
  const c = new Check(where);
  const o = c.obj(v, "$");
  c.str(o.runId, "runId", RUN_ID_PATTERN);
  c.str(o.jobId, "jobId", JOB_ID_PATTERN);
  c.str(o.inputHash, "inputHash", /^[0-9a-f]{64}$/);
  c.oneOf(o.status, "status", ["succeeded", "failed"]);
  c.str(o.provider, "provider", ID_PATTERN);
  c.str(o.providerJobId, "providerJobId", /^[\w.:-]{1,128}$/);
  c.str(o.commitSha, "commitSha", /^[0-9a-f]{40}$/);
  c.date(o.startedAt, "startedAt");
  c.date(o.finishedAt, "finishedAt");
  if (o.outputs !== null) {
    const out = c.obj(o.outputs, "outputs");
    c.str(out.uri, "outputs.uri", /^hf:\/\/(datasets\/)?[\w.-]+\/[\w.-]+$/);
    c.str(out.revision, "outputs.revision", PINNED_REVISION);
  }
  c.arr(o.metrics, "metrics").forEach((m, i) => {
    const mo = c.obj(m, `metrics[${i}]`);
    c.str(mo.suite, `metrics[${i}].suite`, ID_PATTERN);
    c.str(mo.metric, `metrics[${i}].metric`);
    c.num(mo.value, `metrics[${i}].value`);
  });
  if (o.costUsd !== null) c.num(o.costUsd, "costUsd", { min: 0 });
  if (o.error !== null) c.str(o.error, "error");
  if (o.status === "succeeded" && o.outputs === null) {
    c.fail("outputs", "must be set for a succeeded run");
  }
  if (o.status === "failed" && o.error === null) {
    c.fail("error", "must explain a failed run");
  }
  return c.errors;
}

/* ---------------------------------------------------------------------------
 * Cross-file invariants
 * ------------------------------------------------------------------------ */

export function sameBase(a: BaseModelRef, b: BaseModelRef): boolean {
  return a.upstreamId === b.upstreamId && a.revision === b.revision;
}

/** Ids of every job the manifests define, in dependency order. */
export function definedJobIds(bundle: Bundle): string[] {
  return [
    ...bundle.pipelines.map((p) => `synth:${p.id}`),
    ...bundle.adapters.map((a) => `train:${a.id}`),
    ...bundle.merges.flatMap((m) => [`merge:${m.id}`, `eval:${m.id}`]),
  ];
}

/** References between files. Assumes each file passed its own validator. */
export function validateBundleReferences(bundle: Bundle): string[] {
  const errors: string[] = [];
  const modelIds = [...bundle.adapters, ...bundle.merges].map((m) => m.id);
  for (const id of new Set(modelIds)) {
    if (modelIds.filter((x) => x === id).length > 1) {
      errors.push(`models: id "${id}" is defined twice`);
    }
  }
  const adapters = new Map(bundle.adapters.map((a) => [a.id, a]));
  const pipelines = new Set(bundle.pipelines.map((p) => p.id));
  for (const a of bundle.adapters) {
    for (const d of a.datasets) {
      if (d.uri.startsWith("pipeline:") && !pipelines.has(d.uri.slice(9))) {
        errors.push(
          `models/${a.id}.json: dataset ${d.id} references unknown ${d.uri}`,
        );
      }
    }
  }
  for (const m of bundle.merges) {
    for (const parentId of m.parents) {
      const parent = adapters.get(parentId);
      if (!parent) {
        errors.push(
          `models/${m.id}.json: parent "${parentId}" is not a qlora-adapter manifest`,
        );
      } else if (!sameBase(parent.base, m.base)) {
        errors.push(
          `models/${m.id}.json: parent "${parentId}" is trained on ${parent.base.upstreamId}@${parent.base.revision}, ` +
            `the merge base is ${m.base.upstreamId}@${m.base.revision}; task vectors only merge on one shared base`,
        );
      }
    }
    const parentSuites = new Set(
      m.parents.flatMap(
        (p) => adapters.get(p)?.evals.suites.map((s) => s.id) ?? [],
      ),
    );
    for (const s of m.evals.suites) {
      if (!parentSuites.has(s.id)) {
        errors.push(
          `models/${m.id}.json: eval suite "${s.id}" is measured by no parent, so regression vs parents is undefined`,
        );
      }
    }
  }
  const known = new Set(definedJobIds(bundle));
  for (const a of bundle.controlPlane.authorizations) {
    for (const s of a.scope) {
      if (!known.has(s))
        errors.push(
          `control-plane.json: authorization ${a.id} scopes unknown job ${s}`,
        );
    }
  }
  for (const r of bundle.runs) {
    if (!known.has(r.jobId))
      errors.push(`state/runs/${r.runId}.json: unknown job ${r.jobId}`);
  }
  const runIds = bundle.runs.map((r) => r.runId);
  if (new Set(runIds).size !== runIds.length)
    errors.push("state/runs: duplicate runId");
  return errors;
}
