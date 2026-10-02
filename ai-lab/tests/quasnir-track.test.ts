import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { tokenizerPin } from "../registries/tokenizers";
import {
  validateTrackDefinition,
  type TrackDefinition,
} from "../tracks/definition";
import { fallbackModelId, loadTrackDefinitions } from "../tracks/status";

describe("quasnir track definition", () => {
  it("is a planned coding specialist with a code API fallback that is not Quasnir", () => {
    const tracks = loadTrackDefinitions(
      join(process.cwd(), "ai-lab/tracks/definitions"),
    );
    const found = tracks.find((track) => track.trackId === "quasnir");
    expect(found).toBeTruthy();
    const track = found as TrackDefinition;
    expect(validateTrackDefinition(track)).toEqual([]);
    expect(track.nativeModelId).toBe("osirus/quasnir-1");
    expect(track.architecture).toMatchObject({
      id: "quasnir-decoder-fim-planned-v1",
      layers: 16,
      hiddenSize: 1536,
      attentionHeads: 12,
    });
    expect(track.tokenizer).toMatchObject({
      id: "quasnir-bpe-fim",
      vocabSize: 49152,
    });
    expect(track.tokenizer.pin).toBe(tokenizerPin(track.tokenizer));
    expect(track.datasetMixture.parts[0]?.fraction).toBe(0.8);
    expect(track.curriculum.map((stage) => stage.id)).toEqual([
      "quasnir-fim",
      "quasnir-repo-pack",
      "quasnir-security",
      "quasnir-fixture",
    ]);
    expect(track.evalSuite).toMatchObject({
      id: "quasnir-code-unmeasured",
      measured: false,
    });
    expect(track.trainingConfig.seed).toBe(7101);
    expect(track.inferenceConfig.apiFallback.catalogRole).toBe("code");
    expect(fallbackModelId(track, { NODE_ENV: "test" })).toBe(
      "qwen2.5-coder-32b:free",
    );
    const raw = readFileSync(
      join(process.cwd(), "ai-lab/tracks/definitions/quasnir.json"),
      "utf8",
    );
    expect(raw).toContain("not Quasnir");
  });
});
