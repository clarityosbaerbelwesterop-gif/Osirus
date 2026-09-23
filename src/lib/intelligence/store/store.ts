import type {
  AgendaItem,
  Capability,
  CapabilityGap,
  EvalTask,
  Experience,
  Experiment,
  FoundrySettings,
  GenerationRun,
  LearningArtifact,
  Partition,
  ResearchCycle,
  StrategyStatus,
  StrategyVersion,
  Trial,
} from "../types";

// Where the Intelligence Plane keeps what it knows. Two implementations: the
// Postgres store (osirus_intel, production) and the memory store (tests and
// the GitHub Actions cycle runner, exported as a JSON artifact). The engine
// is written against this interface only.

export type LedgerCategory =
  | "model_calls"
  | "tokens"
  | "cost_usd"
  | "sandbox_minutes"
  | "chained_ticks"
  | "trials";

export type DatasetExample = {
  partition: Exclude<Partition, "fresh">;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  experienceId: string | null;
  fingerprint: string;
};

export type DatasetVersionSummary = {
  id: string;
  datasetId: string;
  version: number;
  counts: Record<string, number>;
  provenance: Record<string, unknown>;
  contamination: Record<string, unknown>;
  createdAt: string;
};

export type ModelRecord = {
  id: string;
  provider: string;
  modelId: string;
  family: string | null;
  modalities: string[];
  contextTokens: number | null;
  free: boolean;
  status: "listed" | "candidate" | "available" | "unavailable" | "retired";
};

export type ModelStat = {
  modelId: string;
  capabilityId: string;
  trials: number;
  verified: number;
  meanLatencyMs: number | null;
  meanCostUsd: number | null;
  champion: boolean;
};

export type PromotionEvent = {
  strategyVersionId: string;
  fromStatus: StrategyStatus;
  toStatus: StrategyStatus;
  canaryPercent: number | null;
  evidence: Record<string, unknown>;
  createdAt?: string;
};

export interface IntelStore {
  settings(): Promise<FoundrySettings>;
  saveSettings(settings: FoundrySettings): Promise<void>;

  addUsage(
    category: LedgerCategory,
    amount: number,
    day?: string,
  ): Promise<void>;
  usage(day?: string): Promise<Record<LedgerCategory, number>>;

  listCapabilities(): Promise<Capability[]>;
  upsertCapability(capability: Capability): Promise<void>;
  dependencies(): Promise<Array<{ capabilityId: string; dependsOn: string }>>;
  addDependency(capabilityId: string, dependsOn: string): Promise<void>;

  upsertGap(gap: Omit<CapabilityGap, "id">): Promise<CapabilityGap>;
  listGaps(capabilityId?: string): Promise<CapabilityGap[]>;

  /** Inserts tasks whose fingerprint is new; returns all stored matches. */
  insertTasks(tasks: Array<Omit<EvalTask, "id">>): Promise<EvalTask[]>;
  listTasks(filter: {
    capabilityId?: string;
    partition?: Partition;
    limit?: number;
  }): Promise<EvalTask[]>;
  getTask(id: string): Promise<EvalTask | null>;
  updateTaskLabel(
    id: string,
    verified: boolean,
    evidence: Record<string, unknown>,
  ): Promise<void>;

  ensureStrategy(
    id: string,
    kind: StrategyVersion["kind"],
    description: string,
  ): Promise<void>;
  insertVersion(
    version: Omit<StrategyVersion, "id" | "version"> & { version?: number },
  ): Promise<StrategyVersion>;
  updateVersion(
    id: string,
    patch: Partial<
      Pick<StrategyVersion, "status" | "canaryPercent" | "metrics" | "model">
    >,
  ): Promise<void>;
  getVersion(id: string): Promise<StrategyVersion | null>;
  listVersions(strategyId?: string): Promise<StrategyVersion[]>;

  insertExperiment(experiment: Omit<Experiment, "id">): Promise<Experiment>;
  updateExperiment(
    id: string,
    patch: Partial<
      Pick<
        Experiment,
        "status" | "conclusion" | "challengerVersionIds" | "hypotheses"
      >
    >,
  ): Promise<void>;
  getExperiment(id: string): Promise<Experiment | null>;
  listExperiments(limit?: number): Promise<Experiment[]>;

  insertTrials(
    trials: Array<
      Omit<Trial, "id" | "status" | "runId" | "attempts" | "result">
    >,
  ): Promise<void>;
  listTrials(experimentId: string): Promise<Trial[]>;
  /** Lease up to `limit` pending trials of an experiment. */
  claimTrials(
    experimentId: string,
    limit: number,
    owner: string,
    leaseSeconds: number,
    partitions?: Partition[],
  ): Promise<Trial[]>;
  updateTrial(
    id: string,
    patch: Partial<Pick<Trial, "status" | "runId" | "attempts" | "result">> & {
      experienceId?: string | null;
    },
  ): Promise<void>;
  /** Trials whose durable run is still in flight. */
  runningTrials(limit: number): Promise<Trial[]>;

  upsertAgendaItem(item: Omit<AgendaItem, "id">): Promise<AgendaItem>;
  listAgenda(): Promise<AgendaItem[]>;
  updateAgendaItem(
    id: string,
    patch: Partial<
      Pick<AgendaItem, "status" | "score" | "components" | "rationale">
    >,
  ): Promise<void>;

  insertCycle(
    cycle: Omit<ResearchCycle, "id" | "startedAt" | "completedAt">,
  ): Promise<ResearchCycle>;
  updateCycle(
    id: string,
    patch: Partial<
      Pick<
        ResearchCycle,
        | "status"
        | "phase"
        | "agendaItemId"
        | "capabilityId"
        | "state"
        | "summary"
      >
    > & {
      completed?: boolean;
    },
  ): Promise<void>;
  /** The running cycle, leased to `owner` so two ticks never step it at once. */
  leaseActiveCycle(
    owner: string,
    leaseSeconds: number,
  ): Promise<ResearchCycle | null>;
  releaseCycle(id: string, owner: string): Promise<void>;
  listCycles(limit?: number): Promise<ResearchCycle[]>;

  insertPromotion(event: PromotionEvent): Promise<void>;
  listPromotions(limit?: number): Promise<PromotionEvent[]>;

  insertExperience(
    experience: Omit<Experience, "id" | "createdAt">,
  ): Promise<Experience>;
  listExperience(filter: {
    capabilityId?: string;
    source?: Experience["source"];
    outcome?: Experience["outcome"];
    strategyVersionId?: string;
    since?: string;
    limit?: number;
  }): Promise<Experience[]>;
  experienceFingerprintExists(fingerprint: string): Promise<boolean>;

  upsertArtifact(
    artifact: Omit<LearningArtifact, "id">,
  ): Promise<LearningArtifact>;
  listArtifacts(filter: {
    kind?: LearningArtifact["kind"];
    capabilityId?: string;
    status?: LearningArtifact["status"];
    limit?: number;
  }): Promise<LearningArtifact[]>;

  insertGenerationRun(run: Omit<GenerationRun, "id">): Promise<GenerationRun>;
  listGenerationRuns(limit?: number): Promise<GenerationRun[]>;

  ensureDataset(id: string, format: string, description: string): Promise<void>;
  insertDatasetVersion(input: {
    datasetId: string;
    counts: Record<string, number>;
    provenance: Record<string, unknown>;
    contamination: Record<string, unknown>;
    examples: DatasetExample[];
  }): Promise<DatasetVersionSummary>;
  listDatasetVersions(limit?: number): Promise<DatasetVersionSummary[]>;
  datasetFingerprints(
    partition: DatasetExample["partition"],
  ): Promise<Set<string>>;

  upsertModel(model: ModelRecord): Promise<void>;
  listModels(): Promise<ModelRecord[]>;
  upsertModelStat(stat: ModelStat): Promise<void>;
  listModelStats(): Promise<ModelStat[]>;
}

export function today(now = new Date()) {
  return now.toISOString().slice(0, 10);
}
