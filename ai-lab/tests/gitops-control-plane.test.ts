import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  dispatchModal,
  dispatchRunpod,
  fetchDatasetTexts,
  type FetchLike,
  httpProcessRewardModel,
} from "../gitops/lib/clients";
import { estimateQloraVramGb } from "../gitops/lib/gate";
import { canonicalJson, loadBundle } from "../gitops/lib/load";
import { buildPlan, type Plan, type PlannedJob } from "../gitops/lib/plan";
import { renderMergekitYaml, renderPayload } from "../gitops/lib/render";
import {
  type AdapterManifest,
  type Bundle,
  type MergeManifest,
  type RunRecord,
  validateBundleReferences,
  validateMerge,
  validateRunRecord,
} from "../gitops/lib/schema";

const ROOT = fileURLToPath(new URL("../gitops", import.meta.url));
const NOW = new Date("2026-10-05T12:00:00Z");
const SHA = "1".repeat(40);
const OUT = "2".repeat(40);
type Metric = { suite: string; metric: string; value: number };
type Mutable<T> = {
  -readonly [K in keyof T]: T[K] extends object ? Mutable<T[K]> : T[K];
};

function repoBundle(): Bundle {
  const { bundle, errors } = loadBundle(ROOT);
  expect(errors).toEqual([]);
  return bundle!;
}

/** The checked-in manifests with every owner decision taken. */
function cleared(): Mutable<Bundle> {
  const b = JSON.parse(
    JSON.stringify(repoBundle()).replaceAll("change-me-hf-org", "osirus-test"),
  ) as Mutable<Bundle>;
  const approve = {
    review: "approved" as const,
    evidence: "https://example.com/review",
  };
  b.controlPlane.trainingReady = true;
  for (const m of [...b.adapters, ...b.merges]) {
    m.base.revision = SHA;
    Object.assign(m.base.license, approve);
  }
  for (const a of b.adapters) {
    for (const d of a.datasets) {
      d.revision = SHA;
      Object.assign(d.license, approve);
    }
  }
  for (const t of b.pipelines[0].teachers)
    Object.assign(t.outputsMayTrainModels, approve);
  b.controlPlane.authorizations = [
    {
      id: "all",
      scope: [
        "synth:golden-tokens",
        "train:rouge-1",
        "train:quasnir-1",
        "merge:darus-1",
        "eval:darus-1",
      ],
      maxUsd: 40,
      approvedBy: "owner",
      approvedAt: "2026-10-01T00:00:00Z",
      expiresAt: "2026-11-01T00:00:00Z",
      evidence: "https://github.com/o/r/pull/1",
    },
  ];
  return b;
}

const job = (plan: Plan, id: string): PlannedJob =>
  plan.jobs.find((j) => j.id === id)!;

function succeeded(
  plan: Plan,
  id: string,
  uri: string,
  metrics: Metric[] = [],
  cost = 1,
): Mutable<RunRecord> {
  const j = job(plan, id);
  return {
    runId: `${j.target}-${j.stage}-run`,
    jobId: id,
    inputHash: j.inputHash!,
    status: "succeeded",
    provider: "runpod",
    providerJobId: "job-1",
    commitSha: SHA,
    startedAt: "2026-10-05T00:00:00Z",
    finishedAt: "2026-10-05T01:00:00Z",
    outputs: { uri, revision: OUT },
    metrics,
    costUsd: cost,
    error: null,
  };
}

/** Runs the whole DAG with recorded outputs; returns the bundle with state. */
function fullyRun(b: Mutable<Bundle>, darusMetrics: Metric[]): Mutable<Bundle> {
  let plan = buildPlan(b, { now: NOW });
  b.runs.push(
    succeeded(
      plan,
      "synth:golden-tokens",
      "hf://datasets/osirus-test/osirus-golden-tokens",
    ),
  );
  plan = buildPlan(b, { now: NOW });
  b.runs.push(
    succeeded(plan, "train:rouge-1", "hf://osirus-test/rouge-1-qlora", [
      { suite: "gsm8k", metric: "exact_match,strict-match", value: 0.8 },
      { suite: "ifeval", metric: "prompt_level_strict_acc,none", value: 0.7 },
    ]),
  );
  b.runs.push(
    succeeded(plan, "train:quasnir-1", "hf://osirus-test/quasnir-1-qlora", [
      { suite: "humaneval", metric: "pass_at_k,create_test", value: 0.6 },
      { suite: "mbpp", metric: "pass_at_1,none", value: 0.5 },
    ]),
  );
  plan = buildPlan(b, { now: NOW });
  b.runs.push(succeeded(plan, "merge:darus-1", "hf://osirus-test/darus-1"));
  plan = buildPlan(b, { now: NOW });
  b.runs.push(
    succeeded(plan, "eval:darus-1", "hf://osirus-test/darus-1", darusMetrics),
  );
  return b;
}

describe("gitops manifests as checked in", () => {
  it("validate, and every job is held by the closed gate", () => {
    const plan = buildPlan(repoBundle(), { now: NOW });
    expect(plan.jobs.map((j) => j.id)).toEqual([
      "synth:golden-tokens",
      "train:quasnir-1",
      "train:rouge-1",
      "merge:darus-1",
      "eval:darus-1",
    ]);
    expect(
      plan.jobs.every((j) => j.status === "blocked" || j.status === "waiting"),
    ).toBe(true);
    expect(job(plan, "train:rouge-1").blockers).toContain(
      "control-plane.json trainingReady is false (owner decision; docs/TRAINING_READY.md)",
    );
    expect(plan.promotions.every((p) => p.status === "unmeasured")).toBe(true);
  });

  it("fit the hardware and budget they request", () => {
    const b = repoBundle();
    for (const a of b.adapters) {
      expect(
        estimateQloraVramGb(
          a.base.parametersB,
          a.hyperparameters.maxSeqLength,
          a.hyperparameters.microBatchSize,
        ),
      ).toBeLessThanOrEqual(80);
    }
    const plan = buildPlan(b, { now: NOW });
    for (const j of plan.jobs)
      expect(
        j.blockers.some((r) => r.startsWith("budget") || r.includes("VRAM")),
      ).toBe(false);
  });
});

describe("reconciler", () => {
  it("releases jobs in dependency order as measured outputs arrive", () => {
    const b = cleared();
    let plan = buildPlan(b, { now: NOW });
    expect(job(plan, "synth:golden-tokens").status).toBe("ready");
    expect(job(plan, "train:rouge-1").status).toBe("ready");
    expect(job(plan, "train:quasnir-1").status).toBe("waiting");
    b.runs.push(
      succeeded(
        plan,
        "synth:golden-tokens",
        "hf://datasets/osirus-test/osirus-golden-tokens",
      ),
    );
    plan = buildPlan(b, { now: NOW });
    const quasnir = job(plan, "train:quasnir-1");
    expect(quasnir.status).toBe("ready");
    const payload = renderPayload(b, quasnir, { commitSha: SHA, now: NOW });
    expect(payload.train!.datasets).toEqual([
      { repo: "osirus-test/osirus-golden-tokens", revision: OUT },
    ]);
    expect(payload.train!.modelCard).toContain(
      "foreign base weights, not self-trained",
    );
    expect(payload.timeoutMs).toBe(10 * 3_600_000);
    // Secret names and values stay in the worker environment.
    expect(JSON.stringify(payload)).not.toMatch(/apiKey|_KEY|_TOKEN|Bearer/);
  });

  it("renders the MergeKit config from pinned parent outputs", () => {
    const b = fullyRun(cleared(), []);
    b.runs = b.runs.filter((r) => !r.jobId.endsWith("darus-1"));
    const merge = job(buildPlan(b, { now: NOW }), "merge:darus-1");
    expect(merge.status).toBe("ready");
    const yaml = renderPayload(b, merge, { commitSha: SHA, now: NOW }).merge!
      .mergekitYaml;
    expect(yaml).toContain("merge_method: ties");
    expect(yaml).toContain(`base_model: "google/gemma-3-27b-it@${SHA}"`);
    expect(yaml).toContain(
      `- model: "google/gemma-3-27b-it@${SHA}+osirus-test/rouge-1-qlora@${OUT}"`,
    );
    expect(yaml).toContain("density: 0.5");
    expect(yaml).toContain("int8_mask: true");
  });

  it("detects drift: a changed hyperparameter re-plans the adapter and everything downstream", () => {
    const b = fullyRun(cleared(), []);
    expect(
      buildPlan(b, { now: NOW }).jobs.every((j) => j.status === "up-to-date"),
    ).toBe(true);
    (
      b.adapters.find((a) => a.id === "rouge-1")!.hyperparameters as Mutable<
        AdapterManifest["hyperparameters"]
      >
    ).learningRate = 0.0002;
    const plan = buildPlan(b, { now: NOW });
    expect(job(plan, "train:quasnir-1").status).toBe("up-to-date");
    expect(job(plan, "train:rouge-1").status).toBe("ready");
    expect(job(plan, "train:rouge-1").notes.join()).toContain("drift");
    expect(job(plan, "merge:darus-1").status).toBe("waiting");
  });

  it("ignores resource-only changes when hashing", () => {
    const b = fullyRun(cleared(), []);
    (
      b.adapters[0].compute as Mutable<AdapterManifest["compute"]>
    ).maxRuntimeHours = 11;
    expect(
      buildPlan(b, { now: NOW }).jobs.every((j) => j.status === "up-to-date"),
    ).toBe(true);
  });

  it("promotes the merge only without regression beyond tolerance vs each parent", () => {
    const good = [
      { suite: "gsm8k", metric: "m", value: 0.79 },
      { suite: "ifeval", metric: "m", value: 0.7 },
      { suite: "humaneval", metric: "m", value: 0.59 },
      { suite: "mbpp", metric: "m", value: 0.5 },
    ];
    const ok = buildPlan(fullyRun(cleared(), good), {
      now: NOW,
    }).promotions.find((p) => p.model === "darus-1")!;
    expect(ok).toEqual({ model: "darus-1", status: "promotable", reasons: [] });
    const bad = good.map((m) =>
      m.suite === "humaneval" ? { ...m, value: 0.55 } : m,
    );
    const no = buildPlan(fullyRun(cleared(), bad), {
      now: NOW,
    }).promotions.find((p) => p.model === "darus-1")!;
    expect(no.status).toBe("not-met");
    expect(no.reasons).toEqual([
      "humaneval: 0.55 regresses more than 0.02 below parent quasnir-1 (0.6)",
    ]);
  });
});

describe("dispatch gate", () => {
  const blockers = (b: Bundle, id: string, env?: Record<string, string>) =>
    job(buildPlan(b, { now: NOW, env }), id).blockers;

  it("requires an unexpired authorization that covers the worst case", () => {
    const b = cleared();
    b.controlPlane.authorizations[0].expiresAt = "2026-10-04T00:00:00Z";
    expect(blockers(b, "train:rouge-1")[0]).toMatch(
      /no unexpired owner authorization covers train:rouge-1 at \$22\.68/,
    );
    const c = cleared();
    c.controlPlane.authorizations[0].maxUsd = 10;
    expect(blockers(c, "train:rouge-1")[0]).toMatch(
      /no unexpired owner authorization/,
    );
  });

  it("refuses placements that cannot fit, budgets that are spent, and unbuilt features", () => {
    const b = cleared();
    (b.adapters[1].compute as Mutable<AdapterManifest["compute"]>).profileId =
      "rtx-4090-24gb";
    expect(blockers(b, "train:rouge-1")).toContain(
      "QLoRA training needs about 25 GB VRAM; 1x rtx-4090-24gb has 24 GB",
    );
    const spent = fullyRun(cleared(), []);
    spent.runs[0].costUsd = 190;
    spent.adapters[1].hyperparameters.seed = 7;
    expect(blockers(spent, "train:rouge-1").join()).toMatch(
      /budget: worst case \$22\.68 breaks a ceiling/,
    );
    const evo = cleared();
    (evo.merges[0] as Mutable<MergeManifest>).evolution.enabled = true;
    expect(blockers(evo, "merge:darus-1").join()).toMatch(
      /evolutionary merge search/,
    );
  });

  it("checks the runtime flag and provider secrets only for an actual dispatch", () => {
    const b = cleared();
    expect(blockers(b, "train:rouge-1")).toEqual([]);
    expect(blockers(b, "train:rouge-1", {})).toEqual([
      'runtime: OSIRUS_TRAINING_READY is not "true"',
      "runtime: secret RUNPOD_ENDPOINT_ID is not configured",
      "runtime: secret RUNPOD_API_KEY is not configured",
    ]);
    const env = {
      OSIRUS_TRAINING_READY: "true",
      RUNPOD_ENDPOINT_ID: "abc123",
      RUNPOD_API_KEY: "k",
    };
    expect(blockers(b, "train:rouge-1", env)).toEqual([]);
    expect(blockers(b, "synth:golden-tokens", env)).toEqual([
      "runtime: no approved teacher has its endpoint and key configured",
      "runtime: PRM is required but PRM_URL/PRM_API_KEY is not configured",
    ]);
  });
});

describe("schema invariants", () => {
  it("refuses a merge whose parents were trained on another base revision", () => {
    const b = cleared();
    b.adapters[0].base.revision = "3".repeat(40);
    expect(validateBundleReferences(b).join()).toMatch(
      /task vectors only merge on one shared base/,
    );
  });

  it("refuses approvals without evidence, mismatched weights, and unexplained failures", () => {
    const m = JSON.parse(JSON.stringify(repoBundle().merges[0]));
    m.base.license = { license: "x", review: "approved", evidence: null };
    m.weights = { "rouge-1": 0.5 };
    const errors = validateMerge(m, ["runpod", "modal"]).join("\n");
    expect(errors).toMatch(/approved without evidence/);
    expect(errors).toMatch(/weights must have exactly one entry per parent/);
    const run = {
      ...succeeded(
        buildPlan(cleared(), { now: NOW }),
        "train:rouge-1",
        "hf://o/r",
      ),
      status: "failed",
    };
    expect(validateRunRecord(run)).toContain(
      "state/runs/<run>.json: error must explain a failed run",
    );
  });

  it("hashes canonically regardless of key order", () => {
    expect(canonicalJson({ b: 1, a: [{ d: 2, c: 3 }] })).toBe(
      canonicalJson({ a: [{ c: 3, d: 2 }], b: 1 }),
    );
  });

  it("renders sparse-method parameters only for sparse methods", () => {
    const m = {
      ...repoBundle().merges[0],
      method: "linear",
      density: null,
    } as MergeManifest;
    const yaml = renderMergekitYaml(m, [
      { id: "rouge-1", repo: "o/a", revision: OUT },
      { id: "quasnir-1", repo: "o/b", revision: OUT },
    ]);
    expect(yaml).not.toMatch(/density|int8_mask/);
  });
});

describe("worker contract (TypeScript payload -> Python worker -> run record)", () => {
  it("produces records the control plane accepts", () => {
    const b = cleared();
    const plan = buildPlan(b, { now: NOW });
    const payload = renderPayload(b, job(plan, "train:rouge-1"), {
      commitSha: SHA,
      now: NOW,
    });
    const dir = mkdtempSync(path.join(tmpdir(), "gitops-contract-"));
    writeFileSync(path.join(dir, "payload.json"), JSON.stringify(payload));
    const script = [
      "import json, sys",
      "import jobs",
      "p = json.load(open(sys.argv[1]))",
      "jobs.validate_payload(p)",
      "ok = jobs.build_record(p, provider_job_id='rp-123', started_at='2026-10-05T00:00:00Z', finished_at='2026-10-05T02:00:00Z', elapsed_hours=2, outputs={'uri': 'hf://osirus-test/rouge-1-qlora', 'revision': '" +
        OUT +
        "'}, metrics=[{'suite': 'gsm8k', 'metric': 'exact_match,strict-match', 'value': 0.8}], error=None)",
      "bad = jobs.build_record(p, provider_job_id='rp-124', started_at='2026-10-05T00:00:00Z', finished_at='2026-10-05T00:10:00Z', elapsed_hours=0.1, outputs=None, metrics=[], error='CUDA out of memory')",
      "print(json.dumps([ok, bad]))",
    ].join("\n");
    const res = spawnSync(
      "python3",
      ["-c", script, path.join(dir, "payload.json")],
      {
        cwd: path.join(ROOT, "worker"),
        encoding: "utf8",
      },
    );
    expect(res.stderr).toBe("");
    const [ok, bad] = JSON.parse(res.stdout) as Mutable<RunRecord>[];
    expect(validateRunRecord(ok)).toEqual([]);
    expect(validateRunRecord(bad)).toEqual([]);
    expect(ok.costUsd).toBe(3.78);
    b.runs.push(ok);
    expect(job(buildPlan(b, { now: NOW }), "train:rouge-1").status).toBe(
      "up-to-date",
    );
  });
});

describe("provider and model clients", () => {
  function recorder(body: unknown, status = 200) {
    const calls: { url: string; init: Parameters<FetchLike>[1] }[] = [];
    const fetch: FetchLike = async (url, init) => {
      calls.push({ url, init });
      return {
        ok: status < 300,
        status,
        text: async () => JSON.stringify(body),
      };
    };
    return { calls, fetch };
  }
  const payload = () =>
    renderPayload(
      cleared(),
      job(buildPlan(cleared(), { now: NOW }), "train:rouge-1"),
      { commitSha: SHA, now: NOW },
    );

  it("dispatches to RunPod serverless with the kill switch as execution timeout", async () => {
    const { calls, fetch } = recorder({ id: "rp-1", status: "IN_QUEUE" });
    const p = payload();
    expect(await dispatchRunpod(fetch, "abc123def", "key", p)).toEqual({
      providerJobId: "rp-1",
      status: "IN_QUEUE",
    });
    expect(calls[0].url).toBe("https://api.runpod.ai/v2/abc123def/run");
    expect(calls[0].init.headers.authorization).toBe("Bearer key");
    expect(JSON.parse(calls[0].init.body!)).toEqual({
      input: p,
      policy: { executionTimeout: 12 * 3_600_000 },
    });
    await expect(dispatchRunpod(fetch, "../x", "key", p)).rejects.toThrow(
      /unexpected shape/,
    );
  });

  it("reports provider errors without echoing credentials", async () => {
    const { fetch } = recorder({ error: "denied" }, 401);
    await expect(
      dispatchRunpod(fetch, "abc123def", "sekret", payload()),
    ).rejects.toThrow(/HTTP 401/);
    await expect(
      dispatchRunpod(fetch, "abc123def", "sekret", payload()),
    ).rejects.not.toThrow(/sekret/);
    await expect(
      dispatchModal(fetch, "https://evil.example.com/x", "k", payload()),
    ).rejects.toThrow(/modal\.run/);
  });

  it("validates PRM responses and pages through eval rows", async () => {
    const prm = httpProcessRewardModel(recorder({ stepScores: [0.9] }).fetch, {
      url: "https://prm.example",
      apiKey: "k",
    });
    await expect(
      prm({ prompt: "p", steps: ["a", "b"], solution: "s" }),
    ).rejects.toThrow(/one score/);
    let page = 0;
    const rows: FetchLike = async (url) => {
      expect(url).toContain("dataset=openai%2Fgsm8k");
      const n = page++ === 0 ? 100 : 3;
      return {
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            rows: Array.from({ length: n }, (_, i) => ({
              row: { question: `q${i}`, answer: `a${i}`, id: i },
            })),
          }),
      };
    };
    const texts = await fetchDatasetTexts(
      rows,
      "hf-rows:openai/gsm8k:main:test",
    );
    expect(texts).toHaveLength(103);
    expect(texts[0]).toBe("q0\na0");
  });
});
