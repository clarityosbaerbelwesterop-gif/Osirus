/**
 * GitOps control plane — reads the declarative state from disk.
 *
 * Layout under the root (default `ai-lab/gitops`):
 *   control-plane.json              gate + owner authorizations
 *   compute/providers.json          compute providers + budget ceilings
 *   models/*.json                   qlora-adapter and merge manifests
 *   pipelines/*.json                synthetic-data pipelines
 *   inference/test-time-compute.json
 *   state/runs/*.json               measured run records (written by gitops-record)
 */

import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  type AdapterManifest,
  type Bundle,
  type ComputeCatalog,
  type ControlPlane,
  type MergeManifest,
  type RunRecord,
  type SwarmPipeline,
  type TestTimeCompute,
  validateAdapter,
  validateBundleReferences,
  validateComputeCatalog,
  validateControlPlane,
  validateMerge,
  validatePipeline,
  validateRunRecord,
  validateTestTimeCompute,
} from "./schema";

/** JSON with recursively sorted keys: the input to every content hash. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export interface LoadResult {
  readonly bundle: Bundle | null;
  readonly errors: string[];
}

function readJson(file: string, rel: string, errors: string[]): unknown {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    errors.push(`${rel}: ${(error as Error).message}`);
    return undefined;
  }
}

function jsonFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort();
}

export function loadBundle(root: string): LoadResult {
  const errors: string[] = [];
  const read = (rel: string) => readJson(path.join(root, rel), rel, errors);

  const controlPlane = read("control-plane.json");
  errors.push(...validateControlPlane(controlPlane));
  const compute = read("compute/providers.json");
  const computeErrors = validateComputeCatalog(compute);
  errors.push(...computeErrors);
  const providerIds =
    computeErrors.length === 0
      ? (compute as ComputeCatalog).providers.map((p) => p.id)
      : [];

  const adapters: AdapterManifest[] = [];
  const merges: MergeManifest[] = [];
  for (const file of jsonFiles(path.join(root, "models"))) {
    const rel = `models/${file}`;
    const doc = read(rel) as { kind?: unknown; id?: unknown } | undefined;
    if (doc === undefined) continue;
    const fileErrors =
      doc.kind === "merge"
        ? validateMerge(doc, providerIds, rel)
        : validateAdapter(doc, providerIds, rel);
    if (fileErrors.length === 0 && doc.id !== file.slice(0, -5)) {
      fileErrors.push(
        `${rel}: id "${String(doc.id)}" must match the file name`,
      );
    }
    errors.push(...fileErrors);
    if (fileErrors.length > 0) continue;
    if (doc.kind === "merge") merges.push(doc as MergeManifest);
    else adapters.push(doc as AdapterManifest);
  }

  const pipelines: SwarmPipeline[] = [];
  for (const file of jsonFiles(path.join(root, "pipelines"))) {
    const rel = `pipelines/${file}`;
    const doc = read(rel);
    const fileErrors = validatePipeline(doc, rel);
    errors.push(...fileErrors);
    if (fileErrors.length === 0) pipelines.push(doc as SwarmPipeline);
  }

  const inference = read("inference/test-time-compute.json");
  errors.push(...validateTestTimeCompute(inference));

  const runs: RunRecord[] = [];
  for (const file of jsonFiles(path.join(root, "state/runs"))) {
    const rel = `state/runs/${file}`;
    const doc = read(rel) as { runId?: unknown } | undefined;
    const fileErrors = validateRunRecord(doc, rel);
    if (fileErrors.length === 0 && doc?.runId !== file.slice(0, -5)) {
      fileErrors.push(`${rel}: runId must match the file name`);
    }
    errors.push(...fileErrors);
    if (fileErrors.length === 0) runs.push(doc as RunRecord);
  }

  if (errors.length > 0) return { bundle: null, errors };
  const bundle: Bundle = {
    controlPlane: controlPlane as ControlPlane,
    compute: compute as ComputeCatalog,
    adapters,
    merges,
    pipelines,
    inference: inference as TestTimeCompute,
    runs,
  };
  const refErrors = validateBundleReferences(bundle);
  return refErrors.length > 0
    ? { bundle: null, errors: refErrors }
    : { bundle, errors: [] };
}
