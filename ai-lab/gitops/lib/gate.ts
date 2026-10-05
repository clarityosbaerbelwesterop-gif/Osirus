/**
 * GitOps control plane — dispatch gate.
 *
 * A job leaves the repository only when every blocker below is cleared. The
 * gate composes the Phase K invariants from `ai-lab/infra/runpod.ts` (budget
 * ceilings, mandatory kill switch, TRAINING_READY env) with the GitOps ones:
 * an owner authorization merged by pull request, pinned revisions, approved
 * licenses and teacher terms, and a hardware fit check.
 *
 * Policy blockers come from the manifests and state alone, so a pull request
 * plan shows them without any secret. Runtime blockers (env flag, provider
 * secrets) are added only when the caller evaluates for an actual dispatch.
 */

import {
  BudgetGuard,
  getGpuProfile,
  TRAINING_READY_ENV,
  validateProvisionRequest,
} from "../../infra/runpod";
import {
  type AdapterManifest,
  type BaseModelRef,
  type Bundle,
  type ComputeRequest,
  type MergeManifest,
  PINNED_REVISION,
  type SwarmPipeline,
} from "./schema";

export interface GateContext {
  readonly now: Date;
  /** When set, runtime blockers (env flag, secrets) are evaluated too. */
  readonly env?: Readonly<Record<string, string | undefined>>;
}

export interface JobNode {
  readonly id: string;
  readonly stage: "synth" | "train" | "merge" | "eval";
  readonly target: string;
  readonly dependsOn: readonly string[];
  readonly manifest: AdapterManifest | MergeManifest | SwarmPipeline;
  /** Remote compute for the job; null runs on the Actions runner (synth). */
  readonly compute: ComputeRequest | null;
}

const HOUR_MS = 60 * 60 * 1000;

/** Worst-case USD for a remote job: catalog rate x devices x hard runtime cap. */
export function estimateUsd(compute: ComputeRequest | null): number | null {
  if (!compute) return null;
  const profile = getGpuProfile(compute.profileId);
  if (!profile) return null;
  return (
    Math.round(
      profile.approxUsdPerHour *
        compute.gpuCount *
        compute.maxRuntimeHours *
        100,
    ) / 100
  );
}

/**
 * Heuristic VRAM floor for a 4-bit (nf4) model with LoRA under gradient
 * checkpointing. Used to refuse obviously impossible placements before any
 * spend, not as a guarantee that a placement fits.
 *   weights:     0.55 GB per B params (nf4 + double-quant constants + bf16 embeddings)
 *   activations: ~6 GB per 4k tokens in flight at 27B-class width
 *   fixed:       4 GB for CUDA context, LoRA params, optimizer state, fragmentation
 */
export function estimateQloraVramGb(
  parametersB: number,
  seqLen: number,
  microBatch: number,
): number {
  return Math.ceil(parametersB * 0.55 + (6 * seqLen * microBatch) / 4096 + 4);
}

/** bf16 checkpoint size in GB. */
export function bf16SizeGb(parametersB: number): number {
  return Math.ceil(parametersB * 2);
}

function baseBlockers(base: BaseModelRef): string[] {
  const out: string[] = [];
  if (!PINNED_REVISION.test(base.revision)) {
    out.push(
      `base ${base.upstreamId} revision is "${base.revision}"; pin a 40-hex commit sha for reproducibility`,
    );
  }
  if (base.license.review !== "approved") {
    out.push(
      `base ${base.upstreamId} license (${base.license.license}) review is ${base.license.review}`,
    );
  }
  return out;
}

function remoteBlockers(
  bundle: Bundle,
  compute: ComputeRequest,
  estimate: number | null,
): string[] {
  const out: string[] = [];
  if (!bundle.controlPlane.trainingReady) {
    out.push(
      "control-plane.json trainingReady is false (owner decision; docs/TRAINING_READY.md)",
    );
  }
  const maxRuntimeMs = compute.maxRuntimeHours * HOUR_MS;
  out.push(
    ...validateProvisionRequest({
      profileId: compute.profileId,
      gpuCount: compute.gpuCount,
      maxRuntimeMs,
      shutdownPolicy: { autoShutdownAfterMs: maxRuntimeMs },
    }).map((e) => `compute: ${e}`),
  );
  if (estimate !== null) {
    const guard = new BudgetGuard(bundle.compute.budget);
    try {
      for (const run of bundle.runs) {
        if (run.costUsd)
          guard.recordSpend({ runId: run.runId, amountUsd: run.costUsd });
      }
      if (guard.wouldExceed(estimate)) {
        out.push(
          `budget: worst case $${estimate.toFixed(2)} breaks a ceiling (per run $${bundle.compute.budget.maxUsdPerRun}, ` +
            `remaining total $${guard.remainingUsd().toFixed(2)})`,
        );
      }
    } catch (error) {
      out.push(
        `budget: recorded spend already breaks the total ceiling (${(error as Error).message})`,
      );
    }
  }
  return out;
}

function vramBlocker(
  compute: ComputeRequest,
  needGb: number,
  what: string,
): string[] {
  const profile = getGpuProfile(compute.profileId);
  const haveGb = (profile?.vramGb ?? 0) * compute.gpuCount;
  return haveGb >= needGb
    ? []
    : [
        `${what} needs about ${needGb} GB VRAM; ${compute.gpuCount}x ${compute.profileId} has ${haveGb} GB`,
      ];
}

function stageBlockers(node: JobNode): string[] {
  const out: string[] = [];
  if (JSON.stringify(node.manifest).includes("change-me")) {
    out.push(
      "manifest still contains change-me placeholders (Hugging Face org, dataset)",
    );
  }
  if (node.stage === "train") {
    const a = node.manifest as AdapterManifest;
    out.push(...baseBlockers(a.base));
    for (const d of a.datasets) {
      if (d.uri.startsWith("hf://") && !PINNED_REVISION.test(d.revision)) {
        out.push(
          `dataset ${d.id} revision is "${d.revision}"; pin a 40-hex commit sha`,
        );
      }
      if (d.license.review !== "approved") {
        out.push(
          `dataset ${d.id} license (${d.license.license}) review is ${d.license.review}`,
        );
      }
    }
    const h = a.hyperparameters;
    out.push(
      ...vramBlocker(
        a.compute,
        estimateQloraVramGb(
          a.base.parametersB,
          h.maxSeqLength,
          h.microBatchSize,
        ),
        "QLoRA training",
      ),
    );
  } else if (node.stage === "merge") {
    const m = node.manifest as MergeManifest;
    out.push(...baseBlockers(m.base));
    const size = bf16SizeGb(m.base.parametersB);
    if ((m.compute.minDiskGb ?? 0) < Math.ceil(size * 2.5)) {
      out.push(
        `merge needs minDiskGb >= ${Math.ceil(size * 2.5)} (base + output + cache at bf16)`,
      );
    }
    if ((m.compute.minRamGb ?? 0) < size) {
      out.push(`merge needs minRamGb >= ${size} (one bf16 copy of the base)`);
    }
    if (m.evolution.enabled) {
      out.push(
        "evolution.enabled: evolutionary merge search scores every candidate with GPU inference; " +
          "the worker implements the deterministic CPU merge only",
      );
    }
  } else if (node.stage === "eval") {
    const m = node.manifest as MergeManifest;
    out.push(
      ...vramBlocker(
        m.evalCompute,
        estimateQloraVramGb(m.base.parametersB, 4096, 1),
        "4-bit evaluation",
      ),
    );
  } else {
    const p = node.manifest as SwarmPipeline;
    if (
      !p.teachers.some((t) => t.outputsMayTrainModels.review === "approved")
    ) {
      out.push(
        "no teacher has approved terms for training on its outputs (outputsMayTrainModels)",
      );
    }
  }
  return out;
}

function runtimeBlockers(
  bundle: Bundle,
  node: JobNode,
  env: Readonly<Record<string, string | undefined>>,
): string[] {
  const out: string[] = [];
  const missing = (ref: string) => !env[ref] || env[ref]!.trim() === "";
  if (node.compute) {
    if (env[TRAINING_READY_ENV] !== "true")
      out.push(`runtime: ${TRAINING_READY_ENV} is not "true"`);
    const provider = bundle.compute.providers.find(
      (p) => p.id === node.compute!.provider,
    );
    for (const ref of provider
      ? [provider.endpointRef, provider.apiKeyRef]
      : []) {
      if (missing(ref)) out.push(`runtime: secret ${ref} is not configured`);
    }
  } else {
    const p = node.manifest as SwarmPipeline;
    const usable = p.teachers.filter(
      (t) =>
        t.outputsMayTrainModels.review === "approved" &&
        !missing(t.endpointRef) &&
        !missing(t.apiKeyRef),
    );
    if (usable.length === 0)
      out.push(
        "runtime: no approved teacher has its endpoint and key configured",
      );
    const prm = p.verification.prm;
    if (prm.required && (missing(prm.endpointRef) || missing(prm.apiKeyRef))) {
      out.push(
        `runtime: PRM is required but ${prm.endpointRef}/${prm.apiKeyRef} is not configured`,
      );
    }
  }
  return out;
}

/** Every reason the job may not be dispatched now; empty = cleared. */
export function jobBlockers(
  bundle: Bundle,
  node: JobNode,
  ctx: GateContext,
): string[] {
  const estimate = estimateUsd(node.compute);
  const out: string[] = [];
  const now = ctx.now.getTime();
  const auth = bundle.controlPlane.authorizations.find(
    (a) =>
      a.scope.includes(node.id) &&
      Date.parse(a.approvedAt) <= now &&
      now < Date.parse(a.expiresAt) &&
      (estimate === null || a.maxUsd >= estimate),
  );
  if (!auth) {
    out.push(
      `no unexpired owner authorization covers ${node.id}` +
        (estimate !== null ? ` at $${estimate.toFixed(2)}` : "") +
        " (add one to control-plane.json by pull request)",
    );
  }
  if (node.compute) out.push(...remoteBlockers(bundle, node.compute, estimate));
  out.push(...stageBlockers(node));
  if (ctx.env) out.push(...runtimeBlockers(bundle, node, ctx.env));
  return out;
}
