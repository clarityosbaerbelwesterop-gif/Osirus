import { describeGenome } from "../strategies/genomes";
import type { TrainingCapabilities } from "../models/training";
import type { IntelStore, LedgerCategory } from "../store/store";
import {
  CYCLE_PHASES,
  type CapabilityStatus,
  type CyclePhase,
  type ExperimentDecision,
  type FoundrySettings,
  type StrategyStatus,
} from "../types";

// What the Intelligence Lab shows, computed from the store. Plain data, so
// the page renders it from Postgres and the fixture surface renders the same
// component from deterministic data.

export type LabCapability = {
  id: string;
  name: string;
  domain: string;
  status: CapabilityStatus;
  rate: number | null;
  samples: number;
  depth: number;
  dependsOn: Array<{ id: string; status: CapabilityStatus }>;
  /** The weakest measured dependency, when it is weaker than this one. */
  heldBackBy: string | null;
};

export type LabView = {
  /** When the view was read; "now" for everything relative in it. */
  generatedAt: string;
  settings: FoundrySettings;
  usage: Record<LedgerCategory, number>;
  capabilities: LabCapability[];
  agenda: Array<{
    id: string;
    capabilityId: string;
    title: string;
    rationale: string;
    score: number;
    status: string;
  }>;
  cycle: {
    id: string;
    capabilityId: string | null;
    phase: CyclePhase;
    phaseIndex: number;
    status: string;
    startedAt: string;
    log: Array<{ at: string; phase: string; note: string }>;
  } | null;
  history: Array<{
    id: string;
    capabilityId: string | null;
    status: string;
    startedAt: string;
    completedAt: string | null;
    outcome: ExperimentDecision["outcome"] | null;
    summary: string | null;
    why: Record<string, unknown> | null;
    next: string | null;
  }>;
  experiments: Array<{
    id: string;
    capabilityId: string;
    status: string;
    championLabel: string;
    challengers: Array<{ label: string; genome: string; status: string }>;
    outcome: ExperimentDecision["outcome"] | null;
    summary: string | null;
    comparisons: ExperimentDecision["comparisons"];
  }>;
  strategies: Array<{
    strategyId: string;
    versions: Array<{
      id: string;
      version: number;
      status: StrategyStatus;
      genome: string;
      rationale: string;
      canaryPercent: number;
      model: string | null;
    }>;
  }>;
  generation: Array<{
    kind: string;
    produced: number;
    verified: number;
    rejected: number;
    note: string;
  }>;
  datasets: Array<{
    id: string;
    datasetId: string;
    version: number;
    counts: Record<string, number>;
    contaminated: number;
  }>;
  experience: {
    total: number;
    verified: number;
    bySource: Record<string, number>;
    failures: number;
  };
  artifacts: Record<string, number>;
  strategicMemory: Array<{ pattern: string; content: string; support: number }>;
  models: Array<{
    modelId: string;
    capabilityId: string;
    trials: number;
    verified: number;
    champion: boolean;
  }>;
  training: TrainingCapabilities;
  promotions: Array<{
    versionId: string;
    from: string;
    to: string;
    canaryPercent: number | null;
    at: string | null;
    reason: string | null;
  }>;
};

const RANK: Record<CapabilityStatus, number> = {
  unmeasured: -1,
  weak: 0,
  developing: 1,
  strong: 2,
};

function text(value: unknown) {
  return typeof value === "string" ? value : null;
}

export async function labView(
  store: IntelStore,
  training: TrainingCapabilities,
  now = new Date(),
): Promise<LabView> {
  const [
    settings,
    usage,
    capabilities,
    edges,
    agenda,
    cycles,
    experiments,
    versions,
    generation,
    datasets,
    experience,
    artifacts,
    models,
    promotions,
  ] = await Promise.all([
    store.settings(),
    store.usage(),
    store.listCapabilities(),
    store.dependencies(),
    store.listAgenda(),
    store.listCycles(12),
    store.listExperiments(8),
    store.listVersions(),
    store.listGenerationRuns(12),
    store.listDatasetVersions(12),
    store.listExperience({ limit: 2000 }),
    store.listArtifacts({ limit: 500 }),
    store.listModelStats(),
    store.listPromotions(20),
  ]);

  const byId = new Map(capabilities.map((entry) => [entry.id, entry]));
  const depthOf = (id: string, seen = new Set<string>()): number => {
    if (seen.has(id)) return 0;
    seen.add(id);
    const parents = edges.filter((edge) => edge.capabilityId === id);
    return parents.length
      ? 1 + Math.max(...parents.map((edge) => depthOf(edge.dependsOn, seen)))
      : 0;
  };
  const labCapabilities: LabCapability[] = capabilities
    .map((entry) => {
      const dependsOn = edges
        .filter((edge) => edge.capabilityId === entry.id)
        .map((edge) => ({
          id: edge.dependsOn,
          status: byId.get(edge.dependsOn)?.status ?? "unmeasured",
        }));
      const weakest = dependsOn
        .filter((dep) => dep.status !== "unmeasured")
        .sort((a, b) => RANK[a.status] - RANK[b.status])[0];
      return {
        id: entry.id,
        name: entry.name,
        domain: entry.domain,
        status: entry.status,
        rate: entry.verifiedSuccessRate,
        samples: entry.sampleCount,
        depth: depthOf(entry.id),
        dependsOn,
        heldBackBy:
          weakest &&
          entry.status !== "unmeasured" &&
          RANK[weakest.status] < RANK[entry.status]
            ? weakest.id
            : null,
      };
    })
    .sort((a, b) => a.depth - b.depth || a.id.localeCompare(b.id));

  const running = cycles.find((cycle) => cycle.status === "running") ?? null;
  const versionLabel = new Map(
    versions.map((version) => [
      version.id,
      `${version.strategyId} v${version.version}`,
    ]),
  );
  const strategies = new Map<string, LabView["strategies"][number]>();
  for (const version of versions) {
    const entry = strategies.get(version.strategyId) ?? {
      strategyId: version.strategyId,
      versions: [],
    };
    entry.versions.push({
      id: version.id,
      version: version.version,
      status: version.status,
      genome: describeGenome(version.genome),
      rationale: version.mutation.rationale,
      canaryPercent: version.canaryPercent,
      model: version.model,
    });
    strategies.set(version.strategyId, entry);
  }

  const bySource: Record<string, number> = {};
  for (const row of experience)
    bySource[row.source] = (bySource[row.source] ?? 0) + 1;
  const artifactCounts: Record<string, number> = {};
  for (const artifact of artifacts)
    artifactCounts[artifact.kind] = (artifactCounts[artifact.kind] ?? 0) + 1;

  return {
    generatedAt: now.toISOString(),
    settings,
    usage,
    capabilities: labCapabilities,
    agenda: agenda.slice(0, 8).map((item) => ({
      id: item.id,
      capabilityId: item.capabilityId,
      title: item.title,
      rationale: item.rationale,
      score: item.score,
      status: item.status,
    })),
    cycle: running
      ? {
          id: running.id,
          capabilityId: running.capabilityId,
          phase: running.phase,
          phaseIndex: CYCLE_PHASES.indexOf(running.phase),
          status: running.status,
          startedAt: running.startedAt,
          log: (running.state.log ?? []).slice(-14),
        }
      : null,
    history: cycles
      .filter((cycle) => cycle.status !== "running")
      .map((cycle) => {
        const decision = cycle.summary.decision as
          | { outcome: ExperimentDecision["outcome"]; summary: string }
          | undefined;
        const next = cycle.summary.next as { title?: string } | undefined;
        return {
          id: cycle.id,
          capabilityId: cycle.capabilityId,
          status: cycle.status,
          startedAt: cycle.startedAt,
          completedAt: cycle.completedAt,
          outcome: decision?.outcome ?? null,
          summary: decision?.summary ?? null,
          why:
            (cycle.summary.whyImproved as Record<string, unknown> | null) ??
            null,
          next: text(next?.title) ?? null,
        };
      }),
    experiments: [...experiments].reverse().map((experiment) => ({
      id: experiment.id,
      capabilityId: experiment.capabilityId,
      status: experiment.status,
      championLabel:
        versionLabel.get(experiment.championVersionId) ?? "champion",
      challengers: experiment.challengerVersionIds.map((id) => {
        const version = versions.find((entry) => entry.id === id);
        return {
          label: versionLabel.get(id) ?? id.slice(0, 8),
          genome: version ? describeGenome(version.genome) : "",
          status: version?.status ?? "unknown",
        };
      }),
      outcome: experiment.conclusion?.outcome ?? null,
      summary: experiment.conclusion?.summary ?? null,
      comparisons: experiment.conclusion?.comparisons ?? [],
    })),
    strategies: [...strategies.values()].map((entry) => ({
      ...entry,
      versions: entry.versions.sort((a, b) => b.version - a.version),
    })),
    generation: generation.map((run) => ({
      kind: run.kind,
      produced: run.produced,
      verified: run.verified,
      rejected: run.rejected,
      note:
        text(run.config.id)?.replaceAll("_", " ") ??
        (Array.isArray(run.config.traps)
          ? `traps: ${(run.config.traps as string[]).join(", ").replaceAll("_", " ")}`
          : ""),
    })),
    datasets: datasets.map((version) => ({
      id: version.id,
      datasetId: version.datasetId,
      version: version.version,
      counts: version.counts,
      contaminated: Number(version.contamination.rejected ?? 0),
    })),
    experience: {
      total: experience.length,
      verified: experience.filter((row) => row.outcome === "verified_success")
        .length,
      failures: experience.filter(
        (row) =>
          row.outcome === "failure" || row.outcome === "false_completion",
      ).length,
      bySource,
    },
    artifacts: artifactCounts,
    strategicMemory: artifacts
      .filter((artifact) => artifact.kind === "strategic_memory")
      .slice(-4)
      .map((artifact) => ({
        pattern: artifact.taskPattern ?? artifact.capabilityId ?? "",
        content: [
          text(artifact.content.bestStrategy),
          text(artifact.content.genome),
          typeof artifact.content.verifiedRate === "number"
            ? `${Math.round(artifact.content.verifiedRate * 100)}% verified`
            : null,
        ]
          .filter(Boolean)
          .join(" · "),
        support: artifact.support,
      })),
    models: models.map((stat) => ({
      modelId: stat.modelId,
      capabilityId: stat.capabilityId,
      trials: stat.trials,
      verified: stat.verified,
      champion: stat.champion,
    })),
    training,
    promotions: promotions.map((event) => ({
      versionId: event.strategyVersionId,
      from: event.fromStatus,
      to: event.toStatus,
      canaryPercent: event.canaryPercent,
      at: event.createdAt ?? null,
      reason: text(event.evidence.reason),
    })),
  };
}
