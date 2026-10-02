/**
 * AI Lab — Quasnir scaffold config tests (Phase I, branch quasnir/scaffold).
 *
 * Verifies the Quasnir model config: planned architecture values, FIM config,
 * the § 5 baseline fallbacks with licenses and structurally false
 * `selfTrained`, the reserved native-checkpoint slot, and the
 * TRAINING_READY=FALSE gate. Picked up by the root vitest gate via
 * `ai-lab/tests/**` in vitest.config.ts.
 */

import { describe, expect, it } from "vitest";

import {
  QUASNIR_CONFIG,
  validateQuasnirConfig,
  type QuasnirModelConfig,
} from "../models/quasnir/model.config";

describe("QUASNIR_CONFIG", () => {
  it("validates clean against the pure validator", () => {
    expect(validateQuasnirConfig(QUASNIR_CONFIG)).toEqual([]);
  });

  it("is an untrained coding+security scaffold with the training gate closed", () => {
    expect(QUASNIR_CONFIG.role).toBe("coding+security");
    expect(QUASNIR_CONFIG.status).toBe("scaffold-untrained");
    expect(QUASNIR_CONFIG.trainingReady).toBe(false);
  });

  it("records FIM support with a valid format and rate", () => {
    expect(QUASNIR_CONFIG.fim.enabled).toBe(true);
    expect(["PSM", "SPM"]).toContain(QUASNIR_CONFIG.fim.format);
    expect(QUASNIR_CONFIG.fim.rate).toBeGreaterThan(0);
    expect(QUASNIR_CONFIG.fim.rate).toBeLessThanOrEqual(1);
  });

  it("lists the reuse-doc §5 baselines across all three baseline backend kinds", () => {
    const kinds = new Set(QUASNIR_CONFIG.baselines.map((b) => b.kind));
    expect(kinds).toEqual(
      new Set(["api_provider", "remote_inference", "local_inference"]),
    );

    const modelIds = QUASNIR_CONFIG.baselines.map((b) => b.modelId);
    expect(modelIds).toContain("Qwen/Qwen2.5-Coder-7B-Instruct");
    expect(modelIds).toContain("Qwen/Qwen2.5-Coder-32B-Instruct");
    expect(modelIds).toContain("deepseek-ai/DeepSeek-Coder-V2-Lite-Instruct");
  });

  it("enforces selfTrained=false on every baseline (foreign weights)", () => {
    for (const baseline of QUASNIR_CONFIG.baselines) {
      expect(baseline.selfTrained).toBe(false);
    }
  });

  it("sets an upstream license on every baseline", () => {
    for (const baseline of QUASNIR_CONFIG.baselines) {
      expect(["apache-2.0", "deepseek-custom"]).toContain(baseline.license);
    }
    const qwen = QUASNIR_CONFIG.baselines.find((b) =>
      b.modelId.startsWith("Qwen/"),
    );
    const deepseek = QUASNIR_CONFIG.baselines.find((b) =>
      b.modelId.startsWith("deepseek-ai/"),
    );
    expect(qwen?.license).toBe("apache-2.0");
    expect(deepseek?.license).toBe("deepseek-custom");
  });

  it("never stores secrets — apiKeyRef is an env var name", () => {
    const apiBaseline = QUASNIR_CONFIG.baselines.find(
      (b) => b.kind === "api_provider",
    );
    expect(apiBaseline?.apiKeyRef).toMatch(/^[A-Z][A-Z0-9_]*$/);
  });

  it("reserves the native_checkpoint slot without claiming self-trained weights", () => {
    expect(QUASNIR_CONFIG.nativeCheckpoint.kind).toBe("native_checkpoint");
    expect(QUASNIR_CONFIG.nativeCheckpoint.status).toBe("reserved");
    expect(QUASNIR_CONFIG.nativeCheckpoint.selfTrained).toBe(false);
  });
});

describe("validateQuasnirConfig (negative coverage)", () => {
  it("rejects non-objects", () => {
    expect(validateQuasnirConfig(null)).toEqual([
      "quasnir config must be an object",
    ]);
  });

  it("rejects a baseline relabeled as self-trained", () => {
    const tampered = {
      ...QUASNIR_CONFIG,
      baselines: QUASNIR_CONFIG.baselines.map((b, i) =>
        i === 0 ? { ...b, selfTrained: true } : b,
      ),
    };
    const errors = validateQuasnirConfig(tampered);
    expect(errors).toContain(
      "baselines[0].selfTrained must be false — foreign weights are never self-trained",
    );
  });

  it("rejects a missing FIM config and a bad FIM format", () => {
    const withoutFim = { ...QUASNIR_CONFIG, fim: undefined };
    expect(validateQuasnirConfig(withoutFim)).toContain(
      "fim must be an object",
    );

    const badFormat: QuasnirModelConfig = {
      ...QUASNIR_CONFIG,
      fim: { ...QUASNIR_CONFIG.fim, format: "XYZ" as "PSM" },
    };
    expect(validateQuasnirConfig(badFormat)).toContain(
      'fim.format must be "PSM" or "SPM"',
    );
  });

  it("rejects a baseline without a license", () => {
    const tampered = {
      ...QUASNIR_CONFIG,
      baselines: QUASNIR_CONFIG.baselines.map((b, i) =>
        i === 0 ? { ...b, license: "" } : b,
      ),
    };
    const errors = validateQuasnirConfig(tampered);
    expect(errors).toContain(
      "baselines[0].license must be one of: apache-2.0, deepseek-custom",
    );
  });

  it("rejects opening the training gate from config", () => {
    const tampered = { ...QUASNIR_CONFIG, trainingReady: true };
    expect(validateQuasnirConfig(tampered)).toContain(
      "trainingReady must be false (TRAINING_READY=FALSE gate)",
    );
  });

  it("rejects a native-checkpoint slot that claims an existing artifact", () => {
    const tampered = {
      ...QUASNIR_CONFIG,
      nativeCheckpoint: {
        ...QUASNIR_CONFIG.nativeCheckpoint,
        selfTrained: true,
      },
    };
    expect(validateQuasnirConfig(tampered)).toContain(
      "nativeCheckpoint.selfTrained must be false while no AI-Lab-trained checkpoint exists",
    );
  });
});
