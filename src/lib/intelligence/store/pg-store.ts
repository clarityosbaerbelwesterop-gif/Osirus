import { querySystem } from "../../db/client";
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
import {
  today,
  type DatasetExample,
  type DatasetVersionSummary,
  type IntelStore,
  type LedgerCategory,
  type ModelRecord,
  type ModelStat,
  type PromotionEvent,
} from "./store";

// The production IntelStore, over the osirus_intel schema (migration 012).
//
// Every statement runs through querySystem: the Intelligence Plane is system
// work, and its tables admit only osirus.is_system() for writes (operators
// read them in the internal lab through their own identity). Leases are rows
// with an owner and an expiry, taken with SKIP LOCKED, so two ticks that
// overlap never step the same cycle or run the same trial.

type Row = Record<string, unknown>;

const q = <T extends Row = Row>(text: string, params: unknown[] = []) =>
  querySystem<T>(text, params);

const num = (value: unknown) =>
  value === null || value === undefined ? null : Number(value);
const iso = (value: unknown) =>
  value ? new Date(value as string).toISOString() : null;
const json = (value: unknown) => JSON.stringify(value ?? {});

const LEDGER: LedgerCategory[] = [
  "model_calls",
  "tokens",
  "cost_usd",
  "sandbox_minutes",
  "chained_ticks",
  "trials",
];

function capability(row: Row): Capability {
  return {
    id: row.id as string,
    domain: row.domain as string,
    name: row.name as string,
    description: row.description as string,
    status: row.status as Capability["status"],
    verifiedSuccessRate: num(row.verified_success_rate),
    sampleCount: Number(row.sample_count),
    failurePatterns: row.failure_patterns as Capability["failurePatterns"],
    preferred: row.preferred as Capability["preferred"],
    costProfile: row.cost_profile as Capability["costProfile"],
    latencyProfile: row.latency_profile as Capability["latencyProfile"],
    version: Number(row.version),
    lastEvaluatedAt: iso(row.last_evaluated_at),
  };
}

function gap(row: Row): CapabilityGap {
  return {
    id: row.id as string,
    capabilityId: row.capability_id as string,
    kind: row.kind as CapabilityGap["kind"],
    summary: row.summary as string,
    evidence: row.evidence as Record<string, unknown>,
    support: Number(row.support),
    status: row.status as CapabilityGap["status"],
  };
}

function task(row: Row): EvalTask {
  return {
    id: row.id as string,
    suite: row.suite as string,
    capabilityId: row.capability_id as string,
    partition: row.partition as EvalTask["partition"],
    difficulty: row.difficulty as EvalTask["difficulty"],
    difficultyScore: Number(row.difficulty_score),
    spec: row.spec as EvalTask["spec"],
    generator: row.generator as EvalTask["generator"],
    fingerprint: row.fingerprint as string,
    parentId: (row.parent_id as string | null) ?? null,
    labelVerified: Boolean(row.label_verified),
    labelEvidence: row.label_evidence as Record<string, unknown>,
  };
}

function version(row: Row): StrategyVersion {
  return {
    id: row.id as string,
    strategyId: row.strategy_id as string,
    kind: row.kind as StrategyVersion["kind"],
    version: Number(row.version),
    genome: row.genome as StrategyVersion["genome"],
    parentId: (row.parent_id as string | null) ?? null,
    mutation: row.mutation as StrategyVersion["mutation"],
    status: row.status as StrategyVersion["status"],
    riskClass: row.risk_class as StrategyVersion["riskClass"],
    model: (row.model as string | null) ?? null,
    canaryPercent: Number(row.canary_percent),
    metrics: row.metrics as Record<string, unknown>,
  };
}

function experiment(row: Row): Experiment {
  return {
    id: row.id as string,
    cycleId: (row.cycle_id as string | null) ?? null,
    capabilityId: row.capability_id as string,
    strategyId: row.strategy_id as string,
    observation: row.observation as Record<string, unknown>,
    hypotheses: row.hypotheses as Experiment["hypotheses"],
    design: row.design as Experiment["design"],
    conclusion: (row.conclusion as Experiment["conclusion"]) ?? null,
    status: row.status as Experiment["status"],
    championVersionId: row.champion_version_id as string,
    challengerVersionIds: (row.challenger_version_ids as string[]) ?? [],
  };
}

function trial(row: Row): Trial {
  return {
    id: row.id as string,
    experimentId: row.experiment_id as string,
    strategyVersionId: row.strategy_version_id as string,
    evalTaskId: row.eval_task_id as string,
    partition: row.partition as Trial["partition"],
    replicate: Number(row.replicate),
    status: row.status as Trial["status"],
    runId: (row.run_id as string | null) ?? null,
    attempts: Number(row.attempts),
    result: (row.result as Trial["result"]) ?? null,
  };
}

function agenda(row: Row): AgendaItem {
  return {
    id: row.id as string,
    capabilityId: row.capability_id as string,
    title: row.title as string,
    rationale: row.rationale as string,
    score: Number(row.score),
    components: row.components as AgendaItem["components"],
    status: row.status as AgendaItem["status"],
  };
}

function cycle(row: Row): ResearchCycle {
  return {
    id: row.id as string,
    status: row.status as ResearchCycle["status"],
    phase: row.phase as ResearchCycle["phase"],
    agendaItemId: (row.agenda_item_id as string | null) ?? null,
    capabilityId: (row.capability_id as string | null) ?? null,
    state: row.state as ResearchCycle["state"],
    summary: row.summary as Record<string, unknown>,
    startedAt: iso(row.started_at)!,
    completedAt: iso(row.completed_at),
  };
}

function experience(row: Row): Experience {
  return {
    id: row.id as string,
    source: row.source as Experience["source"],
    taskRef: (row.task_ref as string | null) ?? null,
    taskType: row.task_type as string,
    capabilityIds: (row.capability_ids as string[]) ?? [],
    difficulty: num(row.difficulty),
    strategyVersionId: (row.strategy_version_id as string | null) ?? null,
    model: (row.model as string | null) ?? null,
    skills: (row.skills as string[]) ?? [],
    tools: (row.tools as string[]) ?? [],
    trajectory: row.trajectory as Experience["trajectory"],
    verification: row.verification as Experience["verification"],
    outcome: row.outcome as Experience["outcome"],
    failureClass: (row.failure_class as string | null) ?? null,
    repairs: Number(row.repairs),
    costUsd: Number(row.cost_usd),
    tokens: Number(row.tokens),
    latencyMs: Number(row.latency_ms),
    confidence: num(row.confidence),
    qualityScore: Number(row.quality_score),
    fingerprint: row.fingerprint as string,
    partition: (row.partition as Experience["partition"]) ?? null,
    provenance: row.provenance as Record<string, unknown>,
    createdAt: iso(row.created_at)!,
  };
}

function artifact(row: Row): LearningArtifact {
  return {
    id: row.id as string,
    cycleId: (row.cycle_id as string | null) ?? null,
    kind: row.kind as LearningArtifact["kind"],
    capabilityId: (row.capability_id as string | null) ?? null,
    taskPattern: (row.task_pattern as string | null) ?? null,
    content: row.content as Record<string, unknown>,
    evidence: row.evidence as Record<string, unknown>,
    support: Number(row.support),
    status: row.status as LearningArtifact["status"],
    fingerprint: row.fingerprint as string,
  };
}

function generation(row: Row): GenerationRun {
  return {
    id: row.id as string,
    cycleId: (row.cycle_id as string | null) ?? null,
    kind: row.kind as GenerationRun["kind"],
    config: row.config as Record<string, unknown>,
    produced: Number(row.produced),
    verified: Number(row.verified),
    rejected: Number(row.rejected),
    summary: row.summary as Record<string, unknown>,
  };
}

function datasetVersion(row: Row): DatasetVersionSummary {
  return {
    id: row.id as string,
    datasetId: row.dataset_id as string,
    version: Number(row.version),
    counts: row.counts as Record<string, number>,
    provenance: row.provenance as Record<string, unknown>,
    contamination: row.contamination as Record<string, unknown>,
    createdAt: iso(row.created_at)!,
  };
}

function model(row: Row): ModelRecord {
  return {
    id: row.id as string,
    provider: row.provider as string,
    modelId: row.model_id as string,
    family: (row.family as string | null) ?? null,
    modalities: (row.modalities as string[]) ?? ["text"],
    contextTokens: num(row.context_tokens),
    free: Boolean(row.free),
    status: row.status as ModelRecord["status"],
  };
}

function modelStat(row: Row): ModelStat {
  return {
    modelId: row.model_id as string,
    capabilityId: row.capability_id as string,
    trials: Number(row.trials),
    verified: Number(row.verified),
    meanLatencyMs: num(row.mean_latency_ms),
    meanCostUsd: num(row.mean_cost_usd),
    champion: Boolean(row.champion),
  };
}

/** `set a = $n, b = $m` for the defined keys of a patch. */
function assignments(
  patch: Record<string, unknown>,
  columns: Record<string, { column: string; cast?: string; json?: boolean }>,
  params: unknown[],
) {
  const sets: string[] = [];
  for (const [key, spec] of Object.entries(columns)) {
    if (!(key in patch) || patch[key] === undefined) continue;
    params.push(spec.json ? json(patch[key]) : patch[key]);
    sets.push(`${spec.column} = $${params.length}${spec.cast ?? ""}`);
  }
  return sets;
}

export class PgIntelStore implements IntelStore {
  async settings(): Promise<FoundrySettings> {
    const [row] = await q(
      `select flags, budgets, foundry_model, product_model, provider_pause
         from osirus_intel.settings where id = 1`,
    );
    if (!row) return structuredClone(DEFAULT_SETTINGS);
    return {
      flags: {
        ...DEFAULT_SETTINGS.flags,
        ...(row.flags as Partial<FoundrySettings["flags"]>),
      },
      budgets: {
        ...DEFAULT_SETTINGS.budgets,
        ...(row.budgets as Partial<FoundrySettings["budgets"]>),
      },
      foundryModel: row.foundry_model as string,
      productModel: (row.product_model as string | null) ?? null,
      providerPause:
        (row.provider_pause as FoundrySettings["providerPause"]) ?? null,
    };
  }
  async saveSettings(settings: FoundrySettings) {
    await q(
      `insert into osirus_intel.settings
         (id, flags, budgets, foundry_model, product_model, provider_pause,
          updated_at)
       values (1, $1::jsonb, $2::jsonb, $3, $4, $5::jsonb, now())
       on conflict (id) do update
         set flags = excluded.flags, budgets = excluded.budgets,
             foundry_model = excluded.foundry_model,
             product_model = excluded.product_model,
             provider_pause = excluded.provider_pause, updated_at = now()`,
      [
        json(settings.flags),
        json(settings.budgets),
        settings.foundryModel,
        settings.productModel,
        settings.providerPause ? json(settings.providerPause) : null,
      ],
    );
  }

  async addUsage(category: LedgerCategory, amount: number, day = today()) {
    if (!amount) return;
    await q(
      `insert into osirus_intel.resource_ledger (day, category, amount)
       values ($1::date, $2, $3)
       on conflict (day, category) do update
         set amount = osirus_intel.resource_ledger.amount + excluded.amount,
             updated_at = now()`,
      [day, category, amount],
    );
  }
  async usage(day = today()) {
    const rows = await q(
      `select category, amount from osirus_intel.resource_ledger
        where day = $1::date`,
      [day],
    );
    const out = Object.fromEntries(LEDGER.map((key) => [key, 0])) as Record<
      LedgerCategory,
      number
    >;
    for (const row of rows)
      out[row.category as LedgerCategory] = Number(row.amount);
    return out;
  }

  async listCapabilities() {
    return (await q(`select * from osirus_intel.capabilities order by id`)).map(
      capability,
    );
  }
  async upsertCapability(entry: Capability) {
    await q(
      `insert into osirus_intel.capabilities
         (id, domain, name, description, status, verified_success_rate,
          sample_count, failure_patterns, preferred, cost_profile,
          latency_profile, version, last_evaluated_at, updated_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10::jsonb,
               $11::jsonb, $12, $13::timestamptz, now())
       on conflict (id) do update set
         domain = excluded.domain, name = excluded.name,
         description = excluded.description, status = excluded.status,
         verified_success_rate = excluded.verified_success_rate,
         sample_count = excluded.sample_count,
         failure_patterns = excluded.failure_patterns,
         preferred = excluded.preferred, cost_profile = excluded.cost_profile,
         latency_profile = excluded.latency_profile,
         version = excluded.version,
         last_evaluated_at = excluded.last_evaluated_at, updated_at = now()`,
      [
        entry.id,
        entry.domain,
        entry.name,
        entry.description,
        entry.status,
        entry.verifiedSuccessRate,
        entry.sampleCount,
        JSON.stringify(entry.failurePatterns ?? []),
        json(entry.preferred),
        json(entry.costProfile),
        json(entry.latencyProfile),
        entry.version,
        entry.lastEvaluatedAt,
      ],
    );
  }
  async dependencies() {
    return (
      await q(
        `select capability_id, depends_on
           from osirus_intel.capability_dependencies`,
      )
    ).map((row) => ({
      capabilityId: row.capability_id as string,
      dependsOn: row.depends_on as string,
    }));
  }
  async addDependency(capabilityId: string, dependsOn: string) {
    await q(
      `insert into osirus_intel.capability_dependencies
         (capability_id, depends_on) values ($1, $2)
       on conflict do nothing`,
      [capabilityId, dependsOn],
    );
  }

  async upsertGap(entry: Omit<CapabilityGap, "id">) {
    const [row] = await q(
      `insert into osirus_intel.capability_gaps
         (capability_id, kind, summary, evidence, support, status)
       values ($1, $2, $3, $4::jsonb, $5, $6)
       on conflict (capability_id, kind, summary) do update set
         support = osirus_intel.capability_gaps.support + excluded.support,
         evidence = osirus_intel.capability_gaps.evidence || excluded.evidence,
         status = case when osirus_intel.capability_gaps.status = 'addressed'
                       then osirus_intel.capability_gaps.status
                       else excluded.status end,
         updated_at = now()
       returning *`,
      [
        entry.capabilityId,
        entry.kind,
        entry.summary,
        json(entry.evidence),
        entry.support,
        entry.status,
      ],
    );
    return gap(row!);
  }
  async listGaps(capabilityId?: string) {
    return (
      await q(
        `select * from osirus_intel.capability_gaps
          where ($1::text is null or capability_id = $1)
          order by created_at`,
        [capabilityId ?? null],
      )
    ).map(gap);
  }

  async insertTasks(tasks: Array<Omit<EvalTask, "id">>) {
    if (!tasks.length) return [];
    const payload = tasks.map((entry) => ({
      suite: entry.suite,
      capability_id: entry.capabilityId,
      partition: entry.partition,
      difficulty: entry.difficulty,
      difficulty_score: entry.difficultyScore,
      spec: entry.spec,
      generator: entry.generator,
      fingerprint: entry.fingerprint,
      parent_id: entry.parentId,
      label_verified: entry.labelVerified,
      label_evidence: entry.labelEvidence,
    }));
    await q(
      `insert into osirus_intel.eval_tasks
         (suite, capability_id, partition, difficulty, difficulty_score, spec,
          generator, fingerprint, parent_id, label_verified, label_evidence)
       select x.suite, x.capability_id, x.partition, x.difficulty,
              x.difficulty_score, x.spec, x.generator, x.fingerprint,
              x.parent_id, x.label_verified, x.label_evidence
         from jsonb_to_recordset($1::jsonb) as x(
           suite text, capability_id text, partition text, difficulty jsonb,
           difficulty_score numeric, spec jsonb, generator text,
           fingerprint text, parent_id uuid, label_verified boolean,
           label_evidence jsonb)
       on conflict (fingerprint) do nothing`,
      [JSON.stringify(payload)],
    );
    const rows = (
      await q(
        `select * from osirus_intel.eval_tasks
          where fingerprint = any($1::text[])`,
        [tasks.map((entry) => entry.fingerprint)],
      )
    ).map(task);
    const byPrint = new Map(rows.map((entry) => [entry.fingerprint, entry]));
    return tasks
      .map((entry) => byPrint.get(entry.fingerprint))
      .filter((entry): entry is EvalTask => Boolean(entry));
  }
  async listTasks(filter: {
    capabilityId?: string;
    partition?: EvalTask["partition"];
    limit?: number;
  }) {
    return (
      await q(
        `select * from osirus_intel.eval_tasks
          where ($1::text is null or capability_id = $1)
            and ($2::text is null or partition = $2)
          order by created_at, id
          limit $3`,
        [
          filter.capabilityId ?? null,
          filter.partition ?? null,
          filter.limit ?? 1000,
        ],
      )
    ).map(task);
  }
  async getTask(id: string) {
    const [row] = await q(
      `select * from osirus_intel.eval_tasks where id = $1::uuid`,
      [id],
    );
    return row ? task(row) : null;
  }
  async updateTaskLabel(
    id: string,
    verified: boolean,
    evidence: Record<string, unknown>,
  ) {
    await q(
      `update osirus_intel.eval_tasks
          set label_verified = $2, label_evidence = $3::jsonb
        where id = $1::uuid`,
      [id, verified, json(evidence)],
    );
  }

  async ensureStrategy(
    id: string,
    kind: StrategyVersion["kind"],
    description: string,
  ) {
    await q(
      `insert into osirus_intel.strategies (id, kind, description)
       values ($1, $2, $3) on conflict (id) do nothing`,
      [id, kind, description],
    );
  }
  async insertVersion(
    entry: Omit<StrategyVersion, "id" | "version"> & { version?: number },
  ) {
    const [row] = await q(
      `insert into osirus_intel.strategy_versions
         (strategy_id, version, genome, parent_id, mutation, status,
          risk_class, model, canary_percent, metrics)
       values ($1,
               coalesce($2::int, (select coalesce(max(version), 0) + 1
                                    from osirus_intel.strategy_versions
                                   where strategy_id = $1)),
               $3::jsonb, $4::uuid, $5::jsonb, $6, $7, $8, $9, $10::jsonb)
       returning *, (select kind from osirus_intel.strategies
                      where id = $1) as kind`,
      [
        entry.strategyId,
        entry.version ?? null,
        json(entry.genome),
        entry.parentId,
        json(entry.mutation),
        entry.status,
        entry.riskClass,
        entry.model,
        entry.canaryPercent,
        json(entry.metrics),
      ],
    );
    return version(row!);
  }
  async updateVersion(
    id: string,
    patch: Partial<
      Pick<StrategyVersion, "status" | "canaryPercent" | "metrics" | "model">
    >,
  ) {
    const params: unknown[] = [id];
    const sets = assignments(
      patch,
      {
        status: { column: "status" },
        canaryPercent: { column: "canary_percent" },
        metrics: { column: "metrics", cast: "::jsonb", json: true },
        model: { column: "model" },
      },
      params,
    );
    if (!sets.length) return;
    await q(
      `update osirus_intel.strategy_versions
          set ${sets.join(", ")}, updated_at = now()
        where id = $1::uuid`,
      params,
    );
  }
  async getVersion(id: string) {
    const [row] = await q(
      `select v.*, s.kind from osirus_intel.strategy_versions v
         join osirus_intel.strategies s on s.id = v.strategy_id
        where v.id = $1::uuid`,
      [id],
    );
    return row ? version(row) : null;
  }
  async listVersions(strategyId?: string) {
    return (
      await q(
        `select v.*, s.kind from osirus_intel.strategy_versions v
           join osirus_intel.strategies s on s.id = v.strategy_id
          where ($1::text is null or v.strategy_id = $1)
          order by v.version, v.created_at`,
        [strategyId ?? null],
      )
    ).map(version);
  }

  async insertExperiment(entry: Omit<Experiment, "id">) {
    const [row] = await q(
      `insert into osirus_intel.experiments
         (cycle_id, capability_id, strategy_id, observation, hypotheses,
          design, conclusion, status, champion_version_id,
          challenger_version_ids)
       values ($1::uuid, $2, $3, $4::jsonb, $5::jsonb, $6::jsonb, $7::jsonb,
               $8, $9::uuid, $10::uuid[])
       returning *`,
      [
        entry.cycleId,
        entry.capabilityId,
        entry.strategyId,
        json(entry.observation),
        JSON.stringify(entry.hypotheses ?? []),
        json(entry.design),
        entry.conclusion ? json(entry.conclusion) : null,
        entry.status,
        entry.championVersionId,
        entry.challengerVersionIds,
      ],
    );
    return experiment(row!);
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
    const params: unknown[] = [id];
    const sets = assignments(
      patch,
      {
        status: { column: "status" },
        conclusion: { column: "conclusion", cast: "::jsonb", json: true },
        challengerVersionIds: {
          column: "challenger_version_ids",
          cast: "::uuid[]",
        },
        hypotheses: { column: "hypotheses", cast: "::jsonb", json: true },
      },
      params,
    );
    if (patch.status === "concluded" || patch.status === "aborted")
      sets.push("concluded_at = coalesce(concluded_at, now())");
    if (!sets.length) return;
    await q(
      `update osirus_intel.experiments set ${sets.join(", ")}
        where id = $1::uuid`,
      params,
    );
  }
  async getExperiment(id: string) {
    const [row] = await q(
      `select * from osirus_intel.experiments where id = $1::uuid`,
      [id],
    );
    return row ? experiment(row) : null;
  }
  async listExperiments(limit = 50) {
    return (
      await q(
        `select * from (select * from osirus_intel.experiments
                         order by created_at desc limit $1) recent
          order by created_at`,
        [limit],
      )
    ).map(experiment);
  }

  async insertTrials(
    trials: Array<
      Omit<Trial, "id" | "status" | "runId" | "attempts" | "result">
    >,
  ) {
    if (!trials.length) return;
    await q(
      `insert into osirus_intel.experiment_trials
         (experiment_id, strategy_version_id, eval_task_id, partition,
          replicate)
       select x.experiment_id, x.strategy_version_id, x.eval_task_id,
              x.partition, x.replicate
         from jsonb_to_recordset($1::jsonb) as x(
           experiment_id uuid, strategy_version_id uuid, eval_task_id uuid,
           partition text, replicate int)
       on conflict (experiment_id, strategy_version_id, eval_task_id,
                    replicate) do nothing`,
      [
        JSON.stringify(
          trials.map((entry) => ({
            experiment_id: entry.experimentId,
            strategy_version_id: entry.strategyVersionId,
            eval_task_id: entry.evalTaskId,
            partition: entry.partition,
            replicate: entry.replicate,
          })),
        ),
      ],
    );
  }
  async listTrials(experimentId: string) {
    return (
      await q(
        `select * from osirus_intel.experiment_trials
          where experiment_id = $1::uuid order by created_at, id`,
        [experimentId],
      )
    ).map(trial);
  }
  async claimTrials(
    experimentId: string,
    limit: number,
    owner: string,
    leaseSeconds: number,
    partitions?: Trial["partition"][],
  ) {
    return (
      await q(
        `update osirus_intel.experiment_trials t
            set lease_owner = $3,
                lease_expires_at = now() + make_interval(secs => $4)
          where t.id in (
            select id from osirus_intel.experiment_trials
             where experiment_id = $1::uuid and status = 'pending'
               and ($5::text[] is null or partition = any($5::text[]))
               and (lease_expires_at is null or lease_expires_at < now())
             order by created_at, id
             limit $2
             for update skip locked)
          returning t.*`,
        [experimentId, limit, owner, leaseSeconds, partitions ?? null],
      )
    ).map(trial);
  }
  async updateTrial(
    id: string,
    patch: Partial<Pick<Trial, "status" | "runId" | "attempts" | "result">> & {
      experienceId?: string | null;
    },
  ) {
    const params: unknown[] = [id];
    const sets = assignments(
      patch,
      {
        status: { column: "status" },
        runId: { column: "run_id", cast: "::uuid" },
        attempts: { column: "attempts" },
        result: { column: "result", cast: "::jsonb", json: true },
        experienceId: { column: "experience_id", cast: "::uuid" },
      },
      params,
    );
    if (patch.status && patch.status !== "pending")
      sets.push("lease_owner = null", "lease_expires_at = null");
    if (patch.status === "running")
      sets.push("started_at = coalesce(started_at, now())");
    if (
      patch.status === "completed" ||
      patch.status === "failed" ||
      patch.status === "skipped"
    )
      sets.push("finished_at = now()");
    if (!sets.length) return;
    await q(
      `update osirus_intel.experiment_trials set ${sets.join(", ")}
        where id = $1::uuid`,
      params,
    );
  }
  async runningTrials(limit: number) {
    return (
      await q(
        `select * from osirus_intel.experiment_trials
          where status = 'running' and run_id is not null
          order by started_at nulls first, id
          limit $1`,
        [limit],
      )
    ).map(trial);
  }

  async upsertAgendaItem(item: Omit<AgendaItem, "id">) {
    const [row] = await q(
      `insert into osirus_intel.research_agenda
         (capability_id, title, rationale, score, components, status)
       values ($1, $2, $3, $4, $5::jsonb, $6)
       on conflict (capability_id, title) do update set
         rationale = excluded.rationale, score = excluded.score,
         components = excluded.components, status = excluded.status,
         updated_at = now()
       returning *`,
      [
        item.capabilityId,
        item.title,
        item.rationale,
        item.score,
        json(item.components),
        item.status,
      ],
    );
    return agenda(row!);
  }
  async listAgenda() {
    return (
      await q(`select * from osirus_intel.research_agenda order by score desc`)
    ).map(agenda);
  }
  async updateAgendaItem(
    id: string,
    patch: Partial<
      Pick<AgendaItem, "status" | "score" | "components" | "rationale">
    >,
  ) {
    const params: unknown[] = [id];
    const sets = assignments(
      patch,
      {
        status: { column: "status" },
        score: { column: "score" },
        components: { column: "components", cast: "::jsonb", json: true },
        rationale: { column: "rationale" },
      },
      params,
    );
    if (!sets.length) return;
    await q(
      `update osirus_intel.research_agenda
          set ${sets.join(", ")}, updated_at = now()
        where id = $1::uuid`,
      params,
    );
  }

  async insertCycle(
    entry: Omit<ResearchCycle, "id" | "startedAt" | "completedAt">,
  ) {
    const [row] = await q(
      `insert into osirus_intel.research_cycles
         (status, phase, agenda_item_id, capability_id, state, summary)
       values ($1, $2, $3::uuid, $4, $5::jsonb, $6::jsonb)
       returning *`,
      [
        entry.status,
        entry.phase,
        entry.agendaItemId,
        entry.capabilityId,
        json(entry.state),
        json(entry.summary),
      ],
    );
    return cycle(row!);
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
    const params: unknown[] = [id];
    const sets = assignments(
      patch,
      {
        status: { column: "status" },
        phase: { column: "phase" },
        agendaItemId: { column: "agenda_item_id", cast: "::uuid" },
        capabilityId: { column: "capability_id" },
        state: { column: "state", cast: "::jsonb", json: true },
        summary: { column: "summary", cast: "::jsonb", json: true },
      },
      params,
    );
    if (patch.completed) sets.push("completed_at = now()");
    if (!sets.length) return;
    await q(
      `update osirus_intel.research_cycles
          set ${sets.join(", ")}, updated_at = now()
        where id = $1::uuid`,
      params,
    );
  }
  async leaseActiveCycle(owner: string, leaseSeconds: number) {
    const [row] = await q(
      `update osirus_intel.research_cycles c
          set lease_owner = $1,
              lease_expires_at = now() + make_interval(secs => $2)
        where c.id = (select id from osirus_intel.research_cycles
                       where status = 'running'
                       order by started_at limit 1
                       for update)
          and (c.lease_owner is null or c.lease_owner = $1
               or c.lease_expires_at < now())
        returning c.*`,
      [owner, leaseSeconds],
    );
    return row ? cycle(row) : null;
  }
  async releaseCycle(id: string, owner: string) {
    await q(
      `update osirus_intel.research_cycles
          set lease_owner = null, lease_expires_at = null
        where id = $1::uuid and lease_owner = $2`,
      [id, owner],
    );
  }
  async listCycles(limit = 20) {
    return (
      await q(
        `select * from osirus_intel.research_cycles
          order by started_at desc limit $1`,
        [limit],
      )
    ).map(cycle);
  }

  async insertPromotion(event: PromotionEvent) {
    await q(
      `insert into osirus_intel.promotion_events
         (strategy_version_id, from_status, to_status, canary_percent,
          evidence)
       values ($1::uuid, $2, $3, $4, $5::jsonb)`,
      [
        event.strategyVersionId,
        event.fromStatus,
        event.toStatus,
        event.canaryPercent,
        json(event.evidence),
      ],
    );
  }
  async listPromotions(limit = 50) {
    return (
      await q(
        `select * from osirus_intel.promotion_events
          order by created_at desc limit $1`,
        [limit],
      )
    ).map((row) => ({
      strategyVersionId: row.strategy_version_id as string,
      fromStatus: row.from_status as PromotionEvent["fromStatus"],
      toStatus: row.to_status as PromotionEvent["toStatus"],
      canaryPercent: num(row.canary_percent),
      evidence: row.evidence as Record<string, unknown>,
      createdAt: iso(row.created_at) ?? undefined,
    }));
  }

  async insertExperience(entry: Omit<Experience, "id" | "createdAt">) {
    const [row] = await q(
      `insert into osirus_intel.experience
         (source, task_ref, task_type, capability_ids, difficulty,
          strategy_version_id, model, skills, tools, trajectory,
          verification, outcome, failure_class, repairs, cost_usd, tokens,
          latency_ms, confidence, quality_score, fingerprint, partition,
          provenance)
       values ($1, $2, $3, $4::text[], $5, $6::uuid, $7, $8::text[],
               $9::text[], $10::jsonb, $11::jsonb, $12, $13, $14, $15, $16,
               $17, $18, $19, $20, $21, $22::jsonb)
       returning *`,
      [
        entry.source,
        entry.taskRef,
        entry.taskType,
        entry.capabilityIds,
        entry.difficulty,
        entry.strategyVersionId,
        entry.model,
        entry.skills,
        entry.tools,
        json(entry.trajectory),
        json(entry.verification),
        entry.outcome,
        entry.failureClass,
        entry.repairs,
        entry.costUsd,
        Math.round(entry.tokens),
        Math.round(entry.latencyMs),
        entry.confidence,
        entry.qualityScore,
        entry.fingerprint,
        entry.partition,
        json(entry.provenance),
      ],
    );
    return experience(row!);
  }
  async listExperience(filter: {
    capabilityId?: string;
    source?: Experience["source"];
    outcome?: Experience["outcome"];
    strategyVersionId?: string;
    since?: string;
    limit?: number;
  }) {
    return (
      await q(
        `select * from (
           select * from osirus_intel.experience
            where ($1::text is null or capability_ids @> array[$1::text])
              and ($2::text is null or source = $2)
              and ($3::text is null or outcome = $3)
              and ($4::uuid is null or strategy_version_id = $4::uuid)
              and ($5::timestamptz is null or created_at >= $5::timestamptz)
            order by created_at desc
            limit $6) recent
          order by created_at`,
        [
          filter.capabilityId ?? null,
          filter.source ?? null,
          filter.outcome ?? null,
          filter.strategyVersionId ?? null,
          filter.since ?? null,
          filter.limit ?? 500,
        ],
      )
    ).map(experience);
  }
  async experienceFingerprintExists(fingerprint: string) {
    const rows = await q(
      `select 1 from osirus_intel.experience where fingerprint = $1 limit 1`,
      [fingerprint],
    );
    return rows.length > 0;
  }

  async upsertArtifact(entry: Omit<LearningArtifact, "id">) {
    const [row] = await q(
      `insert into osirus_intel.learning_artifacts
         (cycle_id, kind, capability_id, task_pattern, content, evidence,
          support, status, fingerprint)
       values ($1::uuid, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8, $9)
       on conflict (kind, fingerprint) do update set
         content = excluded.content, evidence = excluded.evidence,
         support = greatest(osirus_intel.learning_artifacts.support,
                            excluded.support),
         status = excluded.status,
         cycle_id = coalesce(excluded.cycle_id,
                             osirus_intel.learning_artifacts.cycle_id),
         updated_at = now()
       returning *`,
      [
        entry.cycleId,
        entry.kind,
        entry.capabilityId,
        entry.taskPattern,
        json(entry.content),
        json(entry.evidence),
        entry.support,
        entry.status,
        entry.fingerprint,
      ],
    );
    return artifact(row!);
  }
  async listArtifacts(filter: {
    kind?: LearningArtifact["kind"];
    capabilityId?: string;
    status?: LearningArtifact["status"];
    limit?: number;
  }) {
    return (
      await q(
        `select * from (
           select * from osirus_intel.learning_artifacts
            where ($1::text is null or kind = $1)
              and ($2::text is null or capability_id = $2)
              and ($3::text is null or status = $3)
            order by created_at desc
            limit $4) recent
          order by created_at`,
        [
          filter.kind ?? null,
          filter.capabilityId ?? null,
          filter.status ?? null,
          filter.limit ?? 500,
        ],
      )
    ).map(artifact);
  }

  async insertGenerationRun(run: Omit<GenerationRun, "id">) {
    const [row] = await q(
      `insert into osirus_intel.generation_runs
         (cycle_id, kind, config, produced, verified, rejected, summary)
       values ($1::uuid, $2, $3::jsonb, $4, $5, $6, $7::jsonb)
       returning *`,
      [
        run.cycleId,
        run.kind,
        json(run.config),
        run.produced,
        run.verified,
        run.rejected,
        json(run.summary),
      ],
    );
    return generation(row!);
  }
  async listGenerationRuns(limit = 50) {
    return (
      await q(
        `select * from osirus_intel.generation_runs
          order by created_at desc limit $1`,
        [limit],
      )
    ).map(generation);
  }

  async ensureDataset(id: string, format: string, description: string) {
    await q(
      `insert into osirus_intel.datasets (id, format, description)
       values ($1, $2, $3) on conflict (id) do nothing`,
      [id, format, description],
    );
  }
  async insertDatasetVersion(input: {
    datasetId: string;
    counts: Record<string, number>;
    provenance: Record<string, unknown>;
    contamination: Record<string, unknown>;
    examples: DatasetExample[];
  }) {
    const [row] = await q(
      `with v as (
         insert into osirus_intel.dataset_versions
           (dataset_id, version, counts, provenance, contamination)
         values ($1,
                 (select coalesce(max(version), 0) + 1
                    from osirus_intel.dataset_versions where dataset_id = $1),
                 $2::jsonb, $3::jsonb, $4::jsonb)
         returning *),
       e as (
         insert into osirus_intel.dataset_examples
           (dataset_version_id, partition, input, output, experience_id,
            fingerprint)
         select v.id, x.partition, x.input, x.output, x.experience_id,
                x.fingerprint
           from v, jsonb_to_recordset($5::jsonb) as x(
             partition text, input jsonb, output jsonb, experience_id uuid,
             fingerprint text))
       select * from v`,
      [
        input.datasetId,
        json(input.counts),
        json(input.provenance),
        json(input.contamination),
        JSON.stringify(
          input.examples.map((example) => ({
            partition: example.partition,
            input: example.input,
            output: example.output,
            experience_id: example.experienceId,
            fingerprint: example.fingerprint,
          })),
        ),
      ],
    );
    return datasetVersion(row!);
  }
  async listDatasetVersions(limit = 50) {
    return (
      await q(
        `select * from osirus_intel.dataset_versions
          order by created_at desc limit $1`,
        [limit],
      )
    ).map(datasetVersion);
  }
  async datasetFingerprints(partition: DatasetExample["partition"]) {
    const rows = await q(
      `select distinct fingerprint from osirus_intel.dataset_examples
        where partition = $1`,
      [partition],
    );
    return new Set(rows.map((row) => row.fingerprint as string));
  }

  async upsertModel(entry: ModelRecord) {
    await q(
      `insert into osirus_intel.models
         (id, provider, model_id, family, modalities, context_tokens, free,
          status, updated_at)
       values ($1, $2, $3, $4, $5::text[], $6, $7, $8, now())
       on conflict (id) do update set
         provider = excluded.provider, model_id = excluded.model_id,
         family = excluded.family, modalities = excluded.modalities,
         context_tokens = excluded.context_tokens, free = excluded.free,
         status = excluded.status, updated_at = now()`,
      [
        entry.id,
        entry.provider,
        entry.modelId,
        entry.family,
        entry.modalities,
        entry.contextTokens,
        entry.free,
        entry.status,
      ],
    );
  }
  async listModels() {
    return (await q(`select * from osirus_intel.models order by id`)).map(
      model,
    );
  }
  async upsertModelStat(stat: ModelStat) {
    await q(
      `insert into osirus_intel.model_capability_stats
         (model_id, capability_id, trials, verified, mean_latency_ms,
          mean_cost_usd, champion, updated_at)
       values ($1, $2, $3, $4, $5, $6, $7, now())
       on conflict (model_id, capability_id) do update set
         trials = excluded.trials, verified = excluded.verified,
         mean_latency_ms = excluded.mean_latency_ms,
         mean_cost_usd = excluded.mean_cost_usd,
         champion = excluded.champion, updated_at = now()`,
      [
        stat.modelId,
        stat.capabilityId,
        stat.trials,
        stat.verified,
        stat.meanLatencyMs,
        stat.meanCostUsd,
        stat.champion,
      ],
    );
  }
  async listModelStats() {
    return (
      await q(
        `select * from osirus_intel.model_capability_stats
          order by capability_id, model_id`,
      )
    ).map(modelStat);
  }
}
