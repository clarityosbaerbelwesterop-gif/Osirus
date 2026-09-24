import type {
  IntelStore,
  ModelCandidateRecord,
  ModelCandidateStatus,
  TrainingRunRecord,
  TrainingRunStatus,
} from "../store/store";

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

/**
 * A candidate is trained only when the training run that produced it
 * succeeded. The candidate table has no "trained" status; this is the check.
 */
export function candidateTrained(
  run: { status: TrainingRunStatus } | null | undefined,
) {
  return run?.status === "succeeded";
}

export function candidateTransitionProblems(input: {
  from: ModelCandidateStatus;
  to: ModelCandidateStatus;
  trainingStatus: TrainingRunStatus | null;
  evaluation: Record<string, unknown>;
  /** Inserts stay at `candidate` and still require a succeeded run. */
  inserting?: boolean;
}): string[] {
  const problems: string[] = [];
  const needsTraining =
    input.inserting || input.to === "evaluating" || input.to === "champion";
  if (needsTraining && input.trainingStatus !== "succeeded")
    problems.push("training_not_succeeded");
  if (!input.inserting && input.from !== input.to) {
    const allowed: Record<ModelCandidateStatus, ModelCandidateStatus[]> = {
      candidate: ["evaluating", "rejected"],
      evaluating: ["champion", "rejected"],
      champion: ["rejected"],
      rejected: [],
    };
    if (!allowed[input.from].includes(input.to))
      problems.push("illegal_transition");
  }
  if (input.to === "champion" && input.evaluation.verdict !== "pass")
    problems.push("evaluation_required");
  return problems;
}

export function assertCandidateTransition(
  input: Parameters<typeof candidateTransitionProblems>[0],
) {
  const problems = candidateTransitionProblems(input);
  if (problems.length)
    throw new Error(`candidate_transition:${problems.join(",")}`);
}

/**
 * Ask the configured provider to train, and record only what it did.
 * An unavailable provider writes a failed run and no candidate. A candidate
 * row is inserted only after status `succeeded`, and it starts at `candidate`.
 */
export async function attemptTraining(input: {
  store: IntelStore;
  provider: TrainingProvider;
  type: TrainingJobType;
  baseModel: string;
  datasetVersionId: string | null;
}): Promise<{
  run: TrainingRunRecord;
  candidate: ModelCandidateRecord | null;
  trained: boolean;
  summary: string;
}> {
  const capabilities = await input.provider.capabilities();
  if (!capabilities.available) {
    const run = await input.store.insertTrainingRun({
      provider: input.provider.id,
      jobType: input.type,
      baseModel: input.baseModel,
      datasetVersionId: input.datasetVersionId,
      status: "failed",
      config: { reason: capabilities.reason },
      artifacts: {},
    });
    return {
      run,
      candidate: null,
      trained: false,
      summary: capabilities.reason ?? "training_unavailable",
    };
  }
  const queued = await input.store.insertTrainingRun({
    provider: input.provider.id,
    jobType: input.type,
    baseModel: input.baseModel,
    datasetVersionId: input.datasetVersionId,
    status: "queued",
    config: {},
    artifacts: {},
  });
  try {
    const job = await input.provider.train({
      type: input.type,
      baseModel: input.baseModel,
      datasetVersionId: input.datasetVersionId ?? "",
    });
    await input.store.updateTrainingRun(queued.id, {
      status: job.status,
      config: { providerJobId: job.id },
    });
    const run = (await input.store.getTrainingRun(queued.id)) ?? queued;
    if (!candidateTrained(run)) {
      return {
        run,
        candidate: null,
        trained: false,
        summary: `training ${run.status}`,
      };
    }
    const candidate = await input.store.insertModelCandidate({
      baseModel: input.baseModel,
      trainingRunId: run.id,
      lineage: {
        provider: input.provider.id,
        jobType: input.type,
        jobId: job.id,
      },
    });
    return {
      run,
      candidate,
      trained: true,
      summary: `candidate ${candidate.id} from succeeded run ${run.id}`,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "training_failed";
    await input.store.updateTrainingRun(queued.id, {
      status: "failed",
      config: { error: message },
    });
    const run = (await input.store.getTrainingRun(queued.id)) ?? {
      ...queued,
      status: "failed" as const,
    };
    return { run, candidate: null, trained: false, summary: message };
  }
}
