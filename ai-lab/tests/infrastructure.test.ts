import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { promote, PromotionError } from "../artifacts/states";
import { splitHoldout } from "../datasets/splits";
import { judgePredictions } from "../evals/independent-judge";
import { ExperimentTracker } from "../experiments/tracker";
import {
  BudgetExceededError,
  BudgetGuard,
  NotAuthorizedError,
  RunPodProvider,
} from "../infra/runpod";
import { LabCostBudget, estimateCallUsd } from "../inference/budget";
import {
  APIModelProvider,
  FallbackModelProvider,
  NativeModelProvider,
} from "../inference/providers";
import { UnoRouterError } from "../inference/unorouter";
import { labLog } from "../observability/log";
import { ArchitectureRegistry } from "../registries/architectures";
import { ModelRegistry } from "../registries/models";
import { TokenizerRegistry, tokenizerPin } from "../registries/tokenizers";
import { refuseModelShell } from "../safety/boundaries";
import { CheckpointManager, restoreCheckpoint } from "../checkpoints/manager";
import { loadTrackDefinitions, routingSnapshot } from "../tracks/status";
import {
  validateTrackDefinition,
  type TrackDefinition,
} from "../tracks/definition";
import {
  backward,
  forward,
  initTiny,
  trainStep,
} from "../training/tiny-engine";

function track(id: string, fallback: string): TrackDefinition {
  const tokenizer = {
    id: `${id}-bpe`,
    trackId: id,
    family: "byte-level-bpe",
    version: "0.0.0-untrained",
    vocabSize: id === "rouge" ? 32000 : 16000,
  };
  return {
    trackId: id,
    displayName: id,
    identity: `${id} identity`,
    nativeModelId: `osirus/${id}`,
    architecture: {
      id: `${id}-arch`,
      family: "llama-like-decoder-transformer",
      layers: 4,
      hiddenSize: 64,
      attentionHeads: 4,
      kvHeads: 2,
      activation: "swiglu",
      norm: "rmsnorm",
      positional: "rope",
      status: "planned",
    },
    tokenizer: { ...tokenizer, pin: tokenizerPin(tokenizer) },
    datasetMixture: {
      id: `${id}-mix`,
      parts: [{ source: "fixture", fraction: 1, license: "mit" }],
    },
    curriculum: [
      {
        id: `${id}-stage0`,
        order: 0,
        objective: "fixture",
        mixtureId: `${id}-mix`,
        executable: "tiny-linear-v1",
      },
    ],
    behaviorSpec: `${id} answers in its own role and does not claim to be trained`,
    specialistObjectives: [`${id} objective`],
    evalSuite: {
      id: `${id}-eval`,
      measured: false,
      tasks: ["fixture-holdout"],
    },
    trainingConfig: {
      executableFixture: "tiny-linear-v1",
      plannedParameterClass: "untrained",
      seed: 7,
    },
    inferenceConfig: {
      nativeRuntime: "not_shipped",
      apiFallback: {
        label: `UnoRouter API fallback — not ${id}`,
        defaultModelId: fallback,
        envVar: `LAB_FALLBACK_MODEL_${id.toUpperCase()}`,
        catalogRole: "general",
        verifiedFrom: "https://api.unorouter.com/api/pricing/catalog",
        verifiedOn: "2026-10-02",
      },
    },
    capabilityTargets: [{ id: `${id}-target`, status: "unmeasured" }],
  };
}

describe("ai-lab infrastructure", () => {
  it("registers models, architectures, and pinned tokenizers", () => {
    const dir = mkdtempSync(join(tmpdir(), "lab-reg-"));
    const models = new ModelRegistry(join(dir, "models.jsonl"));
    models.register({
      id: "osirus/rouge-1",
      trackId: "rouge",
      role: "general/reasoning",
      selfTrained: false,
      artifactState: "infrastructure_ready",
      createdAt: "2026-10-02T00:00:00.000Z",
    });
    expect(models.get("osirus/rouge-1")?.selfTrained).toBe(false);
    expect(() =>
      models.register({
        id: "bad",
        trackId: "rouge",
        role: "general",
        selfTrained: true as unknown as false,
        artifactState: "infrastructure_ready",
        createdAt: "2026-10-02T00:00:00.000Z",
      }),
    ).toThrow(/selfTrained/);

    const architectures = new ArchitectureRegistry(join(dir, "arch.jsonl"));
    architectures.register({
      id: "rouge-arch",
      trackId: "rouge",
      family: "llama-like-decoder-transformer",
      layers: 24,
      hiddenSize: 2048,
      attentionHeads: 16,
      status: "planned",
      createdAt: "2026-10-02T00:00:00.000Z",
    });
    expect(architectures.get("rouge-arch")?.status).toBe("planned");

    const tokenizers = new TokenizerRegistry(join(dir, "tok.jsonl"));
    const pinInput = {
      id: "rouge-bpe",
      trackId: "rouge",
      family: "byte-level-bpe",
      version: "0.0.0-untrained",
      vocabSize: 32000,
    };
    tokenizers.register({ ...pinInput, pin: tokenizerPin(pinInput) });
    expect(() => tokenizers.assertPinned("rouge-bpe", "deadbeef")).toThrow(
      /pin mismatch/,
    );
    expect(() =>
      tokenizers.register({ ...pinInput, id: "other", pin: "not-a-pin" }),
    ).toThrow(/pin/);
  });

  it("keeps holdout ids out of the training split", () => {
    const rows = Array.from({ length: 40 }, (_, index) => ({
      id: `row-${index}`,
    }));
    const split = splitHoldout(rows, 0.25, "lab-seed");
    const trainIds = new Set(split.train.map((row) => row.id));
    expect(split.train.length).toBeGreaterThan(0);
    expect(split.holdout.length).toBeGreaterThan(0);
    for (const row of split.holdout) expect(trainIds.has(row.id)).toBe(false);
    expect(split.train.length + split.holdout.length).toBe(rows.length);
  });

  it("runs a real tiny forward and backward step", () => {
    const state = initTiny({ in: 2, out: 1, lr: 0.05, seed: 4 });
    const x = [0.3, -0.2];
    const target = [0.25];
    const before = forward(state, x);
    const grad = backward(state, x, target);
    const eps = 1e-5;
    const bumped = {
      ...state,
      w: state.w.map((value, index) => (index === 0 ? value + eps : value)),
    };
    const dropped = {
      ...state,
      w: state.w.map((value, index) => (index === 0 ? value - eps : value)),
    };
    const numeric =
      (backward(bumped, x, target).loss - backward(dropped, x, target).loss) /
      (2 * eps);
    expect(Math.abs(numeric - (grad.gw[0] ?? 0))).toBeLessThan(1e-4);
    const stepped = trainStep(state, [{ x, y: target }]);
    expect(stepped.state.step).toBe(state.step + 1);
    expect(stepped.loss).not.toBe(before[0]);
    expect(JSON.stringify(stepped.state.w)).not.toBe(JSON.stringify(state.w));
  });

  it("creates and restores a JSON checkpoint and refuses pickle", () => {
    const dir = mkdtempSync(join(tmpdir(), "lab-ckpt-"));
    const manager = new CheckpointManager(dir);
    const state = initTiny({ in: 1, out: 1, lr: 0.2, seed: 1 });
    let current = state;
    for (let i = 0; i < 30; i += 1) {
      current = trainStep(current, [
        { x: [0.2], y: [0.1] },
        { x: [0.8], y: [0.4] },
      ]).state;
    }
    const created = manager.create({
      trackId: "fixture",
      checkpointId: "toy",
      state: current,
    });
    expect(created.checkpoint.selfTrained).toBe(false);
    expect(created.checkpoint.artifactState).toBe("checkpoint_created");
    const restored = manager.restore(created.path);
    expect(restored.state.w).toEqual(current.w);
    const validated = manager.validate(created.path);
    expect(validated.checkpoint.artifactState).toBe("checkpoint_validated");
    expect(() => restoreCheckpoint(new Uint8Array([0x80, 0x04, 0x95]))).toThrow(
      /pickle/,
    );
    const picklePath = join(dir, "bad.pkl");
    writeFileSync(picklePath, "{}");
    expect(() => manager.restore(picklePath)).toThrow(/pickle/);
  });

  it("judges holdout predictions independently of the training loss", () => {
    const verdict = judgePredictions(
      [
        { id: "h1", prediction: [0], target: [1] },
        { id: "h2", prediction: [0], target: [1] },
      ],
      0.01,
    );
    expect(verdict.passed).toBe(false);
    expect(verdict.meanSquaredError).toBe(1);
    expect(verdict.judge).toBe("independent-mse-v1");
    const easy = judgePredictions(
      [{ id: "h1", prediction: [0.5], target: [0.5] }],
      0,
    );
    expect(easy.passed).toBe(true);
  });

  it("switches native and UnoRouter without changing the caller", async () => {
    const fetchImpl = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          model: "qwen3:free",
          choices: [{ message: { content: "fallback-text" } }],
          usage: { prompt_tokens: 2, completion_tokens: 1 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    let native = {
      checkpointPresent: false,
      checkpointValidated: false,
      runtimeOnline: false,
    };
    const checkpoint = initTiny({ in: 2, out: 1, lr: 0.1, seed: 2 });
    const provider = new FallbackModelProvider(
      new NativeModelProvider({
        status: () => native,
        checkpoint,
        checkpointId: "toy",
      }),
      new APIModelProvider({
        modelId: "qwen3:free",
        apiKey: "test-key-not-real",
        fetchImpl: fetchImpl as unknown as typeof fetch,
        budget: new LabCostBudget(0),
      }),
      () => native,
    );
    const request = {
      trackId: "rouge",
      nativeModelId: "osirus/rouge-1",
      messages: [{ role: "user" as const, content: "hello" }],
      features: [1, 0],
    };
    const first = await provider.complete(request);
    expect(first.provenance.provider).toBe("unorouter");
    expect(first.provenance.modelId).toBe("qwen3:free");
    expect(first.provenance.modelId).not.toBe(request.nativeModelId);
    expect(first.provenance.routingReason).toBe("native_checkpoint_missing");
    expect(first.provenance.checkpoint).toBeNull();
    native = {
      checkpointPresent: true,
      checkpointValidated: true,
      runtimeOnline: true,
    };
    const second = await provider.complete(request);
    expect(second.provenance.provider).toBe("native");
    expect(second.provenance.checkpoint).toBe("toy");
    expect(second.provenance.routingReason).toBe(
      "native_checkpoint_validated_and_online",
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const url = String((fetchImpl.mock.calls[0] as unknown[])[0]);
    expect(url).toBe("https://api.unorouter.com/v1/chat/completions");
  });

  it("fails closed when the UnoRouter key is missing", async () => {
    const fetchImpl = vi.fn();
    const provider = new APIModelProvider({
      modelId: "qwen3:free",
      apiKey: undefined,
      env: { NODE_ENV: "test" },
      fetchImpl: fetchImpl as unknown as typeof fetch,
      budget: new LabCostBudget(0),
    });
    await expect(
      provider.complete({
        trackId: "darus",
        nativeModelId: "osirus/darus-1",
        messages: [{ role: "user", content: "ping" }],
      }),
    ).rejects.toBeInstanceOf(UnoRouterError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("stops on the cost budget before any call", () => {
    expect(() => estimateCallUsd("some-paid-model", undefined)).toThrow(
      /no price/,
    );
    const budget = new LabCostBudget(0);
    expect(() => budget.reserve(0.01)).toThrow(/cost budget stop/);
    expect(budget.spent).toBe(0);
    budget.reserve(0);
    expect(budget.spent).toBe(0);
    expect(() =>
      new BudgetGuard({ maxUsdPerRun: 1, maxUsdTotal: 1 }).assertWithinBudget(
        50,
      ),
    ).toThrow(BudgetExceededError);
  });

  it("does not boot a paid pod when provisioning is unauthorized", async () => {
    const provider = new RunPodProvider({ dryRun: false });
    await expect(
      provider.provision({
        profileId: "cpu-only",
        gpuCount: 1,
        maxRuntimeMs: 60_000,
        shutdownPolicy: { autoShutdownAfterMs: 60_000 },
      }),
    ).rejects.toBeInstanceOf(NotAuthorizedError);
  });

  it("refuses production promotion and model shells", () => {
    expect(promote("checkpoint_created", "checkpoint_validated")).toBe(
      "checkpoint_validated",
    );
    expect(() => promote("holdout_passed", "production_candidate")).toThrow(
      PromotionError,
    );
    expect(() => promote("production_candidate", "production")).toThrow(
      PromotionError,
    );
    expect(() =>
      refuseModelShell({ type: "shell", command: "rm -rf /" }),
    ).toThrow(/shell/);
  });

  it("redacts secrets from lab logs", () => {
    const line = labLog(
      "fallback",
      { authorization: "Bearer super-secret", note: "Bearer super-secret" },
      ["super-secret"],
    );
    expect(line).not.toContain("super-secret");
    expect(line).toContain("[redacted]");
  });

  it("loads a track definition and reports fallback routing", () => {
    const dir = mkdtempSync(join(tmpdir(), "lab-tracks-"));
    const definition = track("rouge", "qwen3:free");
    expect(validateTrackDefinition(definition)).toEqual([]);
    writeFileSync(join(dir, "rouge.json"), JSON.stringify(definition));
    expect(loadTrackDefinitions(dir)).toHaveLength(1);
    const snapshot = routingSnapshot({
      definitionsDir: dir,
      checkpointDir: join(dir, "missing"),
      env: { NODE_ENV: "test" },
      now: () => "2026-10-02T12:00:00.000Z",
    });
    expect(snapshot.trainingStarted).toBe(false);
    expect(snapshot.production).toBe(false);
    expect(snapshot.tracks[0]?.routeProvider).toBe("unorouter");
    expect(snapshot.tracks[0]?.blocked).toBe(true);
    expect(snapshot.tracks[0]?.live).toBe(false);
    expect(JSON.stringify(snapshot)).not.toContain("UNOROUTER_API_KEY");
  });

  it("records an experiment draft without marking it trained", () => {
    const dir = mkdtempSync(join(tmpdir(), "lab-exp-"));
    const tracker = new ExperimentTracker(join(dir, "experiments.jsonl"));
    const opened = tracker.openDraft({
      id: "exp-fixture",
      hypothesis:
        "the tiny CPU fixture can step and restore; this is not a capability claim",
      config: { fixture: "tiny-linear-v1", seed: 1 },
      datasetIds: ["ds-fixture"],
      baselineIds: ["api-fallback"],
      seed: 1,
      tokenizerPin: "abc",
    });
    expect(opened.experiment.status).toBe("draft");
    expect(opened.repro.configHash).toHaveLength(64);
    tracker.noteFixture("exp-fixture", 0.5);
    expect(tracker.observations[0]?.artifactState).toBe("checkpoint_created");
    const raw = readFileSync(join(dir, "experiments.jsonl"), "utf8");
    expect(raw).not.toContain('"selfTrained":true');
  });
});
