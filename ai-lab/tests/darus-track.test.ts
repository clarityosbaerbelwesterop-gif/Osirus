import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { tokenizerPin } from "../registries/tokenizers";
import {
  validateTrackDefinition,
  type TrackDefinition,
} from "../tracks/definition";
import { fallbackModelId, loadTrackDefinitions } from "../tracks/status";

describe("darus track definition", () => {
  it("is a planned broad expert with a research API fallback that is not Darus", () => {
    const tracks = loadTrackDefinitions(
      join(process.cwd(), "ai-lab/tracks/definitions"),
    );
    const found = tracks.find((track) => track.trackId === "darus");
    expect(found).toBeTruthy();
    const track = found as TrackDefinition;
    expect(validateTrackDefinition(track)).toEqual([]);
    expect(track.nativeModelId).toBe("osirus/darus-1");
    expect(track.architecture).toMatchObject({
      id: "darus-dense-decoder-planned-v1",
      layers: 32,
      hiddenSize: 2560,
      attentionHeads: 20,
      kvHeads: 5,
    });
    expect(track.tokenizer.vocabSize).toBe(64000);
    expect(track.tokenizer.pin).toBe(tokenizerPin(track.tokenizer));
    expect(track.datasetMixture.parts.map((part) => part.fraction)).toEqual([
      0.4, 0.25, 0.2, 0.15,
    ]);
    expect(
      track.curriculum.some((stage) => stage.id === "darus-distill-prep"),
    ).toBe(true);
    expect(track.evalSuite).toMatchObject({
      id: "darus-breadth-unmeasured",
      measured: false,
    });
    expect(track.trainingConfig.seed).toBe(8301);
    expect(track.inferenceConfig.apiFallback.catalogRole).toBe("research");
    expect(fallbackModelId(track, { NODE_ENV: "test" })).toBe(
      "gemini-3.6-flash:free",
    );
    const raw = readFileSync(
      join(process.cwd(), "ai-lab/tracks/definitions/darus.json"),
      "utf8",
    );
    expect(raw).toContain("not Darus");
    expect(raw).not.toContain("qwen3:free");
    expect(raw).not.toContain("qwen2.5-coder-32b:free");
  });
});
