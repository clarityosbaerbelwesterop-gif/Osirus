import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { tokenizerPin } from "../registries/tokenizers";
import {
  validateTrackDefinition,
  type TrackDefinition,
} from "../tracks/definition";
import { fallbackModelId, loadTrackDefinitions } from "../tracks/status";

describe("rouge track definition", () => {
  it("is a planned general model with a verified API fallback that is not Rouge", () => {
    const tracks = loadTrackDefinitions(
      join(process.cwd(), "ai-lab/tracks/definitions"),
    );
    const rouge = tracks.find((track) => track.trackId === "rouge");
    expect(rouge).toBeTruthy();
    const track = rouge as TrackDefinition;
    expect(validateTrackDefinition(track)).toEqual([]);
    expect(track.nativeModelId).toBe("osirus/rouge-1");
    expect(track.architecture).toMatchObject({
      layers: 24,
      hiddenSize: 2048,
      attentionHeads: 16,
    });
    expect(track.tokenizer.vocabSize).toBe(32000);
    expect(track.tokenizer.pin).toBe(tokenizerPin(track.tokenizer));
    expect(track.datasetMixture.id).toBe("rouge-mix-planned-v1");
    expect(track.evalSuite).toMatchObject({
      id: "rouge-core-unmeasured",
      measured: false,
    });
    expect(track.trainingConfig.seed).toBe(5601);
    expect(track.inferenceConfig.apiFallback.defaultModelId).toBe("qwen3:free");
    expect(track.inferenceConfig.apiFallback.defaultModelId).not.toBe(
      track.nativeModelId,
    );
    expect(fallbackModelId(track, { NODE_ENV: "test" })).toBe("qwen3:free");
    expect(
      fallbackModelId(track, {
        NODE_ENV: "test",
        LAB_FALLBACK_MODEL_ROUGE: "override:free",
      }),
    ).toBe("override:free");
    const raw = readFileSync(
      join(process.cwd(), "ai-lab/tracks/definitions/rouge.json"),
      "utf8",
    );
    expect(raw).not.toContain('selfTrained": true');
    expect(raw).toContain("not Rouge");
  });
});
