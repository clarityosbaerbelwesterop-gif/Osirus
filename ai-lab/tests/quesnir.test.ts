/**
 * AI Lab — Quesnir scaffold config tests (Phase I, branch quesnir/scaffold).
 *
 * Verifies the Quesnir model config: planned architecture values, FIM config,
 * the § 5 baseline fallbacks with licenses and structurally false
 * `selfTrained`, the reserved native-checkpoint slot, and the
 * TRAINING_READY=FALSE gate. Picked up by the root vitest gate via
 * `ai-lab/tests/**` in vitest.config.ts.
 */

import { describe, expect, it } from "vitest";

import {
  QUESNIR_CONFIG,
  validateQuesnirConfig,
  type QuesnirModelConfig,
} from "../models/quesnir/model.config";

describe("QUESNIR_CONFIG", () => {
  it("validates clean against the pure validator", () => {
    expect(validateQuesnirConfig(QUESNIR_CONFIG)).toEqual([]);
  });

  it("is an untrained coding+security scaffold with the training gate closed", () => {
    expect(QUESNIR_CONFIG.role).toBe("coding+security");
    expect(QUESNIR_CONFIG.status).toBe("scaffold-untrained");
    expect(QUESNIR_CONFIG.trainingReady).toBe(false);
  });

  it("records FIM support with a valid format and rate", () => {
    expect(QUESNIR_CONFIG.fim.enabled).toBe(true);
    expect(["PSM", "SPM"]).toContain(QUESNIR_CONFIG.fim.format);
    expect(QUESNIR_CONFIG.fim.rate).toBeGreaterThan(0);
    expect(QUESNIR_CONFIG.fim.rate).toBeLessThanOrEqual(1);
  });

  it("lists the reuse-doc §5 baselines across all three baseline backend kinds", () => {
    const kinds = new Set(QUESNIR_CONFIG.baselines.map((b) => b.kind));
    expect(kinds).toEqual(
      new Set(["api_provider", "remote_inference", "local_inference"]),
    );

    const modelIds = QUESNIR_CONFIG.baselines.map((b) => b.modelId);
    expect(modelIds).toContain("Qwen/Qwen2.5-Coder-7B-Instruct");
    expect(modelIds).toContain("Qwen/Qwen2.5-Coder-32B-Instruct");
    expect(modelIds).toContain("deepseek-ai/DeepSeek-Coder-V2-Lite-Instruct");
  });

  it("enforces selfTrained=false on every baseline (foreign weights)", () => {
    for (const baseline of QUESNIR_CONFIG.baselines) {
      expect(baseline.selfTrained).toBe(false);
    }
  });

  it("sets an upstream license on every baseline", () => {
    for (const baseline of QUESNIR_CONFIG.baselines) {
      expect(["apache-2.0", "deepseek-custom"]).toContain(baseline.license);
    }
    const qwen = QUESNIR_CONFIG.baselines.find((b) =>
      b.modelId.startsWith("Qwen/"),
    );
    const deepseek = QUESNIR_CONFIG.baselines.find((b) =>
      b.modelId.startsWith("deepseek-ai/"),
    );
    expect(qwen?.license).toBe("apache-2.0");
    expect(deepseek?.license).toBe("deepseek-custom");
  });

  it("never stores secrets — apiKeyRef is an env var name", () => {
    const apiBaseline = QUESNIR_CONFIG.baselines.find(
      (b) => b.kind === "api_provider",
    );
    expect(apiBaseline?.apiKeyRef).toMatch(/^[A-Z][A-Z0-9_]*$/);
  });

  it("reserves the native_checkpoint slot without claiming self-trained weights", () => {
    expect(QUESNIR_CONFIG.nativeCheckpoint.kind).toBe("native_checkpoint");
    expect(QUESNIR_CONFIG.nativeCheckpoint.status).toBe("reserved");
    expect(QUESNIR_CONFIG.nativeCheckpoint.selfTrained).toBe(false);
  });
});

describe("validateQuesnirConfig (negative coverage)", () => {
  it("rejects non-objects", () => {
    expect(validateQuesnirConfig(null)).toEqual([
      "quesnir config must be an object",
    ]);
  });

  it("rejects a baseline relabeled as self-trained", () => {
    const tampered = {
      ...QUESNIR_CONFIG,
      baselines: QUESNIR_CONFIG.baselines.map((b, i) =>
        i === 0 ? { ...b, selfTrained: true } : b,
      ),
    };
    const errors = validateQuesnirConfig(tampered);
    expect(errors).toContain(
      "baselines[0].selfTrained must be false — foreign weights are never self-trained",
    );
  });

  it("rejects a missing FIM config and a bad FIM format", () => {
    const withoutFim = { ...QUESNIR_CONFIG, fim: undefined };
    expect(validateQuesnirConfig(withoutFim)).toContain(
      "fim must be an object",
    );

    const badFormat: QuesnirModelConfig = {
      ...QUESNIR_CONFIG,
      fim: { ...QUESNIR_CONFIG.fim, format: "XYZ" as "PSM" },
    };
    expect(validateQuesnirConfig(badFormat)).toContain(
      'fim.format must be "PSM" or "SPM"',
    );
  });

  it("rejects a baseline without a license", () => {
    const tampered = {
      ...QUESNIR_CONFIG,
      baselines: QUESNIR_CONFIG.baselines.map((b, i) =>
        i === 0 ? { ...b, license: "" } : b,
      ),
    };
    const errors = validateQuesnirConfig(tampered);
    expect(errors).toContain(
      "baselines[0].license must be one of: apache-2.0, deepseek-custom",
    );
  });

  it("rejects opening the training gate from config", () => {
    const tampered = { ...QUESNIR_CONFIG, trainingReady: true };
    expect(validateQuesnirConfig(tampered)).toContain(
      "trainingReady must be false (TRAINING_READY=FALSE gate)",
    );
  });

  it("rejects a native-checkpoint slot that claims an existing artifact", () => {
    const tampered = {
      ...QUESNIR_CONFIG,
      nativeCheckpoint: {
        ...QUESNIR_CONFIG.nativeCheckpoint,
        selfTrained: true,
      },
    };
    expect(validateQuesnirConfig(tampered)).toContain(
      "nativeCheckpoint.selfTrained must be false while no AI-Lab-trained checkpoint exists",
    );
  });
});
