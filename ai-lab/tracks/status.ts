import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { restoreCheckpoint } from "../checkpoints/manager";
import { routingDecision, type NativeAvailability } from "../inference/types";
import { labApiKey } from "../inference/unorouter";
import {
  assertTracksDistinct,
  validateTrackDefinition,
  type TrackDefinition,
} from "./definition";

export function loadTrackDefinitions(directory: string): TrackDefinition[] {
  if (!existsSync(directory)) return [];
  const tracks: TrackDefinition[] = [];
  for (const name of readdirSync(directory).sort()) {
    if (!name.endsWith(".json")) continue;
    const parsed: unknown = JSON.parse(
      readFileSync(join(directory, name), "utf8"),
    );
    const errors = validateTrackDefinition(parsed);
    if (errors.length) throw new Error(`${name}: ${errors.join("; ")}`);
    tracks.push(parsed as TrackDefinition);
  }
  if (tracks.length > 1) assertTracksDistinct(tracks);
  return tracks;
}

export function nativeAvailabilityForTrack(
  checkpointDirectory: string,
  trackId: string,
  env: NodeJS.ProcessEnv,
): NativeAvailability {
  const path = join(checkpointDirectory, `${trackId}.validated.json`);
  if (!existsSync(path)) {
    return {
      checkpointPresent: false,
      checkpointValidated: false,
      runtimeOnline: false,
    };
  }
  try {
    const checkpoint = restoreCheckpoint(readFileSync(path), path);
    const validated =
      checkpoint.trackId === trackId &&
      (checkpoint.artifactState === "checkpoint_validated" ||
        checkpoint.artifactState === "holdout_passed");
    const runtimeOnline = validated && env.LAB_NATIVE_RUNTIME_ONLINE === "true";
    return {
      checkpointPresent: true,
      checkpointValidated: validated,
      runtimeOnline,
    };
  } catch {
    return {
      checkpointPresent: true,
      checkpointValidated: false,
      runtimeOnline: false,
    };
  }
}

export interface TrackRoutingView {
  readonly trackId: string;
  readonly displayName: string;
  readonly nativeModelId: string;
  readonly nativeSummary: string;
  readonly routeProvider: "native" | "unorouter";
  readonly routeLabel: string;
  readonly routeModelId: string;
  readonly routeReason: string;
  readonly live: boolean;
  readonly blocked: boolean;
  readonly evaluationState: string;
  readonly fallbackNote: string;
}

export interface LabRoutingSnapshot {
  readonly observedAt: string;
  readonly trainingStarted: false;
  readonly production: false;
  readonly tracks: readonly TrackRoutingView[];
}

export function fallbackModelId(
  track: TrackDefinition,
  env: NodeJS.ProcessEnv,
): string {
  const override = env[track.inferenceConfig.apiFallback.envVar];
  if (typeof override === "string" && override.trim() !== "")
    return override.trim();
  return track.inferenceConfig.apiFallback.defaultModelId;
}

export function routingSnapshot(input: {
  definitionsDir: string;
  checkpointDir: string;
  env: NodeJS.ProcessEnv;
  now?: () => string;
}): LabRoutingSnapshot {
  const keyConfigured = Boolean(labApiKey(input.env));
  const tracks = loadTrackDefinitions(input.definitionsDir).map((track) => {
    const native = nativeAvailabilityForTrack(
      input.checkpointDir,
      track.trackId,
      input.env,
    );
    const decision = routingDecision(native);
    const modelId =
      decision.provider === "native"
        ? track.nativeModelId
        : fallbackModelId(track, input.env);
    const blocked = decision.provider === "unorouter" && !keyConfigured;
    return {
      trackId: track.trackId,
      displayName: track.displayName,
      nativeModelId: track.nativeModelId,
      nativeSummary: native.checkpointValidated
        ? "Validated fixture checkpoint is on disk. It is not a trained product model."
        : "Native model is not trained and no validated checkpoint is online.",
      routeProvider: decision.provider,
      routeLabel:
        decision.provider === "native"
          ? "Native fixture runtime"
          : track.inferenceConfig.apiFallback.label,
      routeModelId: modelId,
      routeReason: decision.reason,
      live: !blocked && (decision.provider === "native" || keyConfigured),
      blocked,
      evaluationState:
        decision.provider === "native" ? "checkpoint_validated" : "unverified",
      fallbackNote: track.inferenceConfig.apiFallback.label,
    };
  });
  return {
    observedAt: (input.now ?? (() => new Date().toISOString()))(),
    trainingStarted: false,
    production: false,
    tracks,
  };
}
