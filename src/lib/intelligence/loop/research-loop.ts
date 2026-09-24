import type { SandboxDriver } from "../../sandbox/driver";
import { detectGaps } from "../capabilities/gaps";
import { remeasureAll, seedCapabilities } from "../capabilities/registry";
import { armOfCapability } from "../capabilities/taxonomy";
import {
  DEFAULT_SUITE,
  nextLevel,
  stockSuite,
  type SuiteSize,
} from "../curriculum/generator";
import { buildDatasets } from "../datasets/builder";
import { verifyCodingLabel } from "../evals/labels";
import { fingerprint } from "../evals/random";
import { recordTrialExperience } from "../experience/engine";
import { decide, DECISION_RULE, screen } from "../experiments/analysis";
import type { TrialExecutor } from "../executors/executor";
import {
  allowance,
  charge,
  DEFAULT_CALLS_PER_TRIAL,
  pauseForProvider,
} from "../governor/governor";
import { compileExperience } from "../learning/compiler";
import { registerModels, updateModelCompetition } from "../models/registry";
import { crownChampion, transition } from "../promotion/promotion";
import {
  bugGeneratorRound,
  problemGeneratorRound,
  redRound,
} from "../generation/self-play";
import {
  buildChallengers,
  describeGenome,
  exploratoryMutation,
  hypothesesFor,
  seedStrategies,
  strategyForCapability,
} from "../strategies/genomes";
import type { IntelStore } from "../store/store";
import type {
  CyclePhase,
  EvalTask,
  Partition,
  ResearchCycle,
  StrategyVersion,
  Trial,
} from "../types";
import { pickAgendaItem, refreshAgenda } from "./agenda";

// The IntelligenceResearchLoop.
//
// One research cycle is a durable state machine in research_cycles:
//
//   measure → select_agenda → generate_data → baseline → analyze →
//   hypothesize → design → dev_eval → adversarial_eval → holdout_eval →
//   decide → update_registry → compile → next
//
// `foundryStep` advances the active cycle by bounded units until its
// deadline and checkpoints after each one, so a cycle survives deployments,
// crashes and provider outages: whatever worker takes the next step picks up
// exactly where the last one stopped. When a cycle ends it names the next
// agenda item, and the next step starts that cycle. Nobody designs the next
// experiment by hand.

export type LoopContext = {
  store: IntelStore;
  executor: TrialExecutor;
  owner: string;
  deadline: number;
  signal: AbortSignal;
  /** Label verification and self-play need a sandbox; optional elsewhere. */
  sandbox?: () => Promise<SandboxDriver>;
  suite?: SuiteSize;
  maxChallengers?: number;
  productModels?: string[];
  /** Pin the agenda to one capability (the CI cycle runner does this). */
  focusCapability?: string;
  log?: (line: string) => void;
};

export type StepReport = {
  cycleId: string | null;
  phase: CyclePhase | "idle";
  progressed: number;
  waiting: string | null;
  completedCycle: boolean;
};

const LEASE_SECONDS = 330;
const MAX_LEVEL_UPS = 2;

function note(cycle: ResearchCycle, phase: CyclePhase, text: string) {
  const log = [
    ...(cycle.state.log ?? []),
    { at: new Date().toISOString(), phase, note: text },
  ];
  cycle.state.log = log.slice(-80);
}

async function save(
  ctx: LoopContext,
  cycle: ResearchCycle,
  patch: Partial<ResearchCycle> = {},
) {
  Object.assign(cycle, patch);
  await ctx.store.updateCycle(cycle.id, {
    phase: cycle.phase,
    status: cycle.status,
    agendaItemId: cycle.agendaItemId,
    capabilityId: cycle.capabilityId,
    state: cycle.state,
    summary: cycle.summary,
    completed: cycle.status === "completed" || cycle.status === "failed",
  });
}

async function championOf(store: IntelStore, strategyId: string) {
  const versions = await store.listVersions(strategyId);
  return versions.find((version) => version.status === "champion") ?? null;
}

async function levelOf(store: IntelStore, capabilityId: string) {
  const artifacts = await store.listArtifacts({
    kind: "curriculum_task",
    capabilityId,
    limit: 50,
  });
  const level = artifacts.find(
    (artifact) => artifact.fingerprint === fingerprint("level", capabilityId),
  );
  return Number(level?.content.level ?? 0);
}

async function setLevel(
  store: IntelStore,
  capabilityId: string,
  level: number,
  cycleId: string,
  reason: string,
) {
  await store.upsertArtifact({
    cycleId,
    kind: "curriculum_task",
    capabilityId,
    taskPattern: "level",
    content: { level, reason },
    evidence: {},
    support: 1,
    status: "active",
    fingerprint: fingerprint("level", capabilityId),
  });
}

/** Tasks of a partition the experiment may use: labels verified only. */
async function usableTasks(
  store: IntelStore,
  capabilityId: string,
  partition: Partition,
  want: number,
  level: number,
) {
  const tasks = await store.listTasks({ capabilityId, partition, limit: 500 });
  const verified = tasks.filter((task) => task.labelVerified);
  // Prefer the current curriculum level's tasks (by difficulty), then others.
  const sorted = verified.sort(
    (a, b) =>
      Math.abs(a.difficultyScore - (4 + level)) -
      Math.abs(b.difficultyScore - (4 + level)),
  );
  return sorted.slice(0, want);
}

/** Run or collect trials until none are left, the deadline nears, or budget ends. */
async function runTrials(
  ctx: LoopContext,
  experimentId: string,
  partitions: Partition[],
): Promise<{ done: boolean; progressed: number; waiting: string | null }> {
  const { store } = ctx;
  const settings = await store.settings();
  let progressed = 0;
  const model = settings.foundryModel;

  // Durable runs first: collect whatever has settled.
  if (ctx.executor.collect) {
    for (const trial of (await store.listTrials(experimentId)).filter(
      (entry) => entry.status === "running",
    )) {
      const task = await store.getTask(trial.evalTaskId);
      if (!task) continue;
      const result = await ctx.executor.collect(trial, task).catch(() => null);
      if (!result) continue;
      progressed += await settleTrial(ctx, trial, task, result, model);
    }
  }

  while (Date.now() < ctx.deadline - 5_000 && !ctx.signal.aborted) {
    // Re-read each time: a refusal collected above may have paused us.
    const budget = await allowance(store, await store.settings(), {
      modelCalls: DEFAULT_CALLS_PER_TRIAL,
    });
    if (!budget.allowed)
      return { done: false, progressed, waiting: budget.reason };
    const running = (await store.listTrials(experimentId)).filter(
      (trial) => trial.status === "running",
    ).length;
    if (running >= Math.max(1, settings.budgets.parallelTrials))
      return { done: false, progressed, waiting: "Waiting for running trials" };
    const [trial] = await store.claimTrials(
      experimentId,
      1,
      ctx.owner,
      LEASE_SECONDS,
      partitions,
    );
    if (!trial) break;
    const [task, version] = await Promise.all([
      store.getTask(trial.evalTaskId),
      store.getVersion(trial.strategyVersionId),
    ]);
    if (!task || !version) {
      await store.updateTrial(trial.id, { status: "skipped" });
      continue;
    }
    await store.updateTrial(trial.id, {
      status: "running",
      attempts: trial.attempts + 1,
    });
    ctx.log?.(
      `trial ${task.partition} ${task.spec.kind} ${version.strategyId} v${version.version} → ${task.id.slice(0, 8)}`,
    );
    const outcome = await ctx.executor
      .execute({ trial, task, version, model, signal: ctx.signal })
      .catch((error: unknown) => ({
        status: "failed" as const,
        error: error instanceof Error ? error.message : String(error),
      }));
    if (outcome.status === "running") {
      await store.updateTrial(trial.id, {
        status: "running",
        runId: outcome.runId,
      });
      progressed += 1;
      continue;
    }
    if (outcome.status === "failed") {
      await store.updateTrial(trial.id, {
        status: trial.attempts + 1 >= 2 ? "failed" : "pending",
      });
      ctx.log?.(`  executor error: ${outcome.error.slice(0, 200)}`);
      continue;
    }
    progressed += await settleTrial(
      ctx,
      { ...trial, attempts: trial.attempts + 1 },
      task,
      outcome.result,
      model,
      version,
    );
    if (outcome.result.failureClass?.startsWith("provider:")) {
      const pause = (await store.settings()).providerPause;
      return {
        done: false,
        progressed,
        waiting: `Provider paused until ${pause?.until ?? "later"} (${outcome.result.failureClass})`,
      };
    }
  }

  const left = (await store.listTrials(experimentId)).filter(
    (trial) =>
      partitions.includes(trial.partition) &&
      (trial.status === "pending" || trial.status === "running"),
  );
  return {
    done: left.length === 0,
    progressed,
    waiting: left.length ? "Trials remaining" : null,
  };
}

async function settleTrial(
  ctx: LoopContext,
  trial: Trial,
  task: EvalTask,
  result: NonNullable<Trial["result"]>,
  model: string,
  known?: StrategyVersion,
) {
  const { store } = ctx;
  const version = known ?? (await store.getVersion(trial.strategyVersionId));
  if (!version) return 0;
  // A provider refusal is not evidence about the strategy. The trial goes
  // back in the queue as if it had not run, and the Foundry pauses for as
  // long as the provider asked instead of burning the rest of the suite.
  if (result.failureClass?.startsWith("provider:")) {
    await store.updateTrial(trial.id, {
      status: "pending",
      attempts: Math.max(0, trial.attempts - 1),
    });
    await charge(store, {
      model_calls: result.modelCalls,
      tokens: result.tokens,
    });
    const until = await pauseForProvider(
      store,
      result.failureClass.slice("provider:".length),
      result.notes,
    );
    ctx.log?.(
      `  provider refused (${result.failureClass}); trial re-queued, Foundry paused until ${until.toISOString()}`,
    );
    return 1;
  }
  const experience = await recordTrialExperience(store, {
    task,
    version,
    model,
    result,
  });
  await store.updateTrial(trial.id, {
    status: "completed",
    result,
    experienceId: experience.id,
  });
  await charge(store, {
    model_calls: result.modelCalls,
    tokens: result.tokens,
    cost_usd: result.costUsd,
    trials: 1,
    sandbox_minutes:
      task.spec.kind === "coding" ? Math.ceil(result.latencyMs / 60_000) : 0,
  });
  ctx.log?.(
    `  ${result.verified ? "VERIFIED" : "failed"} (${result.failureClass ?? "ok"}) calls=${result.modelCalls} ${Math.round(result.latencyMs / 1000)}s`,
  );
  return 1;
}

export async function foundryStep(ctx: LoopContext): Promise<StepReport> {
  const { store } = ctx;
  const settings = await store.settings();
  if (!settings.flags.intelligencePlane || !settings.flags.experiments)
    return {
      cycleId: null,
      phase: "idle",
      progressed: 0,
      waiting: "Foundry disabled",
      completedCycle: false,
    };

  if ((await store.listCapabilities()).length === 0) {
    await seedCapabilities(store);
    await registerModels(store, {
      foundryModel: settings.foundryModel,
      productModels: ctx.productModels ?? [],
    });
  }
  await seedStrategies(store, settings.foundryModel);

  let cycle = await store.leaseActiveCycle(ctx.owner, LEASE_SECONDS);
  if (!cycle) {
    const running = (await store.listCycles(1))[0];
    if (running?.status === "running")
      return {
        cycleId: running.id,
        phase: running.phase,
        progressed: 0,
        waiting: "Another worker holds the cycle",
        completedCycle: false,
      };
    const created = await store.insertCycle({
      status: "running",
      phase: "measure",
      agendaItemId: null,
      capabilityId: null,
      state: {},
      summary: running?.summary.next ? { previous: running.id } : {},
    });
    cycle = await store.leaseActiveCycle(ctx.owner, LEASE_SECONDS);
    if (!cycle)
      return {
        cycleId: created.id,
        phase: "measure",
        progressed: 0,
        waiting: "Cycle lease busy",
        completedCycle: false,
      };
    ctx.log?.(`cycle ${cycle.id.slice(0, 8)} started`);
  }

  let progressed = 0;
  let waiting: string | null = null;
  let completedCycle = false;
  try {
    while (
      Date.now() < ctx.deadline - 5_000 &&
      !ctx.signal.aborted &&
      cycle.status === "running"
    ) {
      const before = cycle.phase;
      const result = await advance(ctx, cycle);
      progressed += result.progressed;
      waiting = result.waiting;
      if (cycle.status !== "running") completedCycle = true;
      if (waiting || cycle.phase === before) break;
    }
  } catch (error) {
    note(
      cycle,
      cycle.phase,
      `step failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    await save(ctx, cycle);
    throw error;
  } finally {
    await store.releaseCycle(cycle.id, ctx.owner);
  }
  return {
    cycleId: cycle.id,
    phase: cycle.phase,
    progressed,
    waiting,
    completedCycle,
  };
}

async function advance(
  ctx: LoopContext,
  cycle: ResearchCycle,
): Promise<{ progressed: number; waiting: string | null }> {
  const { store } = ctx;
  const settings = await store.settings();
  const suite = ctx.suite ?? DEFAULT_SUITE;
  const go = async (phase: CyclePhase, text: string) => {
    note(cycle, cycle.phase, text);
    ctx.log?.(`[${cycle.phase}] ${text}`);
    cycle.phase = phase;
    await save(ctx, cycle);
  };

  switch (cycle.phase) {
    case "measure": {
      const changes = await remeasureAll(store);
      await go(
        "select_agenda",
        changes.length
          ? `Capability status changed: ${changes.map((change) => `${change.id} ${change.from}→${change.to}`).join(", ")}`
          : "Registry re-measured; no status changed.",
      );
      return { progressed: 1, waiting: null };
    }

    case "select_agenda": {
      const items = await refreshAgenda(store);
      const previous = (await store.listCycles(3)).find(
        (entry) => entry.id !== cycle.id && entry.status === "completed",
      );
      const preferred = previous?.summary.next as
        { capabilityId?: string } | undefined;
      const focused = ctx.focusCapability
        ? items.find((entry) => entry.capabilityId === ctx.focusCapability)
        : undefined;
      const item =
        focused ||
        (preferred?.capabilityId &&
          items.find(
            (entry) =>
              entry.capabilityId === preferred.capabilityId &&
              entry.status !== "parked",
          )) ||
        pickAgendaItem(items, previous?.capabilityId);
      if (!item) {
        await go("next", "No researchable capability on the agenda.");
        return { progressed: 1, waiting: null };
      }
      await store.updateAgendaItem(item.id, { status: "active" });
      cycle.agendaItemId = item.id;
      cycle.capabilityId = item.capabilityId;
      await go(
        "generate_data",
        `Selected "${item.title}" (score ${item.score}): ${item.rationale}`,
      );
      return { progressed: 1, waiting: null };
    }

    case "generate_data": {
      const capabilityId = cycle.capabilityId!;
      const level = await levelOf(store, capabilityId);
      const stocked = await stockSuite(store, capabilityId, {
        size: suite,
        level,
      });
      let verified = 0;
      let failed = 0;
      if (ctx.sandbox)
        for (const task of [
          ...stocked.dev,
          ...stocked.adversarial,
          ...stocked.holdout,
        ]) {
          if (task.labelVerified || task.spec.verify.kind !== "tests") continue;
          if (Date.now() > ctx.deadline - 30_000) break;
          const label = await verifyCodingLabel(
            task,
            ctx.sandbox,
            ctx.signal,
          ).catch((error: unknown) => ({
            verified: false,
            evidence: {
              error: error instanceof Error ? error.message : String(error),
            },
          }));
          await store.updateTaskLabel(task.id, label.verified, label.evidence);
          if (label.verified) verified += 1;
          else failed += 1;
        }
      const pending =
        [...stocked.dev, ...stocked.adversarial, ...stocked.holdout].filter(
          (task) => !task.labelVerified && task.spec.verify.kind === "tests",
        ).length -
        verified -
        failed;
      if (pending > 0 && ctx.sandbox)
        return { progressed: verified + failed, waiting: null };
      await go(
        "baseline",
        `Suite stocked at level ${level}: ${stocked.dev.length} dev, ${stocked.adversarial.length} adversarial, ${stocked.holdout.length} holdout (${stocked.generated} stored); labels verified now ${verified}, rejected ${failed}.`,
      );
      return { progressed: 1, waiting: null };
    }

    case "baseline": {
      const capabilityId = cycle.capabilityId!;
      const strategy = strategyForCapability(capabilityId);
      if (!strategy) {
        await go("next", `No strategy owns ${capabilityId}.`);
        return { progressed: 1, waiting: null };
      }
      const champion = await championOf(store, strategy.id);
      if (!champion) throw new Error(`no champion for ${strategy.id}`);
      if (!cycle.state.experimentId) {
        const level = await levelOf(store, capabilityId);
        const dev = await usableTasks(
          store,
          capabilityId,
          "dev",
          suite.dev,
          level,
        );
        if (dev.length === 0) {
          await go(
            "next",
            `No label-verified dev tasks for ${capabilityId}; nothing to measure.`,
          );
          return { progressed: 1, waiting: null };
        }
        const experiment = await store.insertExperiment({
          cycleId: cycle.id,
          capabilityId,
          strategyId: strategy.id,
          observation: { level, devTasks: dev.map((task) => task.id) },
          hypotheses: [],
          design: {
            partitions: ["dev", "adversarial", "holdout"],
            minPaired: 3,
            maxReplicates: 1,
            decisionRule: DECISION_RULE,
          },
          conclusion: null,
          status: "running",
          championVersionId: champion.id,
          challengerVersionIds: [],
        });
        await store.insertTrials(
          dev.map((task) => ({
            experimentId: experiment.id,
            strategyVersionId: champion.id,
            evalTaskId: task.id,
            partition: "dev" as const,
            replicate: 1,
          })),
        );
        cycle.state.experimentId = experiment.id;
        note(
          cycle,
          "baseline",
          `Measuring champion ${strategy.id} v${champion.version} (${describeGenome(champion.genome)}) on ${dev.length} dev tasks.`,
        );
        await save(ctx, cycle);
      }
      const run = await runTrials(ctx, cycle.state.experimentId, ["dev"]);
      if (!run.done) return run;
      await go("analyze", "Champion baseline measured.");
      return { progressed: run.progressed + 1, waiting: null };
    }

    case "analyze": {
      const experiment = await store.getExperiment(cycle.state.experimentId!);
      const trials = await store.listTrials(experiment!.id);
      const championTrials = trials.filter(
        (trial) =>
          trial.strategyVersionId === experiment!.championVersionId &&
          trial.status === "completed",
      );
      const verified = championTrials.filter(
        (trial) => trial.result?.verified,
      ).length;
      const rows = await store.listExperience({
        capabilityId: cycle.capabilityId!,
        limit: 400,
      });
      const gaps = await detectGaps(
        store,
        cycle.capabilityId!,
        rows.filter((row) => row.outcome !== "verified_success"),
      );
      cycle.state.gapIds = gaps.map((gap) => gap.id);
      const levelUps = Number(cycle.summary.levelUps ?? 0);
      if (
        championTrials.length &&
        verified === championTrials.length &&
        levelUps < MAX_LEVEL_UPS
      ) {
        const level = await levelOf(store, cycle.capabilityId!);
        const up = nextLevel(level, verified, championTrials.length);
        await setLevel(
          store,
          cycle.capabilityId!,
          up,
          cycle.id,
          `Champion solved ${verified}/${championTrials.length} at level ${level}.`,
        );
        await store.updateExperiment(experiment!.id, { status: "aborted" });
        cycle.summary.levelUps = levelUps + 1;
        cycle.state.experimentId = undefined;
        await go(
          "generate_data",
          `Champion solved every dev task (${verified}/${championTrials.length}); curriculum raised to level ${up}.`,
        );
        return { progressed: 1, waiting: null };
      }
      await go(
        "hypothesize",
        `Champion verified ${verified}/${championTrials.length} dev tasks. Gaps: ${
          gaps
            .slice(0, 4)
            .map((gap) => `${gap.kind} "${gap.summary}" ×${gap.support}`)
            .join("; ") || "none detected"
        }.`,
      );
      return { progressed: 1, waiting: null };
    }

    case "hypothesize": {
      const experiment = await store.getExperiment(cycle.state.experimentId!);
      const champion = await store.getVersion(experiment!.championVersionId);
      const gaps = (await store.listGaps(cycle.capabilityId!)).filter((gap) =>
        (cycle.state.gapIds ?? []).includes(gap.id),
      );
      const arm = armOfCapability(
        cycle.capabilityId!,
      ) as StrategyVersion["kind"];
      const limit = Math.max(1, (ctx.maxChallengers ?? 2) - 1);
      const hypotheses = settings.flags.strategyEvolution
        ? hypothesesFor(arm, gaps, champion!.genome, limit)
        : [];
      if (
        settings.flags.strategyEvolution &&
        hypotheses.length < (ctx.maxChallengers ?? 2)
      ) {
        const explore = exploratoryMutation(
          arm,
          champion!.genome,
          `${cycle.id}:${hypotheses.length}`,
        );
        if (explore) hypotheses.push(explore);
      }
      cycle.state.hypotheses = hypotheses;
      await store.updateExperiment(experiment!.id, { hypotheses });
      if (!hypotheses.length) {
        await store.updateExperiment(experiment!.id, { status: "concluded" });
        await go(
          "update_registry",
          "No hypothesis to test (strategy evolution off or genome space exhausted).",
        );
        return { progressed: 1, waiting: null };
      }
      await go(
        "design",
        `Hypotheses: ${hypotheses.map((hypothesis) => `[${hypothesis.gap}] ${hypothesis.statement}`).join(" | ")}`,
      );
      return { progressed: 1, waiting: null };
    }

    case "design": {
      const experiment = await store.getExperiment(cycle.state.experimentId!);
      const champion = await store.getVersion(experiment!.championVersionId);
      const challengers = await buildChallengers(store, {
        champion: champion!,
        hypotheses: cycle.state.hypotheses ?? [],
        model: settings.foundryModel,
      });
      await store.updateExperiment(experiment!.id, {
        challengerVersionIds: challengers.map((version) => version.id),
      });
      const devTaskIds = (await store.listTrials(experiment!.id))
        .filter(
          (trial) =>
            trial.partition === "dev" &&
            trial.strategyVersionId === champion!.id,
        )
        .map((trial) => trial.evalTaskId);
      await store.insertTrials(
        challengers.flatMap((version) =>
          devTaskIds.map((taskId) => ({
            experimentId: experiment!.id,
            strategyVersionId: version.id,
            evalTaskId: taskId,
            partition: "dev" as const,
            replicate: 1,
          })),
        ),
      );
      await go(
        "dev_eval",
        `Challengers: ${challengers.map((version) => `v${version.version} (${describeGenome(version.genome)})`).join(", ")} on the same ${devTaskIds.length} dev tasks.`,
      );
      return { progressed: 1, waiting: null };
    }

    case "dev_eval": {
      const run = await runTrials(ctx, cycle.state.experimentId!, ["dev"]);
      if (!run.done) return run;
      const experiment = await store.getExperiment(cycle.state.experimentId!);
      const trials = await store.listTrials(experiment!.id);
      const screened = screen(
        trials,
        experiment!.championVersionId,
        experiment!.challengerVersionIds,
      );
      const finalist = screened[0]?.id ?? null;
      cycle.state.bestChallengerId = finalist;
      if (!finalist) {
        await go("decide", "No challenger passed the dev screen.");
        return { progressed: run.progressed + 1, waiting: null };
      }
      const level = await levelOf(store, cycle.capabilityId!);
      const adversarial = await usableTasks(
        store,
        cycle.capabilityId!,
        "adversarial",
        suite.adversarial,
        level,
      );
      const holdout = await usableTasks(
        store,
        cycle.capabilityId!,
        "holdout",
        suite.holdout,
        level,
      );
      await store.insertTrials(
        [experiment!.championVersionId, finalist].flatMap((versionId) => [
          ...adversarial.map((task) => ({
            experimentId: experiment!.id,
            strategyVersionId: versionId,
            evalTaskId: task.id,
            partition: "adversarial" as const,
            replicate: 1,
          })),
          ...holdout.map((task) => ({
            experimentId: experiment!.id,
            strategyVersionId: versionId,
            evalTaskId: task.id,
            partition: "holdout" as const,
            replicate: 1,
          })),
        ]),
      );
      await go(
        "adversarial_eval",
        `Finalist v${(await store.getVersion(finalist))?.version} (P(better) on dev ${screened[0]!.probabilityBetter.toFixed(2)}); ${adversarial.length} adversarial and ${holdout.length} holdout tasks scheduled for it and the champion.`,
      );
      return { progressed: run.progressed + 1, waiting: null };
    }

    case "adversarial_eval": {
      const run = await runTrials(ctx, cycle.state.experimentId!, [
        "adversarial",
      ]);
      if (!run.done) return run;
      await go("holdout_eval", "Adversarial trials finished.");
      return { progressed: run.progressed + 1, waiting: null };
    }

    case "holdout_eval": {
      const run = await runTrials(ctx, cycle.state.experimentId!, ["holdout"]);
      if (!run.done) return run;
      await go("decide", "Holdout trials finished.");
      return { progressed: run.progressed + 1, waiting: null };
    }

    case "decide": {
      const experiment = await store.getExperiment(cycle.state.experimentId!);
      const trials = await store.listTrials(experiment!.id);
      const decision = decide(
        trials,
        experiment!.championVersionId,
        experiment!.challengerVersionIds,
        cycle.state.bestChallengerId ?? null,
      );
      await store.updateExperiment(experiment!.id, {
        status: "concluded",
        conclusion: decision,
      });
      cycle.state.decision = decision;
      const champion = await store.getVersion(experiment!.championVersionId);
      for (const id of experiment!.challengerVersionIds) {
        const version = await store.getVersion(id);
        if (!version) continue;
        if (
          decision.outcome === "improved" &&
          id === decision.winnerVersionId
        ) {
          const winner = await crownChampion(store, version, {
            decision: decision.summary,
            experimentId: experiment!.id,
            replaced: champion
              ? `${champion.strategyId} v${champion.version}`
              : null,
          });
          await store.updateVersion(winner.id, {
            metrics: {
              decision: decision.summary,
              comparisons: decision.comparisons.filter(
                (entry) => entry.versionId === id,
              ),
            },
          });
        } else if (version.status === "experimental") {
          await transition(store, version, "rejected", {
            decision: decision.outcome,
            summary: decision.summary,
          });
        }
      }
      const winner = decision.winnerVersionId
        ? await store.getVersion(decision.winnerVersionId)
        : null;
      const regressions = decision.comparisons.filter(
        (entry) =>
          entry.versionId === decision.winnerVersionId &&
          entry.challenger.verified < entry.champion.verified,
      );
      cycle.summary.whyImproved = winner
        ? {
            changed: `${describeGenome(champion!.genome)} → ${describeGenome(winner.genome)}`,
            capability: cycle.capabilityId,
            evaluation: decision.comparisons
              .filter((entry) => entry.versionId === winner.id)
              .map(
                (entry) =>
                  `${entry.partition}: ${entry.challenger.verified}/${entry.tasks} vs ${entry.champion.verified}/${entry.tasks}`,
              ),
            tasks: decision.comparisons
              .filter((entry) => entry.versionId === winner.id)
              .reduce((sum, entry) => sum + entry.tasks, 0),
            model: winner.model,
            modelCallRatio:
              decision.comparisons.find(
                (entry) =>
                  entry.versionId === winner.id && entry.partition === "dev",
              )?.costRatio ?? null,
            regressions: regressions.map(
              (entry) =>
                `${entry.partition}: ${entry.challenger.verified} vs ${entry.champion.verified}`,
            ),
            replaced: `${champion!.strategyId} v${champion!.version}`,
            by: `${winner.strategyId} v${winner.version}`,
          }
        : null;
      cycle.summary.decision = {
        outcome: decision.outcome,
        summary: decision.summary,
      };
      await go(
        "update_registry",
        `Decision: ${decision.outcome}. ${decision.summary}`,
      );
      return { progressed: 1, waiting: null };
    }

    case "update_registry": {
      await remeasureAll(store);
      const rows = await store.listExperience({ source: "trial", limit: 2000 });
      await updateModelCompetition(store, rows);
      const agenda = (await store.listAgenda()).find(
        (item) => item.id === cycle.agendaItemId,
      );
      if (agenda) {
        const improved = cycle.state.decision?.outcome === "improved";
        const potential = improved
          ? 1
          : Number((agenda.components.potential * 0.6).toFixed(3));
        await store.updateAgendaItem(agenda.id, {
          components: { ...agenda.components, potential },
          status: potential < 0.3 ? "parked" : "open",
        });
      }
      await go("compile", "Registry, model competition and agenda updated.");
      return { progressed: 1, waiting: null };
    }

    case "compile": {
      const experiment = cycle.state.experimentId
        ? await store.getExperiment(cycle.state.experimentId)
        : null;
      const trials = experiment ? await store.listTrials(experiment.id) : [];
      const taskIds = [...new Set(trials.map((trial) => trial.evalTaskId))];
      const tasks = new Map<string, EvalTask>();
      for (const id of taskIds) {
        const task = await store.getTask(id);
        if (task) tasks.set(id, task);
      }
      const versions = new Map<string, StrategyVersion>();
      for (const version of await store.listVersions(experiment?.strategyId))
        versions.set(version.id, version);
      const experience = (
        await store.listExperience({
          capabilityId: cycle.capabilityId!,
          limit: 2000,
        })
      ).filter((row) => row.taskRef && tasks.has(row.taskRef));
      const notes: string[] = [];
      if (settings.flags.compilation && experiment) {
        const champion = versions.get(experiment.championVersionId)!;
        const artifacts = await compileExperience(store, {
          cycleId: cycle.id,
          capabilityId: cycle.capabilityId!,
          experience,
          tasks,
          versions,
          champion,
          decision: cycle.state.decision ?? null,
          gaps: (await store.listGaps(cycle.capabilityId!)).filter((gap) =>
            (cycle.state.gapIds ?? []).includes(gap.id),
          ),
        });
        notes.push(`${artifacts.length} learning artifacts`);
        const datasets = await buildDatasets(store, {
          capabilityId: cycle.capabilityId!,
          tasks,
          experience,
        });
        notes.push(
          `datasets: ${datasets.map((set) => `${set.datasetId}${set.version ? ` v${set.version}` : " (empty)"}`).join(", ")}`,
        );
        const championTrials = trials.filter(
          (trial) =>
            trial.strategyVersionId === experiment.championVersionId &&
            trial.partition === "dev" &&
            trial.status === "completed",
        );
        const level = await levelOf(store, cycle.capabilityId!);
        const next = nextLevel(
          level,
          championTrials.filter((trial) => trial.result?.verified).length,
          championTrials.length,
        );
        if (next !== level) {
          await setLevel(
            store,
            cycle.capabilityId!,
            next,
            cycle.id,
            `Curriculum moved after the cycle's baseline.`,
          );
          notes.push(`curriculum level ${level}→${next}`);
        }
      }
      if (settings.flags.selfPlay) {
        if (
          cycle.capabilityId === "coding.debug" &&
          ctx.sandbox &&
          Date.now() < ctx.deadline - 60_000
        ) {
          const round = await bugGeneratorRound(store, {
            sandbox: ctx.sandbox,
            limit: 2,
            cycleId: cycle.id,
            signal: ctx.signal,
          });
          notes.push(
            `self-play (bug generator): ${round.verified} verified of ${round.produced} mutants`,
          );
        }
        if (cycle.capabilityId === "math.quantitative") {
          const round = await problemGeneratorRound(store, {
            round: (await store.listGenerationRuns(200)).length,
            perFamily: 1,
            cycleId: cycle.id,
          });
          notes.push(
            `self-play (problem generator): ${round.verified} new problems`,
          );
        }
      }
      if (settings.flags.redIntelligence) {
        const red = await redRound(store, {
          cycleId: cycle.id,
          level: await levelOf(store, cycle.capabilityId!),
        });
        notes.push(`red intelligence: ${red.stored} adversarial tasks`);
      }
      await go("next", notes.join("; ") || "Compilation off.");
      return { progressed: 1, waiting: null };
    }

    case "next": {
      const items = await refreshAgenda(store);
      const next = pickAgendaItem(items, cycle.capabilityId);
      cycle.summary.next = next
        ? {
            agendaItemId: next.id,
            capabilityId: next.capabilityId,
            title: next.title,
          }
        : null;
      cycle.status = "completed";
      await go(
        "next",
        next ? `Next research target: ${next.title}.` : "Agenda empty.",
      );
      return { progressed: 1, waiting: null };
    }
  }
}
