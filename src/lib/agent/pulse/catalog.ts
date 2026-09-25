import { fingerprint } from "../../intelligence/evals/random";
import {
  deriveOutcome,
  looksLikeInfrastructure,
  outcomeFromFlags,
  type DerivedOutcome,
} from "../../verification/outcome";
import type { CapabilityLane, CapabilityLevel, DifficultyClass } from "./lanes";
import type { PulseObservation, PulseTaskSpec } from "./types";

// The one pulse suite. Every capability suite in the repository contributes
// its tasks here, each with its own grader, so the hourly pulse measures all
// of them instead of a single L3 cell per lane:
//
//   M30 baseline   THINKING, REASONING, RESEARCH, MATH, BUILDING, COMPUTER,
//                  MEMORY at L3 (CODING offline cannot patch: inconclusive)
//   M33/M34        THINKING, REASONING, MEMORY_CONTEXT at L1 and L5
//   M36 research   RESEARCH L1–L5 (evidence ledger, contradictions)
//   M37 math       MATH_SCIENCE L1–L5 (recomputation, counterexamples)
//   M38            BUILDING, COMPUTER, TOOL_USE, MULTIMODAL L1–L5
//   M39 generalist CROSS_DOMAIN L1–L5, one mission across capabilities
//   M40 LONG_HORIZON L1–L5: crashes, typed waits, stale facts, replans
//   M41 team tasks: disagreement settled by tests, adversary attacks
//   M35 coding     CODING L1–L4, live only: a coding loop on the free model
//                  takes longer than one tick, so these run where a live
//                  runner exists (CI), not inside the scheduler tick.
//
// Offline tasks drive the production agent loop with scripted decisions.
// They detect regressions in the machinery -- the loop, tools, TaskState,
// finish gates, verifiers -- not in a model's knowledge. That limit is part
// of every result's evidence.

type FlagRecord = {
  success: boolean;
  verifiedSuccess: boolean;
  falseCompletion?: boolean;
  modelCalls?: number;
  toolCalls?: number;
  steps?: number;
  repairs?: number;
  latencyMs?: number;
  notes: string;
};

function difficultyFor(level: CapabilityLevel): DifficultyClass {
  if (level <= 2) return "DIRECT";
  if (level <= 4) return "COMPOSED";
  return "FRONTIER";
}

function observe(
  record: FlagRecord,
  derived: DerivedOutcome,
  evidence: Record<string, unknown> = {},
): PulseObservation {
  return {
    ...derived,
    evidence: { ...evidence, mode: "offline-fixture" },
    modelCalls: record.modelCalls ?? 0,
    toolCalls: record.toolCalls ?? 0,
    steps: record.steps ?? 0,
    repairs: record.repairs ?? 0,
    latencyMs: record.latencyMs ?? 0,
    gateLeak: record.falseCompletion ?? null,
    notes: record.notes,
  };
}

function fromFlags(record: FlagRecord) {
  return observe(record, outcomeFromFlags(record), {
    success: record.success,
    verifiedSuccess: record.verifiedSuccess,
  });
}

async function baselineSpecs(): Promise<PulseTaskSpec[]> {
  const { BASELINE_RUNNERS } = await import("../baseline");
  const family: Record<keyof typeof BASELINE_RUNNERS, CapabilityLane> = {
    THINKING: "THINKING",
    REASONING: "REASONING",
    CODING: "CODING",
    RESEARCH: "RESEARCH",
    MATH: "MATH_SCIENCE",
    BUILDING: "BUILDING",
    COMPUTER: "COMPUTER",
    MEMORY: "MEMORY_CONTEXT",
  };
  return (Object.keys(BASELINE_RUNNERS) as Array<keyof typeof family>).map(
    (domain) => ({
      id: `m30:${domain.toLowerCase()}:l3`,
      family: family[domain],
      level: 3,
      difficulty: "COMPOSED",
      version: 1,
      source: "M30 baseline",
      mode: "offline",
      title: `${domain} baseline`,
      run: async () => {
        const record = await BASELINE_RUNNERS[domain]();
        if (domain === "CODING" && /^Offline protocol/.test(record.notes))
          // Offline there is no model to write the patch; the fixture checks
          // that the loop reports that honestly. Not a capability sample.
          return observe(
            record,
            {
              outcome: "INCONCLUSIVE",
              reason: "offline fixture has no coding model to patch with",
            },
            { honestReport: true },
          );
        if (domain === "COMPUTER" && !record.success && !record.verifiedSuccess)
          if (/no (chromium|browser)|binary/i.test(record.notes))
            return observe(record, {
              outcome: "INFRASTRUCTURE_FAILURE",
              reason: "no browser binary on this host",
            });
        return fromFlags(record);
      },
    }),
  );
}

async function m38Specs(): Promise<PulseTaskSpec[]> {
  const { M38_PULSE_TASKS } = await import("../pulse");
  return M38_PULSE_TASKS.map((task) => ({
    id: `m38:${task.suite.toLowerCase()}:l${task.level}`,
    family: task.suite as CapabilityLane,
    level: task.level,
    difficulty: difficultyFor(task.level),
    version: 1,
    source: "M38 building/computer/tool/multimodal",
    mode: "offline",
    title: `${task.suite} L${task.level}`,
    run: async () => fromFlags(await task.run()),
  }));
}

async function researchSpecs(): Promise<PulseTaskSpec[]> {
  const { RESEARCH_PULSE_TASKS, runResearchPulseTask } =
    await import("../../research/pulse-suite");
  return RESEARCH_PULSE_TASKS.map((task) => {
    const level = Number(task.level.slice(1)) as CapabilityLevel;
    return {
      id: `m36:research:${task.id}`,
      family: "RESEARCH",
      level,
      difficulty: task.adversarial ? "ADVERSARIAL" : difficultyFor(level),
      version: 1,
      source: "M36 research",
      mode: "offline",
      title: task.title,
      run: async () => {
        const result = await runResearchPulseTask(task);
        // The M36 checks are deterministic evidence-ledger assertions: a
        // pass is independent evidence, a fail rejects.
        return observe(
          {
            success: result.passed,
            verifiedSuccess: result.passed,
            latencyMs: result.latencyMs,
            notes: result.notes,
          },
          result.passed
            ? { outcome: "VERIFIED_SUCCESS", reason: "ledger checks passed" }
            : looksLikeInfrastructure(result.notes)
              ? { outcome: "INFRASTRUCTURE_FAILURE", reason: result.notes }
              : { outcome: "REJECTED", reason: "ledger checks failed" },
          { adversarial: task.adversarial },
        );
      },
    };
  });
}

async function mathSpecs(): Promise<PulseTaskSpec[]> {
  const { MATH_SCIENCE_PULSE_TASKS } =
    await import("../../math-science/pulse-suite");
  const { runPulseTask } = await import("../../math-science/pulse");
  return MATH_SCIENCE_PULSE_TASKS.map((task) => ({
    id: `m37:math:${task.id}`,
    family: "MATH_SCIENCE",
    level: task.level,
    difficulty: difficultyFor(task.level),
    version: 1,
    source: "M37 math/science",
    mode: "offline",
    title: task.id,
    run: async () => {
      const record = await runPulseTask(task);
      return observe(record, outcomeFromFlags(record), {
        gates: record.gates,
      });
    },
  }));
}

async function cognitionSpecs(): Promise<PulseTaskSpec[]> {
  const { COGNITION_TASKS } = await import("./cognition-suite");
  return COGNITION_TASKS.map((task) => ({
    id: `m34:${task.family.toLowerCase()}:l${task.level}`,
    family: task.family,
    level: task.level,
    difficulty: task.difficulty,
    version: 1,
    source: "M33/M34 cognition",
    mode: "offline",
    title: `${task.family} L${task.level}`,
    run: async () => fromFlags(await task.run()),
  }));
}

async function crossDomainSpecs(): Promise<PulseTaskSpec[]> {
  const { CROSS_DOMAIN_TASKS } = await import("./cross-domain-suite");
  return CROSS_DOMAIN_TASKS.map((task) => ({
    id: `m39:cross_domain:l${task.level}`,
    family: "CROSS_DOMAIN",
    level: task.level,
    difficulty: task.difficulty,
    version: 1,
    source: "M39 generalist",
    mode: "offline",
    title: `CROSS_DOMAIN L${task.level}`,
    run: async () => {
      const record = await task.run("mission");
      const derived: DerivedOutcome = record.falseCompletion
        ? {
            outcome: "FALSE_COMPLETION",
            reason: "mission declared done against its evidence",
          }
        : record.completedAs === "complete" && record.verifiedSuccess
          ? {
              outcome: "VERIFIED_SUCCESS",
              reason: "mission gate: every node verified",
            }
          : record.completedAs === "partial"
            ? {
                outcome: "PARTIAL",
                reason: "mission gate: some nodes unverified",
              }
            : { outcome: "REJECTED", reason: "mission gate: failed" };
      return observe(record, derived, {
        capabilities: record.capabilities,
        handoffLoss: record.handoffLoss,
        evidenceCoverage: record.evidenceCoverage,
        switches: record.switches,
        planRevisions: record.planRevisions,
      });
    },
  }));
}

async function longHorizonSpecs(): Promise<PulseTaskSpec[]> {
  const { LONG_HORIZON_TASKS } = await import("./long-horizon-suite");
  return LONG_HORIZON_TASKS.map((task) => ({
    id: `m40:long_horizon:l${task.level}`,
    family: "LONG_HORIZON",
    level: task.level,
    difficulty: task.difficulty,
    version: 1,
    source: "M40 long-horizon",
    mode: "offline",
    title: `LONG_HORIZON L${task.level}`,
    run: async () => {
      const record = await task.run("horizon");
      const derived: DerivedOutcome = record.falseCompletion
        ? {
            outcome: "FALSE_COMPLETION",
            reason: "declared done against its evidence",
          }
        : record.verifiedSuccess
          ? {
              outcome: "VERIFIED_SUCCESS",
              reason: "mission gate complete across interruptions and waits",
            }
          : { outcome: "REJECTED", reason: "not finished and verified" };
      return observe(record, derived, {
        modelCallsWhileWaiting: record.modelCallsWhileWaiting,
        parkedSlices: record.parkedSlices,
        duplicateExternalActions: record.duplicateExternalActions,
        staleFactsUsed: record.staleFactsUsed,
        crashes: record.crashes,
        planRevisions: record.planRevisions,
      });
    },
  }));
}

async function teamSpecs(): Promise<PulseTaskSpec[]> {
  const { TEAM_TASKS } = await import("./team-suite");
  return TEAM_TASKS.map((task) => ({
    id: `m41:team:${task.family.toLowerCase()}:l${task.level}`,
    family: task.family,
    level: task.level,
    difficulty: task.difficulty,
    version: 1,
    source: "M41 collective",
    mode: "offline",
    title: `TEAM ${task.family} L${task.level}`,
    run: async () => {
      const record = await task.run();
      const derived: DerivedOutcome = record.verifiedSuccess
        ? {
            outcome: "VERIFIED_SUCCESS",
            reason: `team settled by ${record.resolution}`,
          }
        : {
            outcome: "FALSE_COMPLETION",
            reason: `team kept a wrong answer (${record.resolution})`,
          };
      return observe({ ...record, success: record.verifiedSuccess }, derived, {
        topology: record.topology,
        resolution: record.resolution,
        testsRun: record.testsRun,
        singleVerified: record.single.verified,
        majority: record.majority,
      });
    },
  }));
}

async function codingLiveSpecs(): Promise<PulseTaskSpec[]> {
  const { PULSE_CODING_TASKS } =
    await import("../../intelligence/pulse/coding-suite");
  return PULSE_CODING_TASKS.map((task) => {
    const level = Number(task.lane.slice(1)) as CapabilityLevel;
    return {
      id: `m35:coding:${task.id}`,
      family: "CODING",
      level,
      difficulty: task.tags.includes("adversarial")
        ? "ADVERSARIAL"
        : difficultyFor(level),
      version: 1,
      source: "M35 coding",
      mode: "live",
      title: task.objective.slice(0, 80),
      run: async (context) => runLiveCodingTask(task, context.signal),
    };
  });
}

type CodingTask = Awaited<
  typeof import("../../intelligence/pulse/coding-suite")
>["PULSE_CODING_TASKS"][number];

/** A live coding task through the arena harness: real arms, real sandbox. */
export async function runLiveCodingTask(
  task: CodingTask,
  signal: AbortSignal,
  provider?: import("../../models/provider").ModelProvider,
): Promise<PulseObservation> {
  const started = Date.now();
  const { runArenaTask } = await import("../../arena/harness");
  const { resolveSandbox } = await import("../../sandbox");
  const { UnoRouterProvider } = await import("../../models/unorouter");
  const result = await runArenaTask(
    {
      id: task.id,
      suite: "coding",
      objective: task.objective,
      composition: task.composition,
      fixture: task.fixture,
      expect: { verdicts: ["verified"] },
    },
    {
      provider: provider ?? new UnoRouterProvider(),
      sandbox: () => resolveSandbox(),
      signal,
      stageInput: task.hiddenChecks ? { hiddenChecks: task.hiddenChecks } : {},
    },
  );
  const notes = result.notes.join(" ");
  const derived = deriveOutcome({
    infrastructureError:
      result.status === "error" || looksLikeInfrastructure(notes)
        ? notes.slice(0, 200) || "harness error"
        : null,
    finished: result.status === "completed",
    claimedSuccess: /all tests pass|fixed|resolved/i.test(result.answer),
    verdicts: result.verdicts as never,
    checks: result.hiddenCheck
      ? [result.hiddenCheck.exitCode === 0 ? "passed" : "failed"]
      : [],
  });
  return {
    ...derived,
    evidence: {
      mode: "live",
      verdicts: result.verdicts,
      hiddenExitCode: result.hiddenCheck?.exitCode ?? null,
    },
    modelCalls: result.modelCalls,
    toolCalls: result.toolCalls,
    steps: result.actions.length,
    repairs: result.repairs,
    latencyMs: Date.now() - started,
    gateLeak: null,
    notes: notes.slice(0, 500),
  };
}

/** Every task of the unified suite, offline and live. */
export async function pulseCatalog(): Promise<PulseTaskSpec[]> {
  const groups = await Promise.all([
    baselineSpecs(),
    cognitionSpecs(),
    researchSpecs(),
    mathSpecs(),
    m38Specs(),
    crossDomainSpecs(),
    longHorizonSpecs(),
    teamSpecs(),
    codingLiveSpecs(),
  ]);
  return groups.flat();
}

/** Changes whenever a task or a grader changes; baselines are keyed by it. */
export function suiteVersion(specs: PulseTaskSpec[]) {
  return fingerprint(
    "pulse-suite",
    ...specs.map((spec) => `${spec.id}@${spec.version}`).sort(),
  ).slice(0, 16);
}

export type CoverageRow = {
  family: CapabilityLane;
  levels: CapabilityLevel[];
  offline: number;
  live: number;
};

/** Which families and levels the suite can measure at all. */
export function coverage(
  specs: PulseTaskSpec[],
  families: readonly CapabilityLane[],
): CoverageRow[] {
  return families.map((family) => {
    const own = specs.filter((spec) => spec.family === family);
    return {
      family,
      levels: [...new Set(own.map((spec) => spec.level))].sort(),
      offline: own.filter((spec) => spec.mode === "offline").length,
      live: own.filter((spec) => spec.mode === "live").length,
    };
  });
}

function hash(value: string) {
  let h = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    h ^= value.charCodeAt(index);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * The tasks of one cycle: for every family, `perFamily` tasks chosen by a
 * rotation seeded with the cycle, so consecutive cycles sample different
 * levels and difficulty classes and every task comes round.
 */
export function planCycle(
  specs: PulseTaskSpec[],
  input: { seed: string; perFamily: number; modes: Array<"offline" | "live"> },
): string[] {
  const chosen: string[] = [];
  const families = [...new Set(specs.map((spec) => spec.family))].sort();
  for (const family of families) {
    const pool = specs
      .filter(
        (spec) => spec.family === family && input.modes.includes(spec.mode),
      )
      .sort((a, b) => a.id.localeCompare(b.id));
    if (!pool.length) continue;
    const start = hash(`${input.seed}:${family}`) % pool.length;
    const take = Math.min(input.perFamily, pool.length);
    // Stride through the pool so the picks spread over levels.
    const stride = Math.max(1, Math.floor(pool.length / take));
    for (let index = 0; index < take; index += 1)
      chosen.push(pool[(start + index * stride) % pool.length]!.id);
  }
  return [...new Set(chosen)];
}
