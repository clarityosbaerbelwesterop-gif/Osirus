import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { tokenizerPin } from "../registries/tokenizers";
import {
  validateTrackDefinition,
  type TrackDefinition,
} from "../tracks/definition";
import { fallbackModelId, loadTrackDefinitions } from "../tracks/status";

describe("quesnir track definition", () => {
  it("is a planned coding specialist with a code API fallback that is not Quesnir", () => {
    const tracks = loadTrackDefinitions(
      join(process.cwd(), "ai-lab/tracks/definitions"),
    );
    const found = tracks.find((track) => track.trackId === "quesnir");
    expect(found).toBeTruthy();
    const track = found as TrackDefinition;
    expect(validateTrackDefinition(track)).toEqual([]);
    expect(track.nativeModelId).toBe("osirus/quesnir-1");
    expect(track.architecture).toMatchObject({
      id: "quesnir-decoder-fim-planned-v1",
      layers: 16,
      hiddenSize: 1536,
      attentionHeads: 12,
    });
    expect(track.tokenizer).toMatchObject({
      id: "quesnir-bpe-fim",
      vocabSize: 49152,
    });
    expect(track.tokenizer.pin).toBe(tokenizerPin(track.tokenizer));
    expect(track.datasetMixture.parts[0]?.fraction).toBe(0.8);
    expect(track.curriculum.map((stage) => stage.id)).toEqual([
      "quesnir-fim",
      "quesnir-repo-pack",
      "quesnir-security",
      "quesnir-fixture",
    ]);
    expect(track.evalSuite).toMatchObject({
      id: "quesnir-code-unmeasured",
      measured: false,
    });
    expect(track.trainingConfig.seed).toBe(7101);
    expect(track.inferenceConfig.apiFallback.catalogRole).toBe("code");
    expect(fallbackModelId(track, { NODE_ENV: "test" })).toBe(
      "qwen2.5-coder-32b:free",
    );
    const raw = readFileSync(
      join(process.cwd(), "ai-lab/tracks/definitions/quesnir.json"),
      "utf8",
    );
    expect(raw).toContain("not Quesnir");
  });
});
