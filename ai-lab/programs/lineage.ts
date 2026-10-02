import type { ModelProgram } from "./types";

export interface CheckpointLineage {
  readonly modelId: string;
  readonly checkpointId: null;
  readonly parentId: null;
  readonly datasetVersion: string;
  readonly architectureVersion: string;
  readonly experimentId: string;
  readonly trained: false;
  readonly production: false;
  readonly note: string;
}

export function checkpointLineage(program: ModelProgram): CheckpointLineage {
  return {
    modelId: program.nativeModelId,
    checkpointId: null,
    parentId: null,
    datasetVersion: program.training.datasetVersion,
    architectureVersion: program.training.architectureVersion,
    experimentId: program.training.experimentId,
    trained: false,
    production: false,
    note: "No weights exist. The CPU fixture does not create a checkpoint file.",
  };
}
