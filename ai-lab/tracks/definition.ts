import {
  validateCurriculum,
  type CurriculumStage,
} from "../curriculum/curriculum";
import { tokenizerPin, type TokenizerPinInput } from "../registries/tokenizers";

export interface TrackDefinition {
  readonly trackId: string;
  readonly displayName: string;
  readonly identity: string;
  readonly nativeModelId: string;
  readonly architecture: {
    readonly id: string;
    readonly family: string;
    readonly layers: number;
    readonly hiddenSize: number;
    readonly attentionHeads: number;
    readonly kvHeads: number;
    readonly activation: string;
    readonly norm: string;
    readonly positional: string;
    readonly status: "planned";
  };
  readonly tokenizer: TokenizerPinInput & { readonly pin: string };
  readonly datasetMixture: {
    readonly id: string;
    readonly parts: readonly {
      readonly source: string;
      readonly fraction: number;
      readonly license: string;
    }[];
  };
  readonly curriculum: readonly CurriculumStage[];
  readonly behaviorSpec: string;
  readonly specialistObjectives: readonly string[];
  readonly evalSuite: {
    readonly id: string;
    readonly measured: false;
    readonly tasks: readonly string[];
  };
  readonly trainingConfig: {
    readonly executableFixture: "tiny-linear-v1";
    readonly plannedParameterClass: string;
    readonly seed: number;
  };
  readonly inferenceConfig: {
    readonly nativeRuntime: "not_shipped";
    readonly apiFallback: {
      readonly label: string;
      readonly defaultModelId: string;
      readonly envVar: string;
      readonly catalogRole: "general" | "code" | "research";
      readonly verifiedFrom: string;
      readonly verifiedOn: string;
    };
  };
  readonly capabilityTargets: readonly {
    readonly id: string;
    readonly status: "unmeasured";
  }[];
}

export function validateTrackDefinition(value: unknown): string[] {
  if (!value || typeof value !== "object")
    return ["track definition must be an object"];
  const track = value as TrackDefinition;
  const errors: string[] = [];
  for (const key of [
    "trackId",
    "displayName",
    "identity",
    "nativeModelId",
    "behaviorSpec",
  ] as const) {
    if (typeof track[key] !== "string" || track[key].trim() === "")
      errors.push(`${key} is required`);
  }
  const arch = track.architecture;
  if (!arch || arch.status !== "planned" || !arch.id || !arch.family)
    errors.push("architecture must be a planned record");
  if (!track.tokenizer) errors.push("tokenizer is required");
  else if (track.tokenizer.pin !== tokenizerPin(track.tokenizer))
    errors.push("tokenizer pin mismatch");
  const parts = track.datasetMixture?.parts ?? [];
  const fraction = parts.reduce((sum, part) => sum + part.fraction, 0);
  if (Math.abs(fraction - 1) > 1e-6)
    errors.push("dataset mixture fractions must sum to 1");
  errors.push(...validateCurriculum(track.curriculum ?? []));
  if (!track.evalSuite || track.evalSuite.measured !== false) {
    errors.push("eval suite must set measured:false until a real run exists");
  }
  if (track.trainingConfig?.executableFixture !== "tiny-linear-v1") {
    errors.push("training config may only name the tiny CPU fixture");
  }
  const fallback = track.inferenceConfig?.apiFallback;
  if (
    !fallback?.defaultModelId ||
    !fallback.label?.toLowerCase().includes("not")
  ) {
    errors.push("api fallback label must say it is not the native model");
  }
  if (track.inferenceConfig?.nativeRuntime !== "not_shipped") {
    errors.push("native runtime is not shipped");
  }
  if (
    !track.capabilityTargets?.every((target) => target.status === "unmeasured")
  ) {
    errors.push("capability targets are unmeasured");
  }
  if (fallback && track.nativeModelId === fallback.defaultModelId) {
    errors.push("fallback model id must not be the native model id");
  }
  return errors;
}

export function assertTracksDistinct(tracks: readonly TrackDefinition[]): void {
  const fields = [
    tracks.map((track) => track.trackId),
    tracks.map((track) => track.nativeModelId),
    tracks.map((track) => track.architecture.id),
    tracks.map((track) => track.tokenizer.id),
    tracks.map((track) => track.datasetMixture.id),
    tracks.map((track) => track.evalSuite.id),
    tracks.map((track) => track.inferenceConfig.apiFallback.defaultModelId),
  ];
  for (const values of fields) {
    if (new Set(values).size !== values.length) {
      throw new Error(
        `track definitions are not distinct: ${values.join(", ")}`,
      );
    }
  }
}
