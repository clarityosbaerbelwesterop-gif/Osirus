import { randomUUID } from "node:crypto";
import {
  DEFAULT_SETTINGS,
  type AgendaItem,
  type Capability,
  type CapabilityGap,
  type EvalTask,
  type Experience,
  type Experiment,
  type FoundrySettings,
  type GenerationRun,
  type LearningArtifact,
  type ResearchCycle,
  type StrategyVersion,
  type Trial,
} from "../types";
import { holdoutSignal, type ExampleSignal } from "../datasets/verify";
import { assertCandidateTransition } from "../models/training";
import {
  today,
  type DatasetExample,
  type DatasetVersionSummary,
  type IntelStore,
  type LedgerCategory,
  type ModelCandidateRecord,
  type ModelRecord,
  type ModelStat,
  type PromotionEvent,
  type TrainingRunRecord,
} from "./store";

// In-memory IntelStore. Used by the unit tests and by the GitHub Actions
// cycle runner, which has no database by design; `snapshot()` is what the
// runner uploads as its evidence artifact.

const clone = <T>(value: T): T => structuredClone(value);

/** A copy without the in-memory lease bookkeeping. */
function unleased<T extends { lease?: unknown }>(value: T): Omit<T, "lease"> {
  const copy = clone(value);
  delete copy.lease;
  return copy;
}

export class MemoryIntelStore implements IntelStore {
  private state = {
    settings: clone(DEFAULT_SETTINGS) as FoundrySettings,
    ledger: new Map<string, number>(),
    capabilities: new Map<string, Capability>(),
    dependencies: [] as Array<{ capabilityId: string; dependsOn: string }>,
    gaps: new Map<string, CapabilityGap>(),
    tasks: new Map<string, EvalTask>(),
    strategies: new Map<
      string,
      { kind: StrategyVersion["kind"]; description: string }
    >(),
    versions: new Map<string, StrategyVersion>(),
    experiments: new Map<string, Experiment>(),
    trials: new Map<
      string,
      Trial & { lease?: { owner: string; until: number } }
    >(),
    agenda: new Map<string, AgendaItem>(),
    cycles: new Map<
      string,
      ResearchCycle & { lease?: { owner: string; until: number } }
    >(),
    promotions: [] as PromotionEvent[],
    experience: [] as Experience[],
    artifacts: new Map<string, LearningArtifact>(),
    generation: [] as GenerationRun[],
    datasets: new Map<string, { format: string; description: string }>(),
    datasetVersions: [] as Array<
      DatasetVersionSummary & { examples: DatasetExample[] }
    >,
    models: new Map<string, ModelRecord>(),
    modelStats: new Map<string, ModelStat>(),
    trainingRuns: new Map<string, TrainingRunRecord>(),
    candidates: new Map<string, ModelCandidateRecord>(),
  };

  async settings() {
    return clone(this.state.settings);
  }
  async saveSettings(settings: FoundrySettings) {
    this.state.settings = clone(settings);
  }

  async addUsage(category: LedgerCategory, amount: number, day = today()) {
    const key = `${day}:${category}`;
    this.state.ledger.set(key, (this.state.ledger.get(key) ?? 0) + amount);
  }
  async usage(day = today()) {
    const out = {
      model_calls: 0,
      tokens: 0,
      cost_usd: 0,
      sandbox_minutes: 0,
      chained_ticks: 0,
      trials: 0,
    } as Record<LedgerCategory, number>;
    for (const category of Object.keys(out) as LedgerCategory[])
      out[category] = this.state.ledger.get(`${day}:${category}`) ?? 0;
    return out;
  }

  async listCapabilities() {
    return [...this.state.capabilities.values()].map(clone);
  }
  async upsertCapability(capability: Capability) {
    this.state.capabilities.set(capability.id, clone(capability));
  }
  async dependencies() {
    return clone(this.state.dependencies);
  }
  async addDependency(capabilityId: string, dependsOn: string) {
    if (
      !this.state.dependencies.some(
        (edge) =>
          edge.capabilityId === capabilityId && edge.dependsOn === dependsOn,
      )
    )
      this.state.dependencies.push({ capabilityId, dependsOn });
  }

  async upsertGap(gap: Omit<CapabilityGap, "id">) {
    const existing = [...this.state.gaps.values()].find(
      (entry) =>
        entry.capabilityId === gap.capabilityId &&
        entry.kind === gap.kind &&
        entry.summary === gap.summary,
    );
    const stored: CapabilityGap = existing
      ? {
          ...existing,
          support: existing.support + gap.support,
          evidence: { ...existing.evidence, ...gap.evidence },
          status:
            existing.status === "addressed" ? existing.status : gap.status,
        }
      : { ...clone(gap), id: randomUUID() };
    this.state.gaps.set(stored.id, stored);
    return clone(stored);
  }
  async listGaps(capabilityId?: string) {
    return [...this.state.gaps.values()]
      .filter((gap) => !capabilityId || gap.capabilityId === capabilityId)
      .map(clone);
  }

  async insertTasks(tasks: Array<Omit<EvalTask, "id">>) {
    const out: EvalTask[] = [];
    for (const task of tasks) {
      const existing = [...this.state.tasks.values()].find(
        (entry) => entry.fingerprint === task.fingerprint,
      );
      if (existing) {
        out.push(clone(existing));
        continue;
      }
      const stored = { ...clone(task), id: randomUUID() };
      this.state.tasks.set(stored.id, stored);
      out.push(clone(stored));
    }
    return out;
  }
  async listTasks(filter: {
    capabilityId?: string;
    partition?: EvalTask["partition"];
    limit?: number;
  }) {
    return [...this.state.tasks.values()]
      .filter(
        (task) =>
          (!filter.capabilityId || task.capabilityId === filter.capabilityId) &&
          (!filter.partition || task.partition === filter.partition),
      )
      .slice(0, filter.limit ?? 1000)
      .map(clone);
  }
  async getTask(id: string) {
    const task = this.state.tasks.get(id);
    return task ? clone(task) : null;
  }
  async updateTaskLabel(
    id: string,
    verified: boolean,
    evidence: Record<string, unknown>,
  ) {
    const task = this.state.tasks.get(id);
    if (task) {
      task.labelVerified = verified;
      task.labelEvidence = clone(evidence);
    }
  }

  async ensureStrategy(
    id: string,
    kind: StrategyVersion["kind"],
    description: string,
  ) {
    if (!this.state.strategies.has(id))
      this.state.strategies.set(id, { kind, description });
  }
  async insertVersion(
    version: Omit<StrategyVersion, "id" | "version"> & { version?: number },
  ) {
    const existing = [...this.state.versions.values()].filter(
      (entry) => entry.strategyId === version.strategyId,
    );
    const stored: StrategyVersion = {
      ...clone(version),
      id: randomUUID(),
      version:
        version.version ??
        Math.max(0, ...existing.map((entry) => entry.version)) + 1,
    };
    this.state.versions.set(stored.id, stored);
    return clone(stored);
  }
  async updateVersion(
    id: string,
    patch: Partial<
      Pick<StrategyVersion, "status" | "canaryPercent" | "metrics" | "model">
    >,
  ) {
    const version = this.state.versions.get(id);
    if (version) Object.assign(version, clone(patch));
  }
  async getVersion(id: string) {
    const version = this.state.versions.get(id);
    return version ? clone(version) : null;
  }
  async listVersions(strategyId?: string) {
    return [...this.state.versions.values()]
      .filter((version) => !strategyId || version.strategyId === strategyId)
      .sort((a, b) => a.version - b.version)
      .map(clone);
  }

  async insertExperiment(experiment: Omit<Experiment, "id">) {
    const stored = { ...clone(experiment), id: randomUUID() };
    this.state.experiments.set(stored.id, stored);
    return clone(stored);
  }
  async updateExperiment(
    id: string,
    patch: Partial<
      Pick<
        Experiment,
        "status" | "conclusion" | "challengerVersionIds" | "hypotheses"
      >
    >,
  ) {
    const experiment = this.state.experiments.get(id);
    if (experiment) Object.assign(experiment, clone(patch));
  }
  async getExperiment(id: string) {
    const experiment = this.state.experiments.get(id);
    return experiment ? clone(experiment) : null;
  }
  async listExperiments(limit = 50) {
    return [...this.state.experiments.values()].slice(-limit).map(clone);
  }

  async insertTrials(
    trials: Array<
      Omit<Trial, "id" | "status" | "runId" | "attempts" | "result">
    >,
  ) {
    for (const trial of trials) {
      const duplicate = [...this.state.trials.values()].some(
        (entry) =>
          entry.experimentId === trial.experimentId &&
          entry.strategyVersionId === trial.strategyVersionId &&
          entry.evalTaskId === trial.evalTaskId &&
          entry.replicate === trial.replicate,
      );
      if (duplicate) continue;
      const id = randomUUID();
      this.state.trials.set(id, {
        ...clone(trial),
        id,
        status: "pending",
        runId: null,
        attempts: 0,
        result: null,
      });
    }
  }
  async listTrials(experimentId: string) {
    return [...this.state.trials.values()]
      .filter((trial) => trial.experimentId === experimentId)
      .map((trial) => unleased(trial));
  }
  async claimTrials(
    experimentId: string,
    limit: number,
    owner: string,
    leaseSeconds: number,
    partitions?: Trial["partition"][],
  ) {
    const now = Date.now();
    const claimed: Trial[] = [];
    for (const trial of this.state.trials.values()) {
      if (claimed.length >= limit) break;
      if (trial.experimentId !== experimentId || trial.status !== "pending")
        continue;
      if (partitions && !partitions.includes(trial.partition)) continue;
      if (trial.lease && trial.lease.until > now) continue;
      trial.lease = { owner, until: now + leaseSeconds * 1000 };
      claimed.push(unleased(trial));
    }
    return claimed;
  }
  async updateTrial(
    id: string,
    patch: Partial<Pick<Trial, "status" | "runId" | "attempts" | "result">> & {
      experienceId?: string | null;
    },
  ) {
    const trial = this.state.trials.get(id);
    if (!trial) return;
    const rest = clone(patch);
    delete rest.experienceId;
    Object.assign(trial, rest);
    if (patch.status) delete trial.lease;
  }
  async runningTrials(limit: number) {
    return [...this.state.trials.values()]
      .filter((trial) => trial.status === "running" && trial.runId)
      .slice(0, limit)
      .map((trial) => unleased(trial));
  }

  async upsertAgendaItem(item: Omit<AgendaItem, "id">) {
    const existing = [...this.state.agenda.values()].find(
      (entry) =>
        entry.capabilityId === item.capabilityId && entry.title === item.title,
    );
    const stored: AgendaItem = existing
      ? {
          ...existing,
          score: item.score,
          components: clone(item.components),
          rationale: item.rationale,
          status: item.status,
        }
      : { ...clone(item), id: randomUUID() };
    this.state.agenda.set(stored.id, stored);
    return clone(stored);
  }
  async listAgenda() {
    return [...this.state.agenda.values()]
      .sort((a, b) => b.score - a.score)
      .map(clone);
  }
  async updateAgendaItem(
    id: string,
    patch: Partial<
      Pick<AgendaItem, "status" | "score" | "components" | "rationale">
    >,
  ) {
    const item = this.state.agenda.get(id);
    if (item) Object.assign(item, clone(patch));
  }

  async insertCycle(
    cycle: Omit<ResearchCycle, "id" | "startedAt" | "completedAt">,
  ) {
    const stored: ResearchCycle = {
      ...clone(cycle),
      id: randomUUID(),
      startedAt: new Date().toISOString(),
      completedAt: null,
    };
    this.state.cycles.set(stored.id, stored);
    return clone(stored);
  }
  async updateCycle(
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
    > & { completed?: boolean },
  ) {
    const cycle = this.state.cycles.get(id);
    if (!cycle) return;
    const { completed, ...rest } = patch;
    Object.assign(cycle, clone(rest));
    if (completed) cycle.completedAt = new Date().toISOString();
  }
  async leaseActiveCycle(owner: string, leaseSeconds: number) {
    const now = Date.now();
    for (const cycle of this.state.cycles.values()) {
      if (cycle.status !== "running") continue;
      if (cycle.lease && cycle.lease.until > now && cycle.lease.owner !== owner)
        return null;
      cycle.lease = { owner, until: now + leaseSeconds * 1000 };
      return unleased(cycle);
    }
    return null;
  }
  async releaseCycle(id: string, owner: string) {
    const cycle = this.state.cycles.get(id);
    if (cycle?.lease?.owner === owner) delete cycle.lease;
  }
  async listCycles(limit = 20) {
    return [...this.state.cycles.values()]
      .slice(-limit)
      .reverse()
      .map((cycle) => unleased(cycle));
  }

  async insertPromotion(event: PromotionEvent) {
    this.state.promotions.push({
      ...clone(event),
      createdAt: new Date().toISOString(),
    });
  }
  async listPromotions(limit = 50) {
    return this.state.promotions.slice(-limit).reverse().map(clone);
  }

  async insertExperience(experience: Omit<Experience, "id" | "createdAt">) {
    const stored: Experience = {
      ...clone(experience),
      id: randomUUID(),
      createdAt: new Date().toISOString(),
    };
    this.state.experience.push(stored);
    return clone(stored);
  }
  async listExperience(filter: {
    capabilityId?: string;
    source?: Experience["source"];
    outcome?: Experience["outcome"];
    strategyVersionId?: string;
    since?: string;
    limit?: number;
  }) {
    return this.state.experience
      .filter(
        (entry) =>
          (!filter.capabilityId ||
            entry.capabilityIds.includes(filter.capabilityId)) &&
          (!filter.source || entry.source === filter.source) &&
          (!filter.outcome || entry.outcome === filter.outcome) &&
          (!filter.strategyVersionId ||
            entry.strategyVersionId === filter.strategyVersionId) &&
          (!filter.since || entry.createdAt >= filter.since),
      )
      .slice(-(filter.limit ?? 500))
      .map(clone);
  }
  async experienceFingerprintExists(fingerprint: string) {
    return this.state.experience.some(
      (entry) => entry.fingerprint === fingerprint,
    );
  }

  async upsertArtifact(artifact: Omit<LearningArtifact, "id">) {
    const existing = [...this.state.artifacts.values()].find(
      (entry) =>
        entry.kind === artifact.kind &&
        entry.fingerprint === artifact.fingerprint,
    );
    const stored: LearningArtifact = existing
      ? {
          ...existing,
          content: clone(artifact.content),
          evidence: clone(artifact.evidence),
          support: Math.max(existing.support, artifact.support),
          status: artifact.status,
          cycleId: artifact.cycleId ?? existing.cycleId,
        }
      : { ...clone(artifact), id: randomUUID() };
    this.state.artifacts.set(stored.id, stored);
    return clone(stored);
  }
  async listArtifacts(filter: {
    kind?: LearningArtifact["kind"];
    capabilityId?: string;
    status?: LearningArtifact["status"];
    limit?: number;
  }) {
    return [...this.state.artifacts.values()]
      .filter(
        (entry) =>
          (!filter.kind || entry.kind === filter.kind) &&
          (!filter.capabilityId ||
            entry.capabilityId === filter.capabilityId) &&
          (!filter.status || entry.status === filter.status),
      )
      .slice(-(filter.limit ?? 500))
      .map(clone);
  }

  async insertGenerationRun(run: Omit<GenerationRun, "id">) {
    const stored = { ...clone(run), id: randomUUID() };
    this.state.generation.push(stored);
    return clone(stored);
  }
  async listGenerationRuns(limit = 50) {
    return this.state.generation.slice(-limit).reverse().map(clone);
  }

  async ensureDataset(id: string, format: string, description: string) {
    if (!this.state.datasets.has(id))
      this.state.datasets.set(id, { format, description });
  }
  async insertDatasetVersion(input: {
    datasetId: string;
    counts: Record<string, number>;
    provenance: Record<string, unknown>;
    contamination: Record<string, unknown>;
    examples: DatasetExample[];
  }) {
    const version =
      Math.max(
        0,
        ...this.state.datasetVersions
          .filter((entry) => entry.datasetId === input.datasetId)
          .map((entry) => entry.version),
      ) + 1;
    const summary: DatasetVersionSummary = {
      id: randomUUID(),
      datasetId: input.datasetId,
      version,
      counts: clone(input.counts),
      provenance: clone(input.provenance),
      contamination: clone(input.contamination),
      createdAt: new Date().toISOString(),
    };
    this.state.datasetVersions.push({
      ...summary,
      examples: clone(input.examples),
    });
    return clone(summary);
  }
  async listDatasetVersions(limit = 50) {
    return this.state.datasetVersions
      .slice(-limit)
      .reverse()
      .map((entry) => {
        const summary: Partial<typeof entry> = clone(entry);
        delete summary.examples;
        return summary as DatasetVersionSummary;
      });
  }
  async datasetFingerprints(partition: DatasetExample["partition"]) {
    const out = new Set<string>();
    for (const version of this.state.datasetVersions)
      for (const example of version.examples)
        if (example.partition === partition) out.add(example.fingerprint);
    return out;
  }
  async datasetExampleSignals(filter: {
    partitions: DatasetExample["partition"][];
    datasetId?: string;
  }) {
    const wanted = new Set(filter.partitions);
    const out: ExampleSignal[] = [];
    for (const version of this.state.datasetVersions) {
      if (filter.datasetId && version.datasetId !== filter.datasetId) continue;
      for (const example of version.examples) {
        if (!wanted.has(example.partition)) continue;
        out.push({ ...holdoutSignal(example), partition: example.partition });
      }
    }
    return out;
  }
  async datasetHoldoutSignals() {
    const rows = await this.datasetExampleSignals({ partitions: ["holdout"] });
    return rows.map(({ fingerprint, simhash }) => ({ fingerprint, simhash }));
  }

  async insertTrainingRun(
    run: Omit<TrainingRunRecord, "id" | "createdAt" | "updatedAt">,
  ) {
    const now = new Date().toISOString();
    const stored: TrainingRunRecord = {
      ...clone(run),
      id: randomUUID(),
      createdAt: now,
      updatedAt: now,
    };
    this.state.trainingRuns.set(stored.id, stored);
    return clone(stored);
  }
  async updateTrainingRun(
    id: string,
    patch: Partial<Pick<TrainingRunRecord, "status" | "config" | "artifacts">>,
  ) {
    const current = this.state.trainingRuns.get(id);
    if (!current) return;
    this.state.trainingRuns.set(id, {
      ...current,
      ...clone(patch),
      updatedAt: new Date().toISOString(),
    });
  }
  async getTrainingRun(id: string) {
    const run = this.state.trainingRuns.get(id);
    return run ? clone(run) : null;
  }
  async insertModelCandidate(input: {
    baseModel: string;
    trainingRunId: string;
    lineage: Record<string, unknown>;
    evaluation?: Record<string, unknown>;
  }) {
    const run = this.state.trainingRuns.get(input.trainingRunId);
    assertCandidateTransition({
      from: "candidate",
      to: "candidate",
      trainingStatus: run?.status ?? null,
      evaluation: input.evaluation ?? {},
      inserting: true,
    });
    const stored: ModelCandidateRecord = {
      id: randomUUID(),
      baseModel: input.baseModel,
      trainingRunId: input.trainingRunId,
      lineage: clone(input.lineage),
      status: "candidate",
      evaluation: clone(input.evaluation ?? {}),
      createdAt: new Date().toISOString(),
    };
    this.state.candidates.set(stored.id, stored);
    return clone(stored);
  }
  async updateModelCandidate(
    id: string,
    patch: Partial<
      Pick<ModelCandidateRecord, "status" | "evaluation" | "lineage">
    >,
  ) {
    const current = this.state.candidates.get(id);
    if (!current) throw new Error("candidate_missing");
    const next = patch.status ?? current.status;
    if (next !== current.status) {
      const run = current.trainingRunId
        ? this.state.trainingRuns.get(current.trainingRunId)
        : undefined;
      assertCandidateTransition({
        from: current.status,
        to: next,
        trainingStatus: run?.status ?? null,
        evaluation: patch.evaluation ?? current.evaluation,
      });
    }
    const stored: ModelCandidateRecord = {
      ...current,
      ...clone(patch),
      status: next,
    };
    this.state.candidates.set(id, stored);
    return clone(stored);
  }
  async getModelCandidate(id: string) {
    const candidate = this.state.candidates.get(id);
    return candidate ? clone(candidate) : null;
  }
  async listModelCandidates(limit = 50) {
    return [...this.state.candidates.values()]
      .slice(-limit)
      .reverse()
      .map(clone);
  }

  async upsertModel(model: ModelRecord) {
    this.state.models.set(model.id, clone(model));
  }
  async listModels() {
    return [...this.state.models.values()].map(clone);
  }
  async upsertModelStat(stat: ModelStat) {
    this.state.modelStats.set(
      `${stat.modelId}:${stat.capabilityId}`,
      clone(stat),
    );
  }
  async listModelStats() {
    return [...this.state.modelStats.values()].map(clone);
  }

  /** Everything, as plain JSON: the cycle runner's evidence artifact. */
  snapshot() {
    return {
      settings: this.state.settings,
      ledger: Object.fromEntries(this.state.ledger),
      capabilities: [...this.state.capabilities.values()],
      dependencies: this.state.dependencies,
      gaps: [...this.state.gaps.values()],
      tasks: [...this.state.tasks.values()].map((task) => ({
        ...task,
        spec: {
          ...task.spec,
          fixture: task.spec.fixture?.map((file) => file.path),
        },
      })),
      versions: [...this.state.versions.values()],
      experiments: [...this.state.experiments.values()],
      trials: [...this.state.trials.values()].map((trial) => unleased(trial)),
      agenda: [...this.state.agenda.values()],
      cycles: [...this.state.cycles.values()].map((cycle) => unleased(cycle)),
      promotions: this.state.promotions,
      experience: this.state.experience,
      artifacts: [...this.state.artifacts.values()],
      generation: this.state.generation,
      datasets: this.state.datasetVersions.map(({ examples, ...summary }) => ({
        ...summary,
        examples: examples.length,
      })),
      models: [...this.state.models.values()],
      modelStats: [...this.state.modelStats.values()],
      trainingRuns: [...this.state.trainingRuns.values()],
      modelCandidates: [...this.state.candidates.values()],
    };
  }
}
