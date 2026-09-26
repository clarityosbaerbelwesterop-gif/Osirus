import { describe, expect, it } from "vitest";
import { MemoryPulseStore } from "../src/lib/agent/pulse/store";
import type { PulseResult } from "../src/lib/agent/pulse/types";
import { detectGaps } from "../src/lib/intelligence/capabilities/gaps";
import {
  curriculumRequests,
  generateCurriculumTasks,
  stockCurriculum,
} from "../src/lib/intelligence/curriculum/adaptive";
import {
  ALL_ARENAS,
  RED_ARENAS,
  SELF_PLAY_ARENAS,
  researcherVsSkeptic,
  solverVsFalsifier,
} from "../src/lib/intelligence/generation/arenas";
import {
  contaminationCheck,
  generatorScore,
  nextLevel,
  playArena,
  type ChallengeArena,
} from "../src/lib/intelligence/generation/challenges";
import {
  bugGeneratorRound,
  mutationSets,
  problemGeneratorRound,
} from "../src/lib/intelligence/generation/self-play";
import { simhash } from "../src/lib/intelligence/evals/random";
import {
  accruedCalls,
  reserveCalls,
  rsiBudget,
  settleCalls,
} from "../src/lib/intelligence/rsi/budget";
import { runRsiSlice, summarize } from "../src/lib/intelligence/rsi/cycle";
import {
  chooseArenas,
  decidePhase,
  experiment,
  trialsFromEvidence,
  type LiveEvidence,
  type LiveOrderContent,
} from "../src/lib/intelligence/rsi/phases";
import { MemoryRsiStore } from "../src/lib/intelligence/rsi/store";
import { RSI_PHASES, type RsiCycle } from "../src/lib/intelligence/rsi/types";
import { MemoryIntelStore } from "../src/lib/intelligence/store/memory-store";
import {
  hypothesesFor,
  seedStrategies,
  strategyForCapability,
} from "../src/lib/intelligence/strategies/genomes";
import type { EvalTask, Experience } from "../src/lib/intelligence/types";
import type { SandboxDriver } from "../src/lib/sandbox/driver";

const T0 = Date.parse("2026-09-25T10:05:00Z");

async function seededPulse(now: number) {
  const pulse = new MemoryPulseStore();
  pulse.now = () => now;
  const cycle = (await pulse.createCycle({
    suiteVersion: "suite-a",
    taskIds: ["t1", "t2", "t3", "t4"],
  }))!;
  await pulse.leaseCycle(cycle.id, "w", 60);
  const result = (
    taskId: string,
    outcome: PulseResult["outcome"],
    extra: Partial<PulseResult> = {},
  ): PulseResult => ({
    cycleId: cycle.id,
    taskId,
    suiteVersion: "suite-a",
    family: "MEMORY_CONTEXT",
    level: 3,
    difficulty: "COMPOSED",
    mode: "offline",
    outcome,
    reason: outcome.toLowerCase(),
    evidence: {},
    modelCalls: 0,
    toolCalls: 0,
    latencyMs: 5,
    ...extra,
  });
  await pulse.recordResult(result("t1", "VERIFIED_SUCCESS"));
  await pulse.recordResult(result("t2", "REJECTED"));
  await pulse.recordResult(result("t3", "INFRASTRUCTURE_FAILURE"));
  await pulse.recordResult(
    result("t4", "FALSE_COMPLETION", { evidence: { gateLeak: true } }),
  );
  await pulse.saveBaseline({
    suiteVersion: "suite-a",
    family: "MEMORY_CONTEXT",
    level: 3,
    samples: 3,
    verified: 1,
    falseCompletions: 1,
    excluded: 1,
    rate: 1 / 3,
    lower: 0.05,
    upper: 0.8,
    regressionStreak: 0,
  });
  await pulse.completeCycle(cycle.id, "w", new Date(now).toISOString(), {
    regressions: [],
  });
  return pulse;
}

function slice(
  store: MemoryRsiStore,
  intel: MemoryIntelStore,
  pulse: MemoryPulseStore,
  now: () => number,
  extra: Partial<Parameters<typeof runRsiSlice>[0]> = {},
) {
  return runRsiSlice({
    store,
    intel,
    pulse,
    owner: "tick-a",
    deadline: now() + 60_000,
    signal: new AbortController().signal,
    model: "deepseek-v4-pro-0813:free",
    now,
    ...extra,
  });
}

describe("hourly recursive intelligence cycle", () => {
  it("runs every phase once, learns only from verified outcomes, and reports honestly", async () => {
    const now = () => T0;
    const pulse = await seededPulse(T0 - 60_000);
    const intel = new MemoryIntelStore();
    const store = new MemoryRsiStore(now);
    const report = await slice(store, intel, pulse, now);
    expect(report.completedCycle).toBe(true);
    expect(report.phasesRun).toEqual([...RSI_PHASES]);
    const [cycle] = store.all();
    const state = cycle!.state;
    // Experience: infrastructure is excluded, never taught.
    expect(state.experience).toMatchObject({
      pulseRows: 4,
      excluded: 1,
      taught: 3,
      antiPatterns: 1,
    });
    const rows = await intel.listExperience({ limit: 50 });
    expect(rows.some((row) => row.taskRef === "t3")).toBe(false);
    // Weak cell became a gap; self-play and red ran and found weaknesses.
    expect(state.health?.weakCells[0]).toMatchObject({
      family: "MEMORY_CONTEXT",
    });
    expect(state.gaps?.open).toBeGreaterThan(0);
    expect(state.selfPlay?.configs.length).toBe(2);
    expect(state.red?.attacks.length).toBe(4);
    // No live evidence: no promotion, and the summary says so.
    expect(cycle!.summary).toMatchObject({
      verifiedImprovement: false,
      promoted: 0,
    });
    expect(Object.values(state.log ?? {}).every((entry) => !entry?.error)).toBe(
      true,
    );
    // Generated tasks carry lineage and a contamination record.
    const generated = (await intel.listTasks({ limit: 500 })).filter(
      (task) => task.generator === "curriculum",
    );
    for (const task of generated) {
      expect(task.labelVerified).toBe(true);
      expect(task.labelEvidence.lineage).toBeTruthy();
      expect(task.labelEvidence.contamination).toBeTruthy();
    }
  });

  it("does not start a second cycle within the hour; a duplicate tick finds it leased", async () => {
    let clock = T0;
    const now = () => clock;
    const pulse = await seededPulse(T0 - 60_000);
    const intel = new MemoryIntelStore();
    const store = new MemoryRsiStore(now);
    await slice(store, intel, pulse, now);
    clock += 20 * 60_000;
    expect((await slice(store, intel, pulse, now)).reason).toBe("rsi_not_due");
    clock += 30 * 60_000; // 50 minutes after the start: inside the slack.
    // Two ticks at once: one steps the cycle, the other finds it leased.
    const created = await store.createCycle([...RSI_PHASES]);
    await store.leaseCycle(created!.id, "tick-b", 120);
    const second = await slice(store, intel, pulse, now);
    expect(second.reason).toBe("rsi_leased_elsewhere");
  });

  it("resumes a cycle cut off mid-way, and passes over a phase that throws", async () => {
    let clock = T0;
    const now = () => clock;
    const pulse = await seededPulse(T0 - 60_000);
    const intel = new MemoryIntelStore();
    const store = new MemoryRsiStore(now);
    const broken: ChallengeArena = {
      ...solverVsFalsifier,
      id: "broken_generator",
      generate: () => {
        throw new Error("generator crashed");
      },
    };
    // A deadline that has already passed after the first phase: the cycle
    // stops with its cursor committed.
    let steps = 0;
    const first = await runRsiSlice({
      store,
      intel,
      pulse,
      owner: "tick-a",
      deadline: T0 + 1,
      signal: new AbortController().signal,
      model: "m:free",
      now: () => (steps++ < 3 ? T0 : T0 + 10),
      selfPlayArenas: [broken],
    });
    expect(first.completedCycle).toBe(false);
    expect(first.phasesRun.length).toBeGreaterThan(0);
    const cursor = (await store.activeCycle())!.cursor;
    expect(cursor).toBe(first.phasesRun.length);
    // Another instance picks it up after the lease lapses.
    clock += 5 * 60_000;
    const second = await runRsiSlice({
      store,
      intel,
      pulse,
      owner: "tick-b",
      deadline: clock + 60_000,
      signal: new AbortController().signal,
      model: "m:free",
      now,
      selfPlayArenas: [broken],
    });
    expect(second.completedCycle).toBe(true);
    expect(second.phasesRun[0]).toBe(RSI_PHASES[cursor]);
    const done = store.all().find((cycle) => cycle.status === "completed")!;
    expect(done.state.log?.self_play?.error).toMatch(/generator crashed/);
    expect(summarize(done.state).phaseErrors).toEqual(["self_play"]);
  });
});

describe("self-play with independent verifiers", () => {
  it("covers the directive's configurations beyond coding and math", () => {
    expect(SELF_PLAY_ARENAS.map((arena) => arena.id)).toEqual([
      "researcher_vs_skeptic",
      "solver_vs_falsifier",
      "retriever_vs_contradiction",
      "planner_vs_world_change",
      "mission_vs_perturber",
    ]);
    for (const arena of ALL_ARENAS) {
      expect(new Set(arena.roles).size, arena.id).toBe(3);
      expect(arena.mechanism, arena.id).toMatch(/^src\/lib\/.+\.ts:\w/);
    }
  });

  it("judges from the generator's ground truth, never from the solver's claim", async () => {
    const [instance] = solverVsFalsifier.generate({
      seed: "s",
      level: 1,
      count: 1,
    });
    expect((await solverVsFalsifier.run(instance!)).held).toBe(true);
    // Same run, but the oracle's truth says the claim is wrong: the engine
    // cannot talk its way to "held".
    const tampered = {
      ...instance!,
      params: {
        ...instance!.params,
        claim: String(Number(instance!.params.value) + 1),
      },
    };
    expect((await solverVsFalsifier.run(tampered)).held).toBe(false);
    const [skeptic] = researcherVsSkeptic.generate({
      seed: "s",
      level: 1,
      count: 1,
    });
    expect((await researcherVsSkeptic.run(skeptic!)).held).toBe(true);
  });

  it("is deterministic per seed and new across seeds", async () => {
    const a = await playArena(solverVsFalsifier, {
      seed: "h1",
      level: 2,
      count: 4,
    });
    const b = await playArena(solverVsFalsifier, {
      seed: "h1",
      level: 2,
      count: 4,
    });
    expect(a).toEqual(b);
    const known = new Set(
      solverVsFalsifier
        .generate({ seed: "h1", level: 2, count: 4 })
        .map((i) => i.fingerprint),
    );
    const next = await playArena(solverVsFalsifier, {
      seed: "h2",
      level: 2,
      count: 4,
      known,
    });
    expect(next.novel).toBe(4);
    const again = await playArena(solverVsFalsifier, {
      seed: "h1",
      level: 2,
      count: 4,
      known,
    });
    expect(again.duplicates).toBe(4);
  });

  it("records a mechanism's failures with the instances that expose them", async () => {
    // A mechanism broken by construction (it ignores its input). Tests never
    // pin a real Osirus defect as expected behaviour: that would block the
    // very repair the software-RSI pipeline exists to make.
    const broken: ChallengeArena = {
      ...solverVsFalsifier,
      id: "broken_mechanism",
      run: async (instance) => ({
        held: instance.level < 3,
        detail: `ignores level ${instance.level}`,
      }),
    };
    const round = await playArena(broken, { seed: "h9", level: 4, count: 4 });
    expect(round.failed).toBe(4);
    expect(round.failures[0]!.id).toMatch(/^broken_mechanism:h9:L4:/);
    expect(round.failures[0]!.detail).toBe("ignores level 4");
    expect(
      (await playArena(broken, { seed: "h9", level: 2, count: 4 })).failed,
    ).toBe(0);
  });

  it("raises difficulty after two clean rounds and explores after a confirmed failure", () => {
    const clean = { held: 4, instances: 4 };
    const dirty = { held: 2, instances: 4 };
    expect(nextLevel([], 5)).toBe(1);
    expect(nextLevel([{ level: 2, ...clean }], 5)).toBe(2);
    expect(
      nextLevel(
        [
          { level: 2, ...clean },
          { level: 2, ...clean },
        ],
        5,
      ),
    ).toBe(3);
    expect(
      nextLevel(
        [
          { level: 5, ...clean },
          { level: 5, ...clean },
        ],
        5,
      ),
    ).toBe(5);
    expect(
      nextLevel(
        [
          { level: 4, ...dirty },
          { level: 4, ...dirty },
        ],
        5,
      ),
    ).toBe(5);
    expect(
      nextLevel(
        [
          { level: 5, ...dirty },
          { level: 5, ...dirty },
        ],
        5,
      ),
    ).toBe(1);
  });

  it("scores generators and retires the ones that stopped teaching anything", () => {
    const base = {
      arenaId: "x",
      kind: "red" as const,
      instances: 4,
      held: 4,
      failed: 0,
      novel: 4,
      duplicates: 0,
      invalid: 0,
      failures: [],
      novelty: 1,
    };
    const saturated = generatorScore({ ...base, level: 3 }, 3);
    const finding = generatorScore(
      { ...base, level: 3, held: 2, failed: 2 },
      3,
    );
    const broken = generatorScore(
      { ...base, level: 1, invalid: 4, held: 0 },
      3,
    );
    expect(finding).toBeGreaterThan(saturated);
    expect(saturated).toBeGreaterThan(broken);
    const memory = new Map([
      [
        "stale_facts",
        {
          rounds: [1, 2, 3].map(() => ({
            level: 4,
            held: 4,
            instances: 4,
            score: 0.2,
          })),
          known: new Set<string>(),
          corpus: [],
        },
      ],
    ]);
    const { picked, retired } = chooseArenas(RED_ARENAS, memory, 5, 4);
    expect(retired).toEqual(["stale_facts"]);
    expect(picked.map((arena) => arena.id)).not.toContain("stale_facts");
  });
});

describe("red intelligence v2", () => {
  it("attacks every class the directive names", () => {
    const ids = RED_ARENAS.map((arena) => arena.id);
    for (const required of [
      "stale_facts",
      "conflicting_memory",
      "misleading_source",
      "prompt_injection",
      "false_authority",
      "incorrect_tool_result",
      "partial_tool_failure",
      "false_success_signal",
      "misleading_worker",
      "hidden_dependency",
      "contradictory_requirements",
      "context_overflow",
      "wrong_units",
      "underdetermined_problem",
      "stale_deployment_state",
      "plan_corruption",
      "handoff_loss",
      "wrong_specialist",
      "premature_completion",
    ])
      expect(ids).toContain(required);
  });

  it("marks trust-root mechanisms so their repairs need the operator", () => {
    const trust = RED_ARENAS.filter((arena) => arena.trustRoot).map(
      (a) => a.id,
    );
    expect(trust).toContain("prompt_injection");
    expect(trust).toContain("incorrect_tool_result");
  });

  it("keeps the outcome rule honest under every false-success attack", async () => {
    for (const arena of RED_ARENAS.filter((entry) =>
      [
        "incorrect_tool_result",
        "partial_tool_failure",
        "false_success_signal",
      ].includes(entry.id),
    ))
      for (let level = 1; level <= arena.maxLevel; level += 1) {
        const round = await playArena(arena, { seed: "t", level, count: 2 });
        expect(round.failed, `${arena.id} L${level}`).toBe(0);
      }
  });
});

describe("anti-contamination and the adaptive curriculum", () => {
  it("rejects a dev task near a held-out text, and exact duplicates", () => {
    const holdout =
      "Press release says the satellite orbits at 700 km; tracking says 550 km. Which altitude?";
    const check = contaminationCheck({
      fingerprint: "f",
      text: holdout.replace("700", "710"),
      known: new Set(["g"]),
      holdoutHashes: [simhash(holdout)],
    });
    expect(check.contaminated).toBe(true);
    expect(
      contaminationCheck({
        fingerprint: "g",
        text: "x",
        known: new Set(["g"]),
        holdoutHashes: [],
      }).duplicate,
    ).toBe(true);
  });

  it("keeps held-out templates apart from dev templates", () => {
    const tasks = [0, 1, 2, 3, 4, 5].flatMap((round) =>
      generateCurriculumTasks(
        {
          capabilityId: "memory.context",
          generator: "fresh_fact",
          reason: "test",
          difficulty: 3,
          count: 3,
        },
        round,
      ),
    );
    const holdout = tasks.filter((task) => task.partition === "holdout");
    const dev = tasks.filter((task) => task.partition === "dev");
    expect(holdout.length).toBeGreaterThan(0);
    expect(dev.length).toBeGreaterThan(0);
    for (const task of holdout)
      expect(task.labelEvidence.lineage).toMatchObject({ template: 2 });
  });

  it("asks for work from gaps, weak cells and strengths, and stores it once", async () => {
    const requests = curriculumRequests({
      gaps: [
        { capabilityId: "memory.context", summary: "stale facts", support: 4 },
      ],
      weakCells: [
        {
          family: "RESEARCH",
          level: 4,
          rate: 0.5,
          lower: 0.2,
          samples: 4,
          falseCompletions: 0,
        },
      ],
      strong: ["math.quantitative"],
      limit: 5,
    });
    expect(requests.map((request) => request.generator)).toEqual([
      "fresh_fact",
      "conflicting_sources",
      "math_variant",
    ]);
    expect(requests[2]!.reason).toMatch(/harder version/);
    const store = new MemoryIntelStore();
    const first = await stockCurriculum(store, requests, 7);
    expect(first.stored).toBeGreaterThan(0);
    const again = await stockCurriculum(store, requests, 7);
    expect(again.stored).toBe(0);
    expect(again.duplicates).toBe(first.generated - first.contaminated);
  });
});

describe("self-play generator repairs", () => {
  it("rotates mutation sets and moves to pairs once singles are spent", () => {
    const sets = mutationSets(0, ["a", "b", "c"]);
    expect(sets.slice(0, 3)).toEqual([["a"], ["b"], ["c"]]);
    expect(sets).toContainEqual(["a", "c"]);
    expect(mutationSets(1, ["a", "b"])[0]).toEqual(["b"]);
  });

  it("keeps a holdout family's variants in holdout, with lineage", async () => {
    const store = new MemoryIntelStore();
    await problemGeneratorRound(store, {
      round: 3,
      perFamily: 1,
      cycleId: null,
    });
    const generated = (await store.listTasks({ limit: 500 })).filter(
      (task) => task.generator === "self_play",
    );
    const partitions = new Set(generated.map((task) => task.partition));
    expect(partitions.has("holdout")).toBe(true);
    for (const task of generated) {
      expect(task.parentId).toBeTruthy();
      const parent = await store.getTask(task.parentId!);
      expect(parent?.partition).toBe(task.partition);
    }
  });

  it("gives a mutant its family's partition and does not re-run a known mutant", async () => {
    const commands: string[] = [];
    const sandbox: SandboxDriver = {
      id: "fake",
      availability: () => ({
        configured: true,
        driver: "fake",
        reason: "test",
      }),
      create: async () => ({
        sandboxId: "s",
        writeFiles: async () => undefined,
        readFile: async () => null,
        listFiles: async () => [],
        runCommand: async (input) => {
          commands.push(input.cmd);
          return {
            command: input.cmd,
            exitCode: 1,
            stdout: "",
            stderr: "",
            durationMs: 1,
          };
        },
        previewUrl: () => null,
        stop: async () => undefined,
      }),
    };
    const store = new MemoryIntelStore();
    const first = await bugGeneratorRound(store, {
      sandbox: async () => sandbox,
      limit: 30,
      cycleId: null,
      round: 0,
    });
    expect(first.verified).toBeGreaterThan(0);
    const mutants = (await store.listTasks({ limit: 500 })).filter(
      (task) => task.generator === "self_play",
    );
    for (const task of mutants) {
      const parent = await store.getTask(task.parentId!);
      expect(parent?.partition).toBe(task.partition);
      expect(task.labelEvidence.lineage).toBeTruthy();
    }
    const ran = commands.length;
    const second = await bugGeneratorRound(store, {
      sandbox: async () => sandbox,
      limit: 30,
      cycleId: null,
      round: 0,
    });
    // Everything first-round-reachable is known: at most new pairs run.
    expect(commands.length - ran).toBeLessThanOrEqual(second.produced);
    const runs = await store.listGenerationRuns(5);
    expect(runs[0]!.summary.duplicates).toBeGreaterThan(0);
  });

  it("counts gap support as distinct evidence, not a running sum", async () => {
    const store = new MemoryIntelStore();
    const row = (id: string) =>
      ({
        id,
        source: "trial",
        taskType: "math",
        outcome: "failure",
        failureClass: "no_answer",
        trajectory: {},
      }) as unknown as Experience;
    const rows = [row("a"), row("b")];
    await detectGaps(store, "math.quantitative", rows);
    await detectGaps(store, "math.quantitative", rows);
    const [gap] = await store.listGaps("math.quantitative");
    expect(gap!.support).toBe(2);
    await detectGaps(store, "math.quantitative", [...rows, row("c")]);
    expect((await store.listGaps("math.quantitative"))[0]!.support).toBe(3);
  });
});

describe("live experiments, promotion and rollback", () => {
  async function withOrder(outcomes: Array<[boolean, boolean]>) {
    const intel = new MemoryIntelStore();
    const store = new MemoryRsiStore(() => T0);
    const pulse = await seededPulse(T0 - 60_000);
    await slice(store, intel, pulse, () => T0);
    const champion = (await intel.listVersions("math.quantitative")).find(
      (version) => version.status === "champion",
    )!;
    const evidence: LiveEvidence = {
      trials: outcomes.flatMap(([champ, chall], index) => [
        {
          taskId: `t${index}`,
          partition: index % 3 === 2 ? "holdout" : "dev",
          side: "champion" as const,
          verified: champ,
          falseCompletion: false,
          failureClass: null,
          modelCalls: 2,
          tokens: 100,
          latencyMs: 1,
        },
        {
          taskId: `t${index}`,
          partition: index % 3 === 2 ? "holdout" : "dev",
          side: "challenger" as const,
          verified: chall,
          falseCompletion: false,
          failureClass: null,
          modelCalls: 2,
          tokens: 100,
          latencyMs: 1,
        },
      ]),
      benchmark: [],
      spent: { modelCalls: 8, tokens: 800 },
      runner: { runId: null, startedAt: "", finishedAt: "" },
    };
    const content: LiveOrderContent = {
      orderId: "order-1",
      rsiCycle: "c",
      capabilityId: "math.quantitative",
      strategyId: "math.quantitative",
      model: "m:free",
      hypothesis: {
        id: "h1",
        class: "tool",
        capabilityId: "math.quantitative",
        gap: "tool",
        statement: "compute first",
        expected: "more verified",
        intervention: { math: { computeFirst: true } },
        origin: "library",
        lane: "live",
      },
      champion: { versionId: champion.id, genome: {} },
      challenger: { genome: { math: { computeFirst: true } } },
      tasks: [],
      benchmark: [],
      calls: 6,
      state: "evidence",
      evidence,
    };
    await intel.upsertArtifact({
      cycleId: null,
      kind: "live_order",
      capabilityId: "math.quantitative",
      taskPattern: "math.quantitative",
      content: content as unknown as Record<string, unknown>,
      evidence: { createdAt: new Date(T0).toISOString() },
      support: 1,
      status: "proposed",
      fingerprint: "order-1",
    });
    const cycle = store.all()[0]!;
    return { intel, pulse, cycle, champion };
  }

  it("promotes a challenger only on the decision rule, inside the Intelligence Plane", async () => {
    const { intel, pulse, cycle } = await withOrder([
      [false, true],
      [false, true],
      [true, true],
      [false, true],
      [false, true],
      [true, true],
    ]);
    const result = await decidePhase({
      intel,
      pulse,
      cycle,
      previous: null,
      now: () => T0,
      model: "m:free",
    });
    expect(result.state.decision?.promoted).toBe(1);
    const versions = await intel.listVersions("math.quantitative");
    const crowned = versions.find((version) => version.status === "champion")!;
    expect(crowned.genome).toEqual({ math: { computeFirst: true } });
    // Never active or canary: the product reads only those.
    expect(
      versions.some((version) => ["active", "canary"].includes(version.status)),
    ).toBe(false);
    const meta = await intel.listArtifacts({ kind: "meta_policy" });
    expect(meta.length).toBe(1);
  });

  it('does not promote on too little evidence ("no verified improvement" is valid)', async () => {
    const { intel, pulse, cycle } = await withOrder([[false, true]]);
    const result = await decidePhase({
      intel,
      pulse,
      cycle,
      previous: null,
      now: () => T0,
      model: "m:free",
    });
    expect(result.state.decision?.promoted).toBe(0);
    expect(result.note).toMatch(/inconclusive/);
  });

  it("quarantines a promoted version after a confirmed pulse regression and rolls back", async () => {
    const { intel, pulse, cycle } = await withOrder([
      [false, true],
      [false, true],
      [true, true],
      [false, true],
      [false, true],
      [true, true],
    ]);
    await decidePhase({
      intel,
      pulse,
      cycle,
      previous: null,
      now: () => T0,
      model: "m:free",
    });
    const regressed: RsiCycle = {
      ...cycle,
      state: {
        ...cycle.state,
        health: {
          ...cycle.state.health!,
          regressions: [
            { family: "MATH_SCIENCE", level: 3, kind: "verified_drop" },
          ],
        },
      },
    };
    const result = await decidePhase({
      intel,
      pulse,
      cycle: regressed,
      previous: null,
      now: () => T0 + 60_000,
      model: "m:free",
    });
    expect(result.state.decision).toMatchObject({
      quarantined: 1,
      rolledBack: 1,
    });
    const versions = await intel.listVersions("math.quantitative");
    expect(versions.some((version) => version.status === "quarantined")).toBe(
      true,
    );
    expect(
      versions.find((version) => version.status === "champion")!.genome,
    ).toEqual({});
  });

  it("turns live evidence into paired Foundry trials", () => {
    const trials = trialsFromEvidence(
      "o",
      {
        trials: [
          {
            taskId: "a",
            partition: "dev",
            side: "champion",
            verified: true,
            falseCompletion: false,
            failureClass: null,
            modelCalls: 3,
            tokens: 10,
            latencyMs: 1,
          },
        ],
        benchmark: [],
        spent: { modelCalls: 3, tokens: 10 },
        runner: { runId: null, startedAt: "", finishedAt: "" },
      },
      { champion: "c", challenger: "x" },
    );
    expect(trials[0]).toMatchObject({
      strategyVersionId: "c",
      evalTaskId: "a",
      status: "completed",
    });
  });

  it("opens a live order only within the call envelope", async () => {
    const intel = new MemoryIntelStore();
    const store = new MemoryRsiStore(() => T0);
    const pulse = await seededPulse(T0 - 60_000);
    // Spend the day's accrued allowance first: the cycle opens no order.
    await intel.addUsage("rsi_model_calls", 48, "2026-09-25");
    await slice(store, intel, pulse, () => T0);
    const cycle = store.all()[0]!;
    const withLive = {
      ...cycle,
      state: {
        ...cycle.state,
        hypotheses: {
          items: [
            {
              id: "h",
              class: "tool" as const,
              capabilityId: "math.quantitative",
              gap: "tool" as const,
              statement: "s",
              expected: "e",
              intervention: { math: { computeFirst: true } },
              origin: "library",
              lane: "live" as const,
            },
          ],
        },
      },
    };
    const spent = await experiment({
      intel,
      pulse,
      cycle: withLive,
      previous: null,
      now: () => T0,
      model: "m:free",
    });
    expect(spent.note).toMatch(/offline work only/);
  });

  it("passes over a live hypothesis it cannot test and opens the order for one it can", async () => {
    // Production had only coding.debug hypotheses (no sandbox-free tasks)
    // and reasoning tasks without a strategy, so no order ever opened.
    expect(strategyForCapability("reasoning.falsification")?.id).toBe(
      "general.reasoning",
    );
    expect(strategyForCapability("memory.context")?.kind).toBe("general");
    expect(
      hypothesesFor(
        "general",
        [
          {
            id: "g",
            capabilityId: "reasoning.planning",
            kind: "planning",
            summary: "s",
            evidence: {},
            support: 2,
            status: "open",
          } as never,
        ],
        {},
        4,
      ).length,
    ).toBeGreaterThan(0);
    const intel = new MemoryIntelStore();
    const pulse = await seededPulse(T0 - 60_000);
    await seedStrategies(intel, "m:free");
    const cycle: RsiCycle = {
      id: "cycle-live",
      phases: [...RSI_PHASES],
      cursor: 0,
      status: "running",
      leaseOwner: null,
      leaseExpiresAt: null,
      state: {},
      startedAt: new Date(T0).toISOString(),
      completedAt: null,
      nextDueAt: null,
      summary: {},
    };
    const task = (
      partition: "dev" | "holdout",
      index: number,
    ): Omit<EvalTask, "id"> => ({
      suite: "rsi.planning",
      capabilityId: "reasoning.planning",
      partition,
      difficulty: {} as EvalTask["difficulty"],
      difficultyScore: 1,
      spec: {
        kind: "general",
        objective: `Order the steps ${index}`,
        verify: { kind: "includes", all: [`step-${index}`], none: [] },
        composition: ["general"],
      } as unknown as EvalTask["spec"],
      generator: "curriculum",
      fingerprint: `planning-${partition}-${index}`,
      parentId: null,
      labelVerified: true,
      labelEvidence: {},
    });
    await intel.insertTasks([
      task("dev", 1),
      task("dev", 2),
      task("holdout", 3),
    ]);
    const live = (capabilityId: string, id: string) => ({
      id,
      class: "strategy" as const,
      capabilityId,
      gap: "planning" as const,
      statement: "s",
      expected: "e",
      intervention: { modelUse: { promptStyle: "task_first" } },
      origin: "library",
      lane: "live" as const,
    });
    const opened = await experiment({
      intel,
      pulse,
      cycle: {
        ...cycle,
        state: {
          ...cycle.state,
          hypotheses: {
            items: [
              live("coding.debug", "h-coding"),
              live("reasoning.planning", "h-planning"),
            ],
          },
        },
      },
      previous: null,
      now: () => T0,
      model: "m:free",
    });
    expect(opened.note).toMatch(/^live order/);
    const [order] = await intel.listArtifacts({ kind: "live_order" });
    const content = order!.content as unknown as LiveOrderContent;
    expect(content.strategyId).toBe("general.reasoning");
    expect(content.capabilityId).toBe("reasoning.planning");
    expect(content.hypothesis.id).toBe("h-planning");
    expect(content.tasks.map((entry) => entry.partition).sort()).toEqual([
      "dev",
      "dev",
      "holdout",
    ]);
  });
});

describe("live-call envelope", () => {
  it("accrues two calls an hour up to 48 and never lets one order take more than 12", async () => {
    expect(accruedCalls(new Date("2026-09-25T00:10:00Z"))).toBe(2);
    expect(accruedCalls(new Date("2026-09-25T23:10:00Z"))).toBe(48);
    const store = new MemoryIntelStore();
    const at = new Date("2026-09-25T10:10:00Z");
    expect((await rsiBudget(store, at)).available).toBe(12);
    const first = await reserveCalls(store, 20, at);
    expect(first.granted).toBe(12);
    await settleCalls(store, {
      reserved: 12,
      spent: 4,
      tokens: 900,
      day: first.budget.day,
    });
    const usage = await store.usage(first.budget.day);
    expect(usage.rsi_model_calls).toBe(4);
    expect(usage.model_calls).toBe(4);
    await store.addUsage("rsi_model_calls", 18, first.budget.day);
    expect((await reserveCalls(store, 3, at)).granted).toBe(0);
  });
});

describe("state the pipeline and the cycle share", () => {
  it("keeps an attempted or opened code hypothesis's state when the finding recurs", async () => {
    const now = () => T0;
    const pulse = await seededPulse(T0 - 60_000);
    const intel = new MemoryIntelStore();
    const store = new MemoryRsiStore(now);
    const broken: ChallengeArena = {
      ...solverVsFalsifier,
      id: "always_broken",
      run: async () => ({ held: false, detail: "broken" }),
    };
    await slice(store, intel, pulse, now, { selfPlayArenas: [broken] });
    const [first] = await intel.listArtifacts({ kind: "code_hypothesis" });
    expect(first).toBeTruthy();
    // The pipeline opened a pull request for it.
    await intel.upsertArtifact({
      ...first!,
      content: {
        ...first!.content,
        attempts: 1,
        lastAttemptAt: "2026-09-25T09:00:00Z",
      },
      status: "active",
    });
    const later = () => T0 + 2 * 3_600_000;
    await slice(store, intel, pulse, later, { selfPlayArenas: [broken] });
    const [again] = (
      await intel.listArtifacts({ kind: "code_hypothesis" })
    ).filter((entry) => entry.fingerprint === first!.fingerprint);
    expect(again!.status).toBe("active");
    expect(again!.content).toMatchObject({
      attempts: 1,
      lastAttemptAt: "2026-09-25T09:00:00Z",
    });
  });

  it("reopens an addressed gap only when new evidence arrives", async () => {
    const intel = new MemoryIntelStore();
    const gap = {
      capabilityId: "memory.context",
      kind: "memory" as const,
      summary: "arena L3: addFacts fails 2/4",
      evidence: { experienceIds: ["a:1", "a:2"] },
      support: 2,
      status: "open" as const,
    };
    await intel.upsertGap(gap);
    await intel.upsertGap({ ...gap, status: "addressed" });
    // The same evidence again does not reopen it.
    await intel.upsertGap(gap);
    expect((await intel.listGaps())[0]!.status).toBe("addressed");
    // A failure it has not seen before does.
    await intel.upsertGap({ ...gap, evidence: { experienceIds: ["a:9"] } });
    const [reopened] = await intel.listGaps();
    expect(reopened!.status).toBe("open");
    expect(reopened!.support).toBe(3);
  });
});
