import { randomUUID } from "node:crypto";
import type { PulseStore } from "../../agent/pulse/store";
import type { PulseCycle, PulseResult } from "../../agent/pulse/types";
import {
  countsAsSample,
  isVerified,
  toExperienceOutcome,
} from "../../verification/outcome";
import { seedCapabilities } from "../capabilities/registry";
import { curriculumRequests, stockCurriculum } from "../curriculum/adaptive";
import { fingerprint } from "../evals/random";
import { decide } from "../experiments/analysis";
import { recordExperimentMeta } from "../meta/foundry-meta";
import {
  mechanismOf,
  orderByMetaPolicy,
  type Mechanism,
} from "../meta/meta-policy";
import { loadMetaPolicy } from "../meta/foundry-meta";
import { crownChampion, transition } from "../promotion/promotion";
import {
  hypothesesFor,
  seedStrategies,
  strategyForCapability,
} from "../strategies/genomes";
import type { IntelStore } from "../store/store";
import type {
  CapabilityGap,
  GapKind,
  Hypothesis,
  LearningArtifact,
  StrategyVersion,
  Trial,
} from "../types";
import { SELF_PLAY_ARENAS, RED_ARENAS } from "../generation/arenas";
import {
  generatorScore,
  nextLevel,
  playArena,
  type ArenaRound,
  type ChallengeArena,
} from "../generation/challenges";
import { RSI_MIN_CALLS_PER_ORDER, rsiBudget } from "./budget";
import type {
  RsiCycle,
  RsiFinding,
  RsiHypothesis,
  RsiHypothesisClass,
  RsiPhase,
  RsiState,
  WeakCell,
} from "./types";

// The phases of one Recursive Intelligence Cycle. Each takes the state the
// earlier phases left and returns the state to commit with the cursor. A
// phase is bounded and deterministic; only EXPERIMENT touches a model, and
// only through a live order the Actions runner executes within the cycle's
// call envelope.

export type RsiContext = {
  intel: IntelStore;
  pulse: PulseStore;
  cycle: RsiCycle;
  previous: RsiCycle | null;
  now: () => number;
  /** Model used for live orders; the free model by operator decision. */
  model: string;
  selfPlayArenas?: ChallengeArena[];
  redArenas?: ChallengeArena[];
  /** Arenas per cycle and instances per arena. */
  selfPlayPerCycle?: number;
  redPerCycle?: number;
  instancesPerArena?: number;
};

export type PhaseResult = { state: RsiState; note: string };

export const FAMILY_CAPABILITY: Record<string, string> = {
  THINKING: "reasoning.planning",
  REASONING: "reasoning.planning",
  CODING: "coding.debug",
  RESEARCH: "research.citations",
  MATH_SCIENCE: "math.quantitative",
  BUILDING: "tool.workspace",
  COMPUTER: "tool.workspace",
  TOOL_USE: "tool.workspace",
  MULTIMODAL: "tool.search",
  MEMORY_CONTEXT: "memory.context",
  CROSS_DOMAIN: "reasoning.cross_domain",
  LONG_HORIZON: "planning.long_horizon",
  SELF_PLAY: "reasoning.falsification",
  SOFTWARE_RSI: "security.adversarial",
  ARCHITECTURE_SEARCH: "reasoning.planning",
};

const FAMILY_GAP: Record<string, GapKind> = {
  THINKING: "planning",
  REASONING: "planning",
  CODING: "execution",
  RESEARCH: "verification",
  MATH_SCIENCE: "verification",
  BUILDING: "tool",
  COMPUTER: "tool",
  TOOL_USE: "tool",
  MULTIMODAL: "tool",
  MEMORY_CONTEXT: "memory",
  CROSS_DOMAIN: "verification",
  LONG_HORIZON: "planning",
  SELF_PLAY: "verification",
  SOFTWARE_RSI: "verification",
  ARCHITECTURE_SEARCH: "planning",
};

const HOUR = 3_600_000;

function hourOf(ctx: RsiContext) {
  return Math.floor(Date.parse(ctx.cycle.startedAt) / HOUR);
}

/** Pulse cycles completed since the previous RIC cycle began (max 6). */
async function recentPulseCycles(ctx: RsiContext): Promise<PulseCycle[]> {
  const since = ctx.previous
    ? Date.parse(ctx.previous.startedAt)
    : ctx.now() - 24 * HOUR;
  return (await ctx.pulse.recentCycles(12))
    .filter(
      (cycle) =>
        cycle.status === "completed" &&
        cycle.completedAt &&
        Date.parse(cycle.completedAt) > since,
    )
    .slice(0, 6);
}

// ----- 1 HEALTH ------------------------------------------------------------

export async function health(ctx: RsiContext): Promise<PhaseResult> {
  await seedCapabilities(ctx.intel);
  await seedStrategies(ctx.intel, ctx.model);
  const last = await ctx.pulse.lastCompleted();
  const results = last ? await ctx.pulse.cycleResults(last.id) : [];
  const baselines = last ? await ctx.pulse.baselines(last.suiteVersion) : [];
  const weakCells: WeakCell[] = baselines
    .filter(
      (entry) =>
        entry.samples > 0 && (entry.rate < 1 || entry.falseCompletions > 0),
    )
    .sort((a, b) => a.rate - b.rate)
    .slice(0, 8)
    .map((entry) => ({
      family: entry.family,
      level: entry.level,
      rate: entry.rate,
      lower: entry.lower,
      samples: entry.samples,
      falseCompletions: entry.falseCompletions,
    }));
  const regressions = (
    (last?.summary.regressions as Array<{
      family: string;
      level: number;
      kind: string;
    }>) ?? []
  ).map(({ family, level, kind }) => ({ family, level, kind }));
  const budget = await rsiBudget(ctx.intel, new Date(ctx.now()));
  return {
    state: {
      ...ctx.cycle.state,
      health: {
        pulseCycleId: last?.id ?? null,
        suiteVersion: last?.suiteVersion ?? null,
        pulseCompletedAt: last?.completedAt ?? null,
        tasks: results.length,
        verified: results.filter((row) => isVerified(row.outcome)).length,
        infrastructure: results.filter(
          (row) => row.outcome === "INFRASTRUCTURE_FAILURE",
        ).length,
        weakCells,
        regressions,
        budget: {
          used: budget.used,
          allowance: budget.accrued,
          day: budget.day,
        },
      },
    },
    note: last
      ? `pulse ${last.id.slice(0, 8)}: ${results.filter((row) => isVerified(row.outcome)).length}/${results.length} verified, ${weakCells.length} weak cells, ${regressions.length} regressions; live budget ${budget.used}/${budget.accrued}`
      : "no completed pulse cycle yet",
  };
}

// ----- 2 EXPERIENCE ----------------------------------------------------------

export async function experience(ctx: RsiContext): Promise<PhaseResult> {
  const cycles = await recentPulseCycles(ctx);
  let pulseRows = 0;
  let taught = 0;
  let excluded = 0;
  const failing = new Map<string, { result: PulseResult; count: number }>();
  const falseCompletions: PulseResult[] = [];
  for (const cycle of cycles) {
    for (const result of await ctx.pulse.cycleResults(cycle.id)) {
      pulseRows += 1;
      // Infrastructure and "cannot judge" never teach anything.
      if (!countsAsSample(result.outcome)) {
        excluded += 1;
        continue;
      }
      const print = fingerprint("pulse", cycle.id, result.taskId);
      if (!(await ctx.intel.experienceFingerprintExists(print))) {
        await ctx.intel.insertExperience({
          source: "benchmark",
          taskRef: result.taskId,
          taskType: result.family.toLowerCase(),
          capabilityIds: [
            FAMILY_CAPABILITY[result.family] ?? "reasoning.planning",
          ],
          difficulty: result.level,
          strategyVersionId: null,
          model: null,
          skills: [],
          tools: [],
          trajectory: {},
          verification: {
            verdicts: [],
            capabilityOutcome: result.outcome,
            reason: result.reason,
          },
          outcome: toExperienceOutcome(result.outcome),
          failureClass: isVerified(result.outcome)
            ? null
            : `pulse:${result.outcome.toLowerCase()}`,
          repairs: Number(result.evidence.repairs ?? 0),
          costUsd: 0,
          tokens: 0,
          latencyMs: result.latencyMs,
          confidence: null,
          qualityScore: isVerified(result.outcome) ? 1 : 0,
          fingerprint: print,
          partition: null,
          provenance: { pulseCycleId: cycle.id, mode: result.mode },
        });
        taught += 1;
      }
      if (!isVerified(result.outcome)) {
        const entry = failing.get(result.taskId) ?? { result, count: 0 };
        entry.count += 1;
        failing.set(result.taskId, entry);
      }
      if (
        result.outcome === "FALSE_COMPLETION" ||
        result.evidence.gateLeak === true
      )
        falseCompletions.push(result);
    }
  }
  let failureMemories = 0;
  for (const { result, count } of failing.values()) {
    await ctx.intel.upsertArtifact({
      cycleId: null,
      kind: "failure_memory",
      capabilityId: FAMILY_CAPABILITY[result.family] ?? null,
      taskPattern: `${result.family}:L${result.level}`,
      content: {
        task: result.taskId,
        family: result.family,
        level: result.level,
        outcome: result.outcome,
        reason: result.reason,
        rsiCycle: ctx.cycle.id,
      },
      evidence: { occurrences: count, source: "pulse" },
      support: count,
      status: "active",
      fingerprint: fingerprint("failure_memory", "pulse", result.taskId),
    });
    failureMemories += 1;
  }
  let antiPatterns = 0;
  for (const result of falseCompletions) {
    await ctx.intel.upsertArtifact({
      cycleId: null,
      kind: "anti_pattern",
      capabilityId: FAMILY_CAPABILITY[result.family] ?? null,
      taskPattern: `${result.family}:L${result.level}`,
      content: {
        pattern: "declared success the evidence does not support",
        task: result.taskId,
        reason: result.reason,
      },
      evidence: {
        outcome: result.outcome,
        gateLeak: result.evidence.gateLeak ?? null,
      },
      support: 1,
      status: "active",
      fingerprint: fingerprint("anti_pattern", "pulse", result.taskId),
    });
    antiPatterns += 1;
  }
  return {
    state: {
      ...ctx.cycle.state,
      experience: {
        pulseRows,
        taught,
        excluded,
        failureMemories,
        antiPatterns,
      },
    },
    note: `${cycles.length} pulse cycles, ${pulseRows} results: ${taught} new verified-outcome rows, ${excluded} excluded (infrastructure/inconclusive), ${failureMemories} failure memories, ${antiPatterns} anti-patterns`,
  };
}

// ----- 3 GAPS ----------------------------------------------------------------

/** Upsert a finding as a gap; its instances are the distinct evidence. */
export async function recordFinding(intel: IntelStore, finding: RsiFinding) {
  return intel.upsertGap({
    capabilityId: finding.capabilityId,
    kind: finding.kind,
    summary: finding.summary,
    evidence: {
      experienceIds: finding.instances.slice(0, 200),
      source: finding.source,
      origin: finding.origin,
      mechanism: finding.mechanism,
    },
    support: new Set(finding.instances).size,
    status: "open",
  });
}

export async function gaps(ctx: RsiContext): Promise<PhaseResult> {
  const cells = ctx.cycle.state.health?.weakCells ?? [];
  for (const cell of cells) {
    const capabilityId = FAMILY_CAPABILITY[cell.family];
    if (!capabilityId) continue;
    await recordFinding(ctx.intel, {
      source: "pulse",
      origin: `${cell.family}:L${cell.level}`,
      capabilityId,
      kind: FAMILY_GAP[cell.family] ?? "knowledge",
      summary: `Pulse cell ${cell.family} L${cell.level} below its ceiling`,
      mechanism: null,
      instances: [`cell:${cell.family}:${cell.level}:${cell.samples}`],
    });
  }
  const open = (await ctx.intel.listGaps())
    .filter((gap) => gap.status === "open" || gap.status === "investigating")
    .sort((a, b) => b.support - a.support);
  return {
    state: {
      ...ctx.cycle.state,
      gaps: {
        open: open.length,
        top: open.slice(0, 10).map((gap) => ({
          id: gap.id,
          capabilityId: gap.capabilityId,
          kind: gap.kind,
          summary: gap.summary,
          support: gap.support,
        })),
      },
    },
    note: `${open.length} open gaps; top: ${
      open
        .slice(0, 3)
        .map((gap) => `${gap.capabilityId}/${gap.kind} (${gap.support})`)
        .join(", ") || "none"
    }`,
  };
}

// ----- 4 CHALLENGE -------------------------------------------------------------

export async function challenge(ctx: RsiContext): Promise<PhaseResult> {
  const capabilities = await ctx.intel.listCapabilities();
  const strong = capabilities
    .filter((capability) => capability.status === "strong")
    .map((capability) => capability.id);
  const requests = curriculumRequests({
    gaps: (ctx.cycle.state.gaps?.top ?? []).map((gap) => ({
      capabilityId: gap.capabilityId,
      summary: gap.summary,
      support: gap.support,
    })),
    weakCells: ctx.cycle.state.health?.weakCells ?? [],
    strong,
    limit: 4,
  });
  const report = await stockCurriculum(ctx.intel, requests, hourOf(ctx));
  if (report.generated)
    await ctx.intel.insertGenerationRun({
      cycleId: null,
      kind: "curriculum",
      config: {
        rsiCycle: ctx.cycle.id,
        requests: requests.map((request) => ({
          capabilityId: request.capabilityId,
          generator: request.generator,
          reason: request.reason,
          difficulty: request.difficulty,
        })),
      },
      produced: report.generated,
      verified: report.stored,
      rejected: report.duplicates + report.contaminated,
      summary: {
        duplicates: report.duplicates,
        contaminated: report.contaminated,
        tasks: report.taskIds.slice(0, 40),
      },
    });
  return {
    state: {
      ...ctx.cycle.state,
      challenge: {
        requests: requests.length,
        generated: report.generated,
        stored: report.stored,
        duplicates: report.duplicates,
        contaminated: report.contaminated,
        reasons: requests.map((request) => request.reason).slice(0, 6),
      },
    },
    note: `${requests.length} requests: ${report.generated} generated, ${report.stored} stored, ${report.duplicates} duplicates, ${report.contaminated} contaminated`,
  };
}

// ----- 5/6 SELF-PLAY and RED ----------------------------------------------------

type ArenaMemory = {
  rounds: Array<{
    level: number;
    held: number;
    instances: number;
    score: number;
  }>;
  known: Set<string>;
  corpus: string[];
};

async function arenaMemory(
  intel: IntelStore,
  kind: "self_play" | "red",
): Promise<Map<string, ArenaMemory>> {
  const out = new Map<string, ArenaMemory>();
  for (const run of await intel.listGenerationRuns(400)) {
    if (run.kind !== kind) continue;
    const arenaId = run.config.arena as string | undefined;
    if (!arenaId) continue;
    const entry = out.get(arenaId) ?? {
      rounds: [],
      known: new Set(),
      corpus: [],
    };
    const summary = run.summary as {
      level?: number;
      held?: number;
      instances?: number;
      score?: number;
      fingerprints?: string[];
      texts?: string[];
    };
    entry.rounds.push({
      level: summary.level ?? 1,
      held: summary.held ?? 0,
      instances: summary.instances ?? 0,
      score: summary.score ?? 0,
    });
    for (const print of summary.fingerprints ?? []) entry.known.add(print);
    entry.corpus.push(...(summary.texts ?? []).slice(0, 8));
    out.set(arenaId, entry);
  }
  return out;
}

/**
 * Which arenas play this cycle: a rotation over the hour, weighted away
 * from generators that stopped teaching anything (a low score for three
 * rounds at their top level). A retired generator still plays once a day.
 */
export function chooseArenas(
  arenas: ChallengeArena[],
  memory: Map<string, ArenaMemory>,
  hour: number,
  count: number,
) {
  const retired = new Set(
    arenas
      .filter((arena) => {
        const rounds = memory.get(arena.id)?.rounds.slice(0, 3) ?? [];
        return (
          rounds.length === 3 &&
          rounds.every(
            (round) => round.level >= arena.maxLevel && round.score < 0.3,
          )
        );
      })
      .map((arena) => arena.id),
  );
  const active = arenas.filter(
    (arena, index) => !retired.has(arena.id) || (hour + index) % 24 === 0,
  );
  const pool = active.length ? active : arenas;
  const start = hour % pool.length;
  const picked: ChallengeArena[] = [];
  for (let index = 0; index < Math.min(count, pool.length); index += 1)
    picked.push(pool[(start + index) % pool.length]!);
  return { picked, retired: [...retired] };
}

async function playRound(
  ctx: RsiContext,
  kind: "self_play" | "red",
  arenas: ChallengeArena[],
  count: number,
) {
  const memory = await arenaMemory(ctx.intel, kind);
  const hour = hourOf(ctx);
  const { picked, retired } = chooseArenas(arenas, memory, hour, count);
  const played: Array<{
    arena: ChallengeArena;
    round: ArenaRound;
    score: number;
  }> = [];
  const findings: RsiFinding[] = [];
  for (const arena of picked) {
    const own = memory.get(arena.id);
    const level = nextLevel(own?.rounds ?? [], arena.maxLevel);
    const round = await playArena(arena, {
      seed: `h${hour}`,
      level,
      count: ctx.instancesPerArena ?? 4,
      known: own?.known,
      corpus: own?.corpus,
    });
    const score = generatorScore(round, arena.maxLevel);
    played.push({ arena, round, score });
    const instances = arena.generate({
      seed: `h${hour}`,
      level: round.level,
      count: round.instances,
    });
    await ctx.intel.insertGenerationRun({
      cycleId: null,
      kind,
      config: {
        arena: arena.id,
        rsiCycle: ctx.cycle.id,
        roles: arena.roles,
        verifier: arena.verifier,
        mechanism: arena.mechanism,
      },
      produced: round.instances,
      verified: round.held,
      rejected: round.failed + round.invalid,
      summary: {
        level: round.level,
        instances: round.instances,
        held: round.held,
        failed: round.failed,
        invalid: round.invalid,
        novel: round.novel,
        novelty: round.novelty,
        score,
        fingerprints: instances.map((instance) => instance.fingerprint),
        texts: instances.map((instance) => instance.text).slice(0, 8),
        failures: round.failures.slice(0, 4),
      },
    });
    if (round.failed > 0) {
      const finding: RsiFinding = {
        source: kind,
        origin: arena.id,
        capabilityId: arena.capabilityId,
        kind: arena.gap,
        summary: `${arena.id} L${round.level}: ${arena.mechanism.split(":")[1]} fails ${round.failed}/${round.instances}`,
        mechanism: arena.mechanism,
        instances: round.failures.map((failure) => failure.id),
      };
      findings.push(finding);
      await recordFinding(ctx.intel, finding);
      await ctx.intel.upsertArtifact({
        cycleId: null,
        kind: "failure_memory",
        capabilityId: arena.capabilityId,
        taskPattern: `${arena.id}:L${round.level}`,
        content: {
          arena: arena.id,
          level: round.level,
          mechanism: arena.mechanism,
          trustRoot: arena.trustRoot ?? false,
          example: round.failures[0]?.detail ?? null,
          instances: round.failures.map((failure) => failure.id).slice(0, 8),
          rsiCycle: ctx.cycle.id,
        },
        evidence: {
          failed: round.failed,
          instances: round.instances,
          verifier: arena.verifier,
        },
        support: round.failed,
        status: "active",
        fingerprint: fingerprint("failure_memory", arena.id, round.level),
      });
    }
  }
  return { played, findings, retired };
}

export async function selfPlay(ctx: RsiContext): Promise<PhaseResult> {
  const { played, findings } = await playRound(
    ctx,
    "self_play",
    ctx.selfPlayArenas ?? SELF_PLAY_ARENAS,
    ctx.selfPlayPerCycle ?? 2,
  );
  return {
    state: {
      ...ctx.cycle.state,
      selfPlay: {
        configs: played.map(({ arena, round, score }) => ({
          id: arena.id,
          difficulty: round.level,
          instances: round.instances,
          held: round.held,
          failed: round.failed,
          novelty: round.novelty,
          score,
        })),
        findings,
      },
    },
    note: played
      .map(
        ({ arena, round }) =>
          `${arena.id} L${round.level} ${round.held}/${round.instances} held`,
      )
      .join("; "),
  };
}

export async function redTeam(ctx: RsiContext): Promise<PhaseResult> {
  const { played, findings } = await playRound(
    ctx,
    "red",
    ctx.redArenas ?? RED_ARENAS,
    ctx.redPerCycle ?? 4,
  );
  return {
    state: {
      ...ctx.cycle.state,
      red: {
        attacks: played.map(({ arena, round }) => ({
          id: arena.id,
          level: round.level,
          instances: round.instances,
          held: round.held,
          failed: round.failed,
        })),
        findings,
      },
    },
    note: played
      .map(
        ({ arena, round }) =>
          `${arena.id} L${round.level} ${round.failed ? `FOUND ${round.failed}` : "held"}`,
      )
      .join("; "),
  };
}

// ----- 7 HYPOTHESIZE -----------------------------------------------------------

const MECHANISM_CLASS: Record<Mechanism, RsiHypothesisClass> = {
  reasoning_depth: "context",
  tool_use: "tool",
  model: "routing",
  specialist: "specialist",
  verifier: "verification",
  memory_retrieval: "memory",
  topology: "team_topology",
  compute_tier: "compute",
  skill: "skill",
  generated_tool: "tool",
  architecture: "architecture",
  adaptive_compute: "compute",
  prompt: "prompt",
};

export async function hypothesize(ctx: RsiContext): Promise<PhaseResult> {
  const items: RsiHypothesis[] = [];
  // Code hypotheses: a deterministic Osirus mechanism failed its oracle.
  const findings = [
    ...(ctx.cycle.state.selfPlay?.findings ?? []),
    ...(ctx.cycle.state.red?.findings ?? []),
  ];
  const arenas = [
    ...(ctx.selfPlayArenas ?? SELF_PLAY_ARENAS),
    ...(ctx.redArenas ?? RED_ARENAS),
  ];
  for (const finding of findings) {
    if (!finding.mechanism) continue;
    const [file, symbol] = finding.mechanism.split(":") as [string, string];
    const arena = arenas.find((entry) => entry.id === finding.origin);
    const hypothesis: RsiHypothesis = {
      id: randomUUID(),
      class: "code",
      capabilityId: finding.capabilityId,
      gap: finding.kind,
      statement: `${symbol} in ${file} mishandles what ${finding.origin} generates: ${finding.summary}.`,
      expected: `The ${finding.origin} instances that fail now hold, on unseen seeds, with every existing test green.`,
      target: { file, symbol },
      origin: finding.origin,
      lane: "offline",
    };
    items.push(hypothesis);
    await ctx.intel.upsertArtifact({
      cycleId: null,
      kind: "code_hypothesis",
      capabilityId: finding.capabilityId,
      taskPattern: finding.origin,
      content: {
        statement: hypothesis.statement,
        expected: hypothesis.expected,
        file,
        symbol,
        arena: finding.origin,
        levels: [
          ...new Set(
            finding.instances.map((id) =>
              Number(/:L(\d+):/.exec(id)?.[1] ?? 1),
            ),
          ),
        ],
        failing: finding.instances.slice(0, 8),
        // Proposals in the trust root need the operator; the pipeline
        // never opens them on its own.
        trustRoot: arena?.trustRoot ?? false,
        rsiCycle: ctx.cycle.id,
      },
      evidence: { summary: finding.summary, source: finding.source },
      support: finding.instances.length,
      status: "proposed",
      fingerprint: fingerprint(
        "code_hypothesis",
        finding.mechanism,
        finding.origin,
      ),
    });
  }
  // Strategy hypotheses: for gaps of capabilities that have a strategy.
  const top = ctx.cycle.state.gaps?.top ?? [];
  const policy = await loadMetaPolicy(ctx.intel);
  const byCapability = new Map<string, CapabilityGap[]>();
  for (const gap of await ctx.intel.listGaps())
    if (top.some((entry) => entry.id === gap.id))
      byCapability.set(gap.capabilityId, [
        ...(byCapability.get(gap.capabilityId) ?? []),
        gap,
      ]);
  // A hypothesis already decided (won, lost or regressed) is not proposed
  // again; one still gathering evidence keeps its id, so its evidence adds up.
  const decided = new Set(
    (await ctx.intel.listArtifacts({ kind: "live_order", limit: 200 }))
      .map(
        (artifact) =>
          artifact.content as LiveOrderContent & {
            decision?: { outcome: string };
          },
      )
      .filter(
        (order) => order.decision && order.decision.outcome !== "inconclusive",
      )
      .map((order) => order.hypothesis.id),
  );
  for (const [capabilityId, capabilityGaps] of byCapability) {
    const strategy = strategyForCapability(capabilityId);
    if (!strategy) continue;
    const champion = (await ctx.intel.listVersions(strategy.id)).find(
      (version) => version.status === "champion",
    );
    if (!champion) continue;
    const pool = hypothesesFor(
      strategy.kind,
      capabilityGaps,
      champion.genome,
      4,
    )
      .map((hypothesis) => ({
        ...hypothesis,
        id: fingerprint(
          "hypothesis",
          strategy.id,
          champion.id,
          hypothesis.intervention,
        ),
      }))
      .filter((hypothesis) => !decided.has(hypothesis.id));
    for (const hypothesis of orderByMetaPolicy(
      pool,
      policy,
      ctx.cycle.id,
    ).slice(0, 2))
      items.push({
        id: hypothesis.id,
        class: MECHANISM_CLASS[mechanismOf(hypothesis)] ?? "strategy",
        capabilityId,
        gap: hypothesis.gap,
        statement: hypothesis.statement,
        expected: hypothesis.expected,
        intervention: hypothesis.intervention as Record<string, unknown>,
        origin: hypothesis.origin ?? "library",
        lane: "live",
      });
  }
  return {
    state: { ...ctx.cycle.state, hypotheses: { items } },
    note: `${items.filter((item) => item.class === "code").length} code hypotheses, ${items.filter((item) => item.class !== "code").length} strategy hypotheses`,
  };
}

// ----- 8 EXPERIMENT --------------------------------------------------------------

export type LiveOrderContent = {
  orderId: string;
  rsiCycle: string;
  capabilityId: string;
  strategyId: string;
  model: string;
  hypothesis: RsiHypothesis;
  champion: { versionId: string; genome: Record<string, unknown> };
  challenger: { genome: Record<string, unknown> };
  tasks: Array<{ id: string; partition: string; spec: unknown }>;
  benchmark: Array<{ id: string; family: string; spec: unknown }>;
  /** Calls the order may spend; reserved when the runner takes it. */
  calls: number;
  state: "open" | "taken" | "evidence" | "decided" | "expired";
  takenAt?: string | null;
  reserved?: number;
  evidence?: LiveEvidence | null;
};

export type LiveTrialRow = {
  taskId: string;
  partition: "dev" | "holdout" | "adversarial";
  side: "champion" | "challenger";
  verified: boolean;
  falseCompletion: boolean;
  failureClass: string | null;
  modelCalls: number;
  tokens: number;
  latencyMs: number;
};

export type LiveBenchmarkRow = {
  taskId: string;
  family: string;
  raw: { verified: boolean; modelCalls: number; tokens: number } | null;
  osirus: { verified: boolean; modelCalls: number; tokens: number } | null;
  excluded?: string | null;
};

export type LiveEvidence = {
  trials: LiveTrialRow[];
  benchmark: LiveBenchmarkRow[];
  spent: { modelCalls: number; tokens: number };
  runner: { runId: string | null; startedAt: string; finishedAt: string };
};

const ORDER_TTL_MS = 12 * HOUR;
const TAKEN_TTL_MS = 6 * HOUR;

export async function openOrders(intel: IntelStore) {
  return (await intel.listArtifacts({ kind: "live_order", limit: 50 })).filter(
    (artifact) =>
      ["open", "taken", "evidence"].includes(
        (artifact.content as LiveOrderContent).state,
      ),
  );
}

export async function experiment(ctx: RsiContext): Promise<PhaseResult> {
  const orders = await openOrders(ctx.intel);
  // An order nobody took in time expires (it spent nothing); one taken but
  // never reported expires too -- its reservation stays charged, because
  // the calls may have been spent.
  let live = orders;
  for (const order of orders) {
    const content = order.content as LiveOrderContent;
    const created = Date.parse(String(order.evidence.createdAt ?? 0));
    const taken = Date.parse(content.takenAt ?? "") || created;
    const stale =
      (content.state === "open" && ctx.now() - created > ORDER_TTL_MS) ||
      (content.state === "taken" && ctx.now() - taken > TAKEN_TTL_MS);
    if (!stale) continue;
    await ctx.intel.upsertArtifact({
      ...order,
      content: { ...content, state: "expired" },
      status: "superseded",
    });
    live = live.filter((entry) => entry !== order);
  }
  const hypothesis = (ctx.cycle.state.hypotheses?.items ?? []).find(
    (item) => item.lane === "live",
  );
  const pending = live.some((order) =>
    ["open", "taken"].includes((order.content as LiveOrderContent).state),
  );
  const note = (text: string, order: string | null = null) => ({
    state: {
      ...ctx.cycle.state,
      experiment: {
        order,
        lane: order ? ("live" as const) : ("none" as const),
        note: text,
      },
    },
    note: text,
  });
  if (pending) return note("a live order is still out; no new one");
  if (!hypothesis) return note("no live hypothesis this cycle");
  const budget = await rsiBudget(ctx.intel, new Date(ctx.now()));
  if (budget.available < RSI_MIN_CALLS_PER_ORDER)
    return note(
      `live envelope: ${budget.used}/${budget.accrued} calls used today, ${budget.available} free (an order needs ${RSI_MIN_CALLS_PER_ORDER}): offline work only`,
    );
  const strategy = strategyForCapability(hypothesis.capabilityId);
  if (!strategy) return note(`no strategy owns ${hypothesis.capabilityId}`);
  const champion = (await ctx.intel.listVersions(strategy.id)).find(
    (version) => version.status === "champion",
  );
  if (!champion) return note(`no champion for ${strategy.id}`);
  const tasks = (
    await ctx.intel.listTasks({
      capabilityId: strategy.capabilityId,
      limit: 400,
    })
  ).filter(
    (task) =>
      task.labelVerified &&
      task.spec.verify.kind !== "tests" &&
      (task.partition === "dev" || task.partition === "holdout"),
  );
  const pick = (partition: string, count: number) =>
    tasks
      .filter((task) => task.partition === partition)
      .sort((a, b) =>
        fingerprint(ctx.cycle.id, a.id).localeCompare(
          fingerprint(ctx.cycle.id, b.id),
        ),
      )
      .slice(0, count);
  const chosen = [...pick("dev", 2), ...pick("holdout", 1)];
  if (!chosen.length)
    return note(`no verified tasks for ${strategy.capabilityId} yet`);
  const benchmark = (await ctx.intel.listTasks({ limit: 400 }))
    .filter(
      (task) =>
        task.labelVerified &&
        task.suite.startsWith("rsi.") &&
        task.partition === "holdout",
    )
    .slice(0, 2);
  const orderId = randomUUID();
  const content: LiveOrderContent = {
    orderId,
    rsiCycle: ctx.cycle.id,
    capabilityId: strategy.capabilityId,
    strategyId: strategy.id,
    model: ctx.model,
    hypothesis,
    champion: {
      versionId: champion.id,
      genome: champion.genome as Record<string, unknown>,
    },
    challenger: {
      genome: {
        ...(champion.genome as Record<string, unknown>),
        ...(hypothesis.intervention ?? {}),
      },
    },
    tasks: chosen.map((task) => ({
      id: task.id,
      partition: task.partition,
      spec: task.spec,
    })),
    benchmark: benchmark.map((task) => ({
      id: task.id,
      family: task.capabilityId,
      spec: task.spec,
    })),
    calls: budget.available,
    state: "open",
    evidence: null,
  };
  await ctx.intel.upsertArtifact({
    cycleId: null,
    kind: "live_order",
    capabilityId: strategy.capabilityId,
    taskPattern: strategy.id,
    content: content as unknown as Record<string, unknown>,
    evidence: { createdAt: new Date(ctx.now()).toISOString() },
    support: chosen.length,
    status: "proposed",
    fingerprint: fingerprint("live_order", orderId),
  });
  return note(
    `live order ${orderId.slice(0, 8)}: ${hypothesis.statement.slice(0, 80)} on ${chosen.length} tasks + ${benchmark.length} raw-vs-Osirus pairs`,
    orderId,
  );
}

// ----- 9 DECIDE ----------------------------------------------------------------

/** Trials from a live order's evidence, in the Foundry's shape. */
export function trialsFromEvidence(
  orderId: string,
  evidence: LiveEvidence,
  ids: { champion: string; challenger: string },
): Trial[] {
  return evidence.trials.map((row, index) => ({
    id: `${orderId}:${index}`,
    experimentId: orderId,
    strategyVersionId: row.side === "champion" ? ids.champion : ids.challenger,
    evalTaskId: row.taskId,
    partition: row.partition,
    replicate: 0,
    status: "completed",
    runId: null,
    attempts: 1,
    result: {
      success: row.verified,
      verified: row.verified,
      falseCompletion: row.falseCompletion,
      failureClass: row.failureClass,
      costUsd: 0,
      tokens: row.tokens,
      latencyMs: row.latencyMs,
      modelCalls: row.modelCalls,
      toolCalls: 0,
      repairs: 0,
      verdicts: [],
      notes: [],
      answerExcerpt: "",
      check: { passed: row.verified, detail: "live runner" },
    },
  }));
}

export async function decidePhase(ctx: RsiContext): Promise<PhaseResult> {
  const notes: string[] = [];
  let decided = 0;
  let promoted = 0;
  let rejected = 0;
  let quarantined = 0;
  let rolledBack = 0;
  const orders = (await openOrders(ctx.intel)).filter(
    (order) => (order.content as LiveOrderContent).state === "evidence",
  );
  // Evidence accumulates per hypothesis across orders until the rule can decide.
  for (const order of orders) {
    const content = order.content as LiveOrderContent;
    const related = (
      await ctx.intel.listArtifacts({ kind: "live_order", limit: 200 })
    )
      .map((artifact) => artifact.content as LiveOrderContent)
      .filter(
        (other) =>
          other.hypothesis.id === content.hypothesis.id &&
          (other.state === "evidence" || other.state === "decided") &&
          other.evidence,
      );
    const trials = related.flatMap((other) =>
      trialsFromEvidence(other.orderId, other.evidence!, {
        champion: "champion",
        challenger: "challenger",
      }),
    );
    // Dev and holdout run together in one order, so there is no separate
    // screen; the decision rule itself demands enough pairs, holdout not
    // worse and no extra false completions.
    const decision = decide(trials, "champion", ["challenger"], "challenger");
    decided += 1;
    await ctx.intel.upsertArtifact({
      ...order,
      content: { ...content, state: "decided", decision } as unknown as Record<
        string,
        unknown
      >,
      status: "superseded",
    });
    const champion = await ctx.intel.getVersion(content.champion.versionId);
    if (!champion) continue;
    if (decision.outcome === "improved") {
      const version = await ctx.intel.insertVersion({
        strategyId: content.strategyId,
        kind: champion.kind,
        genome: content.challenger.genome as StrategyVersion["genome"],
        parentId: champion.id,
        mutation: {
          operator: "rsi_hypothesis",
          rationale: content.hypothesis.statement.slice(0, 500),
          hypothesis: content.hypothesis.id,
        },
        status: "experimental",
        riskClass: "low",
        model: content.model,
        canaryPercent: 0,
        metrics: { decision: decision.summary, rsiCycle: ctx.cycle.id },
      });
      // Champion inside the Intelligence Plane only; the product reads
      // active/canary versions, which only the canary step can create.
      await crownChampion(ctx.intel, version, {
        rsiCycle: ctx.cycle.id,
        decision: decision.summary,
      });
      promoted += 1;
      notes.push(
        `promoted ${content.strategyId}: ${decision.summary.slice(0, 120)}`,
      );
    } else if (
      decision.outcome === "regressed" ||
      decision.outcome === "no_improvement"
    ) {
      rejected += 1;
      notes.push(`rejected: ${decision.summary.slice(0, 120)}`);
    } else notes.push(`inconclusive so far: ${decision.summary.slice(0, 120)}`);
    // Meta: the anchor research cycle records the decision for the Lab.
    if (decision.outcome !== "inconclusive") {
      const anchor = await ctx.intel.insertCycle({
        status: "completed",
        phase: "next",
        agendaItemId: null,
        capabilityId: content.capabilityId,
        state: {
          decision,
          hypotheses: [
            {
              id: content.hypothesis.id,
              gap: content.hypothesis.gap,
              statement: content.hypothesis.statement,
              intervention: (content.hypothesis.intervention ??
                {}) as Hypothesis["intervention"],
              expected: content.hypothesis.expected,
            },
          ],
        },
        summary: {
          source: "rsi",
          rsiCycle: ctx.cycle.id,
          order: content.orderId,
        },
      });
      await recordExperimentMeta(ctx.intel, {
        cycleId: anchor.id,
        capabilityId: content.capabilityId,
        champion,
        challengers: [
          {
            ...champion,
            id: "challenger",
            genome: content.challenger.genome as StrategyVersion["genome"],
            mutation: {
              operator: "rsi_hypothesis",
              rationale: "",
              hypothesis: content.hypothesis.id,
            },
          },
        ],
        hypotheses: [
          {
            id: content.hypothesis.id,
            gap: content.hypothesis.gap,
            statement: content.hypothesis.statement,
            intervention: (content.hypothesis.intervention ??
              {}) as Hypothesis["intervention"],
            expected: content.hypothesis.expected,
          },
        ],
        decision: {
          ...decision,
          winnerVersionId: decision.winnerVersionId ? "challenger" : null,
        },
        ablation: null,
      });
    }
  }
  // Self-healing: a confirmed pulse regression after a recent promotion
  // quarantines the promoted version and restores its parent's genome.
  const regressions = ctx.cycle.state.health?.regressions ?? [];
  if (regressions.length) {
    const recent = (await ctx.intel.listPromotions(50)).filter(
      (event) =>
        event.toStatus === "champion" &&
        Date.parse(event.createdAt ?? "0") > ctx.now() - 48 * HOUR &&
        (event.evidence as { rsiCycle?: string }).rsiCycle,
    );
    for (const event of recent) {
      const version = await ctx.intel.getVersion(event.strategyVersionId);
      if (!version || version.status !== "champion") continue;
      const capability = strategyForCapability(
        version.strategyId,
      )?.capabilityId;
      const hit = regressions.some(
        (regression) => FAMILY_CAPABILITY[regression.family] === capability,
      );
      if (!hit) continue;
      await transition(ctx.intel, version, "quarantined", {
        reason: "pulse regression after promotion",
        regressions,
        rsiCycle: ctx.cycle.id,
      });
      quarantined += 1;
      const parent = version.parentId
        ? await ctx.intel.getVersion(version.parentId)
        : null;
      if (parent) {
        const restored = await ctx.intel.insertVersion({
          strategyId: version.strategyId,
          kind: version.kind,
          genome: parent.genome,
          parentId: version.id,
          mutation: {
            operator: "rollback",
            rationale: `restores v${parent.version} after a confirmed regression`,
          },
          status: "experimental",
          riskClass: "low",
          model: parent.model,
          canaryPercent: 0,
          metrics: { rollbackOf: version.id, rsiCycle: ctx.cycle.id },
        });
        await crownChampion(ctx.intel, restored, {
          reason: "rollback",
          rsiCycle: ctx.cycle.id,
        });
        rolledBack += 1;
      }
      notes.push(
        `quarantined ${version.strategyId} v${version.version}; rolled back`,
      );
    }
  }
  return {
    state: {
      ...ctx.cycle.state,
      decision: { decided, promoted, rejected, quarantined, rolledBack, notes },
    },
    note:
      decided || quarantined
        ? notes.join("; ")
        : "no live evidence to decide; no verified improvement this cycle",
  };
}

// ----- 10 MEMORY -----------------------------------------------------------------

export async function memory(ctx: RsiContext): Promise<PhaseResult> {
  const kinds: Record<string, number> = {};
  const write = async (artifact: Omit<LearningArtifact, "id">) => {
    await ctx.intel.upsertArtifact(artifact);
    kinds[artifact.kind] = (kinds[artifact.kind] ?? 0) + 1;
  };
  // Strategic memory: what this cycle learned about where Osirus is weak.
  const findings = [
    ...(ctx.cycle.state.selfPlay?.findings ?? []),
    ...(ctx.cycle.state.red?.findings ?? []),
  ];
  for (const finding of findings)
    await write({
      cycleId: null,
      kind: "strategic_memory",
      capabilityId: finding.capabilityId,
      taskPattern: `rsi:${finding.origin}`,
      content: {
        lesson: `${finding.mechanism ?? finding.origin} is a known weak point: ${finding.summary}`,
        mechanism: finding.mechanism,
        since: ctx.cycle.startedAt,
      },
      evidence: {
        instances: finding.instances.slice(0, 8),
        source: finding.source,
      },
      support: finding.instances.length,
      status: "active",
      fingerprint: fingerprint(
        "strategic",
        "rsi",
        finding.origin,
        finding.mechanism ?? "",
      ),
    });
  // A mechanism that held every instance at the level a gap names closes
  // that gap: the finding no longer reproduces.
  const held = [
    ...(ctx.cycle.state.selfPlay?.configs ?? []).map((entry) => ({
      id: entry.id,
      level: entry.difficulty,
      clean: entry.failed === 0 && entry.instances > 0,
    })),
    ...(ctx.cycle.state.red?.attacks ?? []).map((entry) => ({
      id: entry.id,
      level: entry.level,
      clean: entry.failed === 0 && entry.instances > 0,
    })),
  ].filter((entry) => entry.clean);
  let closed = 0;
  for (const gap of await ctx.intel.listGaps()) {
    if (gap.status !== "open") continue;
    if (
      held.some((entry) =>
        gap.summary.startsWith(`${entry.id} L${entry.level}:`),
      )
    ) {
      await ctx.intel.upsertGap({ ...gap, status: "addressed" });
      closed += 1;
    }
  }
  if (closed) kinds.gaps_closed = closed;
  return {
    state: {
      ...ctx.cycle.state,
      memory: {
        written: Object.values(kinds).reduce((a, b) => a + b, 0),
        kinds,
      },
    },
    note: `${
      Object.entries(kinds)
        .map(([kind, count]) => `${count} ${kind}`)
        .join(", ") || "nothing new"
    }`,
  };
}

// ----- 11 META -----------------------------------------------------------------

export async function meta(ctx: RsiContext): Promise<PhaseResult> {
  const current = new Set(
    [
      ...(ctx.cycle.state.selfPlay?.findings ?? []),
      ...(ctx.cycle.state.red?.findings ?? []),
    ].map((finding) => finding.origin),
  );
  const before = new Set(
    [
      ...(ctx.previous?.state.selfPlay?.findings ?? []),
      ...(ctx.previous?.state.red?.findings ?? []),
    ].map((finding) => finding.origin),
  );
  const newWeaknesses = [...current].filter((origin) => !before.has(origin));
  const resolved = [...before].filter((origin) => {
    const played = [
      ...(ctx.cycle.state.selfPlay?.configs ?? []),
      ...(ctx.cycle.state.red?.attacks ?? []),
    ].find((entry) => entry.id === origin);
    return played !== undefined && played.failed === 0;
  });
  const memory = await arenaMemory(ctx.intel, "red");
  const selfMemory = await arenaMemory(ctx.intel, "self_play");
  const retired = [
    ...chooseArenas(ctx.redArenas ?? RED_ARENAS, memory, hourOf(ctx), 1)
      .retired,
    ...chooseArenas(
      ctx.selfPlayArenas ?? SELF_PLAY_ARENAS,
      selfMemory,
      hourOf(ctx),
      1,
    ).retired,
  ];
  // Daily aggregation: the first cycle of a UTC day rolls up the day before.
  let rollup: string | null = null;
  const day = new Date(ctx.now()).toISOString().slice(0, 10);
  const previousDay = ctx.previous
    ? new Date(Date.parse(ctx.previous.startedAt)).toISOString().slice(0, 10)
    : null;
  if (previousDay && previousDay !== day) {
    rollup = previousDay;
    await ctx.intel.upsertArtifact({
      cycleId: null,
      kind: "rollup",
      capabilityId: null,
      taskPattern: `day:${previousDay}`,
      content: {
        day: previousDay,
        lastCycle: ctx.previous?.id,
        summary: ctx.previous?.summary ?? {},
      },
      evidence: { period: "day" },
      support: 1,
      status: "active",
      fingerprint: fingerprint("rollup", "day", previousDay),
    });
  }
  return {
    state: {
      ...ctx.cycle.state,
      meta: { newWeaknesses, resolved, generatorsRetired: retired, rollup },
    },
    note: `new weaknesses: ${newWeaknesses.join(", ") || "none"}; resolved: ${resolved.join(", ") || "none"}; retired generators: ${retired.join(", ") || "none"}${rollup ? `; rolled up ${rollup}` : ""}`,
  };
}

export const PHASE_RUNNERS: Record<
  RsiPhase,
  (ctx: RsiContext) => Promise<PhaseResult>
> = {
  health,
  experience,
  gaps,
  challenge,
  self_play: selfPlay,
  red: redTeam,
  hypothesize,
  experiment,
  decide: decidePhase,
  memory,
  meta,
};
