// The Model Foundry's training interface.
//
// Real model training (SFT, LoRA, distillation, preference, RL) needs a
// provider that actually trains. None is configured, and by operator
// decision no model is tuned in this phase: the Foundry improves the agent
// (strategies, skills, prompts, routing) instead. The interface is complete
// so a provider can be added without touching the loop; until then the only
// implementation says plainly that training is unavailable, and nothing
// anywhere records a training run that did not happen.

export type TrainingJobType =
  | "sft"
  | "fine_tune"
  | "lora"
  | "qlora"
  | "distillation"
  | "preference"
  | "rl"
  | "verifier";

export type TrainingCapabilities = {
  available: boolean;
  reason: string | null;
  jobTypes: TrainingJobType[];
  baseModels: string[];
};

export type TrainingJob = {
  id: string;
  type: TrainingJobType;
  baseModel: string;
  datasetVersionId: string;
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
};

export type DistillationJob = TrainingJob & {
  type: "distillation";
  teacher: { model: string; strategyVersionId: string };
};

export type PreferenceJob = TrainingJob & { type: "preference" };
export type RLJob = TrainingJob & { type: "rl"; rewardModel: string };

export type EvaluationBundle = {
  candidateId: string;
  suites: string[];
  partitions: Array<"dev" | "holdout" | "adversarial">;
};

export interface TrainingProvider {
  readonly id: string;
  capabilities(): Promise<TrainingCapabilities>;
  prepareDataset(datasetVersionId: string): Promise<{ uploadedId: string }>;
  train(input: {
    type: TrainingJobType;
    baseModel: string;
    datasetVersionId: string;
    config?: Record<string, unknown>;
  }): Promise<TrainingJob>;
  resume(jobId: string): Promise<TrainingJob>;
  cancel(jobId: string): Promise<void>;
  status(jobId: string): Promise<TrainingJob>;
  artifacts(jobId: string): Promise<Record<string, unknown>>;
  evaluate(bundle: EvaluationBundle): Promise<Record<string, unknown>>;
  publishCandidate(jobId: string): Promise<{ modelCandidateId: string }>;
}

const UNAVAILABLE =
  "No training provider is configured, and model tuning is off by operator decision; the Foundry improves strategies, skills, prompts and routing instead.";

export class NoTrainingProvider implements TrainingProvider {
  readonly id = "none";
  async capabilities(): Promise<TrainingCapabilities> {
    return {
      available: false,
      reason: UNAVAILABLE,
      jobTypes: [],
      baseModels: [],
    };
  }
  private refuse(): never {
    throw new Error(`training_unavailable: ${UNAVAILABLE}`);
  }
  async prepareDataset(): Promise<{ uploadedId: string }> {
    return this.refuse();
  }
  async train(): Promise<TrainingJob> {
    return this.refuse();
  }
  async resume(): Promise<TrainingJob> {
    return this.refuse();
  }
  async cancel(): Promise<void> {
    return this.refuse();
  }
  async status(): Promise<TrainingJob> {
    return this.refuse();
  }
  async artifacts(): Promise<Record<string, unknown>> {
    return this.refuse();
  }
  async evaluate(): Promise<Record<string, unknown>> {
    return this.refuse();
  }
  async publishCandidate(): Promise<{ modelCandidateId: string }> {
    return this.refuse();
  }
}

export function trainingProvider(): TrainingProvider {
  return new NoTrainingProvider();
}
