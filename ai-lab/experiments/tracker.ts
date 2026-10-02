import type { Experiment } from "../contracts/experiment";
import { ExperimentRegistry } from "../registries/experiments";
import {
  configHash,
  type ReproducibilityRecord,
  reproducibilityRecord,
} from "../repro/record";

/**
 * Records an experiment draft before any fixture step. The registry is
 * append-only, so this tracker does not rewrite status into "completed".
 * A fixture observation is a separate note, not a trained-model result.
 */
export class ExperimentTracker {
  private readonly registry: ExperimentRegistry;
  readonly observations: {
    experimentId: string;
    trainLoss: number;
    artifactState: "checkpoint_created";
  }[] = [];

  constructor(filePath: string) {
    this.registry = new ExperimentRegistry(filePath);
  }

  openDraft(input: {
    id: string;
    hypothesis: string;
    config: unknown;
    datasetIds: readonly string[];
    baselineIds: readonly string[];
    seed: number;
    tokenizerPin: string;
  }): { experiment: Experiment; repro: ReproducibilityRecord } {
    const hash = configHash(input.config);
    const experiment: Experiment = {
      id: input.id,
      hypothesis: input.hypothesis,
      configHash: hash,
      datasetIds: input.datasetIds,
      baselineIds: input.baselineIds,
      status: "draft",
    };
    this.registry.register(experiment);
    return {
      experiment,
      repro: reproducibilityRecord({
        experimentId: input.id,
        seed: input.seed,
        config: input.config,
        datasetIds: input.datasetIds,
        tokenizerPin: input.tokenizerPin,
      }),
    };
  }

  noteFixture(experimentId: string, trainLoss: number): void {
    if (!this.registry.get(experimentId))
      throw new Error(`unknown experiment ${experimentId}`);
    if (!Number.isFinite(trainLoss))
      throw new Error("train loss must be finite");
    this.observations.push({
      experimentId,
      trainLoss,
      artifactState: "checkpoint_created",
    });
  }
}
