import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { decide, screen } from "../src/lib/intelligence/experiments/analysis";
import {
  differenceInterval,
  probabilityBetter,
  signTestP,
} from "../src/lib/intelligence/experiments/stats";
import {
  codingFamilies,
  codingTask,
  referenceFix,
} from "../src/lib/intelligence/evals/coding-fixtures";
import {
  extractNumber,
  mathFamilies,
  mathTask,
} from "../src/lib/intelligence/evals/math-tasks";
import { hamming, simhash } from "../src/lib/intelligence/evals/random";
import {
  judge,
  trialResultFrom,
} from "../src/lib/intelligence/executors/judge";
import { InProcessExecutor } from "../src/lib/intelligence/executors/in-process";
import { foundryStep } from "../src/lib/intelligence/loop/research-loop";
import {
  canaryDecision,
  canaryEligible,
  transition,
} from "../src/lib/intelligence/promotion/promotion";
import { MemoryIntelStore } from "../src/lib/intelligence/store/memory-store";
import { analyzeExperience } from "../src/lib/intelligence/capabilities/gaps";
import { measure } from "../src/lib/intelligence/capabilities/registry";
import { buildDatasets } from "../src/lib/intelligence/datasets/builder";
import {
  attemptTraining,
  candidateTrained,
  candidateTransitionProblems,
  NoTrainingProvider,
  type TrainingProvider,
} from "../src/lib/intelligence/models/training";
import {
  architectureComparison,
  architectureOf,
} from "../src/lib/intelligence/strategies/genomes";
import {
  DEFAULT_SETTINGS,
  type EvalTask,
  type Experience,
  type StrategyVersion,
  type Trial,
} from "../src/lib/intelligence/types";
import type { ModelProvider } from "../src/lib/models/provider";
import {
  boundsUnder,
  CHAMPION_BASELINE,
  directivesUnder,
  parsePolicy,
} from "../src/lib/strategy/runtime";
import { choosePolicy } from "../src/lib/strategy/resolve";
import { DEFAULT_BOUNDS } from "../src/lib/agent/loop";
import { UnconfiguredSandbox } from "../src/lib/sandbox/driver";

describe("foundry statistics", () => {
  it("weighs a clear paired win as likely better and a tie as a coin flip", () => {
    expect(
      probabilityBetter(
        { successes: 5, trials: 6 },
        { successes: 1, trials: 6 },
      ),
    ).toBeGreaterThan(0.97);
    expect(
      probabilityBetter(
        { successes: 3, trials: 6 },
        { successes: 3, trials: 6 },
      ),
    ).toBeCloseTo(0.5, 2);
    expect(
      probabilityBetter(
        { successes: 0, trials: 6 },
        { successes: 6, trials: 6 },
      ),
    ).toBeLessThan(0.01);
  });

  it("computes an exact one-sided sign test", () => {
    expect(signTestP(0, 0)).toBe(1);
    expect(signTestP(4, 0)).toBeCloseTo(1 / 16, 6);
    expect(signTestP(1, 1)).toBeCloseTo(0.75, 6);
  });

  it("reports an interval that contains zero for small equal samples", () => {
    const interval = differenceInterval(
      { successes: 2, trials: 4 },
      { successes: 2, trials: 4 },
    );
    expect(interval.low).toBeLessThan(0);
    expect(interval.high).toBeGreaterThan(0);
  });
});

function trial(
  version: string,
  task: string,
  partition: Trial["partition"],
  verified: boolean,
  overrides: Partial<NonNullable<Trial["result"]>> = {},
): Trial {
  return {
    id: `${version}-${task}-${partition}`,
    experimentId: "e",
    strategyVersionId: version,
    evalTaskId: task,
    partition,
    replicate: 1,
    status: "completed",
    runId: null,
    attempts: 1,
    result: {
      success: true,
      verified,
      falseCompletion: !verified,
      failureClass: verified ? null : "wrong_fix",
      costUsd: 0,
      tokens: 100,
      latencyMs: 1000,
      modelCalls: 5,
      toolCalls: 3,
      repairs: 0,
      verdicts: [],
      notes: [],
      answerExcerpt: "",
      check: { passed: verified, detail: "" },
      ...overrides,
    },
  };
}

describe("champion/challenger decision", () => {
  const dev = ["a", "b", "c", "d"];
  const holdout = ["h1", "h2"];

  it("accepts a challenger that wins on dev and holds on holdout and adversarial", () => {
    const trials = [
      ...dev.map((task, index) => trial("champ", task, "dev", index === 0)),
      ...dev.map((task) => trial("chal", task, "dev", true)),
      ...holdout.map((task) => trial("champ", task, "holdout", false)),
      ...holdout.map((task) => trial("chal", task, "holdout", true)),
      trial("champ", "x", "adversarial", false),
      trial("chal", "x", "adversarial", true),
    ];
    expect(screen(trials, "champ", ["chal"])[0]?.id).toBe("chal");
    const decision = decide(trials, "champ", ["chal"], "chal");
    expect(decision.outcome).toBe("improved");
    expect(decision.winnerVersionId).toBe("chal");
  });

  it("does not call a small difference an improvement", () => {
    const trials = [
      ...dev.map((task, index) => trial("champ", task, "dev", index < 2)),
      ...dev.map((task, index) => trial("chal", task, "dev", index < 3)),
      ...holdout.map((task) => trial("champ", task, "holdout", true)),
      ...holdout.map((task) => trial("chal", task, "holdout", true)),
    ];
    expect(decide(trials, "champ", ["chal"], "chal").outcome).toBe(
      "inconclusive",
    );
  });

  it("ignores trials the provider aborted", () => {
    const trials = [
      ...dev.map((task) => trial("champ", task, "dev", false)),
      ...dev.map((task) =>
        trial("chal", task, "dev", false, {
          failureClass: "provider:rate_limited",
        }),
      ),
    ];
    expect(screen(trials, "champ", ["chal"])).toEqual([]);
  });

  it("rejects when the finalist is worse", () => {
    const trials = [
      ...dev.map((task) => trial("champ", task, "dev", true)),
      ...dev.map((task) => trial("chal", task, "dev", false)),
    ];
    expect(decide(trials, "champ", ["chal"], "chal").outcome).toBe("regressed");
  });
});

describe("generated tasks", () => {
  it("every coding family fails as shipped and passes visible and hidden tests with its reference fix", () => {
    for (const family of codingFamilies()) {
      const task = codingTask({ familyId: family.id, distractors: 0 });
      const run = (files: Array<{ path: string; content: string }>) => {
        const dir = mkdtempSync(join(tmpdir(), "fixture-"));
        for (const file of files) {
          mkdirSync(dirname(join(dir, file.path)), { recursive: true });
          writeFileSync(join(dir, file.path), file.content);
        }
        try {
          execFileSync("node", ["--test"], { cwd: dir, stdio: "pipe" });
          return 0;
        } catch {
          return 1;
        }
      };
      expect(
        run(task.spec.fixture!),
        `${family.id} should fail as shipped`,
      ).toBe(1);
      const verify =
        task.spec.verify.kind === "tests" ? task.spec.verify.files : [];
      const fixed = [
        ...referenceFix(family.id).filter(
          (file) => !file.path.startsWith("test/"),
        ),
        ...verify,
      ];
      expect(run(fixed), `${family.id} reference fix should pass`).toBe(0);
    }
  }, 120_000);

  it("math labels are computed and extraction reads the committed number", () => {
    for (const { family } of mathFamilies()) {
      const task = mathTask({ family, variant: 3 });
      expect(task.labelVerified).toBe(true);
      expect(task.spec.verify.kind).toBe("numeric");
    }
    expect(extractNumber("Work: 2 + 2 = 4.\nFinal answer: 17")).toBe(17);
    expect(extractNumber("The result is 2.5, checked against 3 cases.")).toBe(
      3,
    );
    expect(extractNumber("It is 3/4.")).toBe(0.75);
    expect(extractNumber("no number here")).toBeNull();
  });

  it("the judge follows the hidden tests and the computed value, not the agent", () => {
    const tests = {
      kind: "tests" as const,
      files: [],
      command: ["node", "--test"],
    };
    const base = {
      status: "completed" as const,
      answer: "All tests pass!",
      verdicts: ["verified"],
      notes: [],
    };
    expect(
      judge(tests, { ...base, hiddenCheck: { exitCode: 1, output: "fail" } })
        .passed,
    ).toBe(false);
    expect(
      judge(tests, { ...base, hiddenCheck: { exitCode: 0, output: "" } })
        .passed,
    ).toBe(true);
    expect(judge(tests, { ...base, hiddenCheck: null }).passed).toBe(false);
    const numeric = { kind: "numeric" as const, value: 0.25, tolerance: 1e-3 };
    expect(
      judge(numeric, {
        ...base,
        hiddenCheck: null,
        answer: "Final answer: 0.25",
      }).passed,
    ).toBe(true);
    expect(
      judge(numeric, { ...base, hiddenCheck: null, answer: "0.3" }).passed,
    ).toBe(false);
  });

  it("near-duplicate texts have close simhashes", () => {
    const a = simhash("fix the median bug in stats module for even arrays");
    const b = simhash("fix the median bug in the stats module for even arrays");
    const c = simhash(
      "compute the determinant of a three by three matrix quickly",
    );
    expect(hamming(a, b)).toBeLessThan(hamming(a, c));
  });
});

describe("strategy policy at runtime", () => {
  it("an empty genome is exactly the previous constants", () => {
    const armBounds = {
      maxSteps: 30,
      maxModelCalls: 32,
      maxToolCalls: 28,
      maxWallMs: 200_000,
      maxConsecutiveFailures: 4,
      yieldOnWallClock: true,
    };
    expect(boundsUnder(CHAMPION_BASELINE, armBounds, DEFAULT_BOUNDS)).toEqual(
      armBounds,
    );
    expect(directivesUnder(CHAMPION_BASELINE, "coding")).toEqual([]);
  });

  it("scales bounds by compute tier and adds genome directives", () => {
    const policy = parsePolicy({
      genome: { computeTier: "DEEP", math: { finalLine: true } },
    });
    const bounds = boundsUnder(policy, {}, DEFAULT_BOUNDS);
    expect(bounds.maxModelCalls).toBe(
      Math.round(DEFAULT_BOUNDS.maxModelCalls * 1.5),
    );
    expect(directivesUnder(policy, "math_science").join(" ")).toMatch(
      /Final answer/,
    );
  });

  it("malformed or unknown genome fields fall back to the baseline", () => {
    expect(parsePolicy({ genome: { computeTier: "INFINITE" } })).toEqual(
      CHAMPION_BASELINE,
    );
    expect(parsePolicy({ genome: { secrets: "x" } })).toEqual(
      CHAMPION_BASELINE,
    );
    expect(parsePolicy("nope")).toEqual(CHAMPION_BASELINE);
  });

  it("assigns canaries by a stable bucket and prefers them only inside their percentage", () => {
    const active = {
      id: "a",
      label: "s v2",
      genome: {},
      status: "active" as const,
      canaryPercent: 0,
    };
    const canary = {
      id: "c",
      label: "s v3",
      genome: { computeTier: "DEEP" },
      status: "canary" as const,
      canaryPercent: 20,
    };
    let canaryRuns = 0;
    for (let index = 0; index < 1000; index += 1)
      if (
        choosePolicy([canary, active], `run-${index}`).assignment === "canary"
      )
        canaryRuns += 1;
    expect(canaryRuns).toBeGreaterThan(120);
    expect(canaryRuns).toBeLessThan(280);
    expect(choosePolicy([], "run-1")).toEqual(CHAMPION_BASELINE);
  });
});

describe("promotion and canary", () => {
  const version = (overrides: Partial<StrategyVersion>): StrategyVersion => ({
    id: "v",
    strategyId: "coding.debug",
    kind: "coding",
    version: 2,
    genome: {},
    parentId: null,
    mutation: { operator: "hypothesis", rationale: "" },
    status: "champion",
    riskClass: "low",
    model: "m",
    canaryPercent: 0,
    metrics: {},
    ...overrides,
  });

  it("advances, holds, activates and rolls back on evidence", () => {
    expect(
      canaryDecision(version({ canaryPercent: 1 }), {
        versionId: "v",
        runs: 5,
        verifiedRate: 0.9,
        baselineRate: 0.5,
      }).action,
    ).toBe("hold");
    expect(
      canaryDecision(version({ canaryPercent: 5 }), {
        versionId: "v",
        runs: 30,
        verifiedRate: 0.6,
        baselineRate: 0.55,
      }),
    ).toMatchObject({ action: "advance", percent: 20 });
    expect(
      canaryDecision(version({ canaryPercent: 100 }), {
        versionId: "v",
        runs: 30,
        verifiedRate: 0.6,
        baselineRate: 0.55,
      }).action,
    ).toBe("activate");
    expect(
      canaryDecision(version({ canaryPercent: 20 }), {
        versionId: "v",
        runs: 30,
        verifiedRate: 0.3,
        baselineRate: 0.6,
      }).action,
    ).toBe("rollback");
  });

  it("never canaries a version verified on another model, or with auto-canary off", () => {
    const settings = {
      ...DEFAULT_SETTINGS,
      flags: { ...DEFAULT_SETTINGS.flags, autoCanary: true },
      productModel: "grok-4.6",
    };
    expect(
      canaryEligible(version({ model: "free-model" }), settings).eligible,
    ).toBe(false);
    expect(
      canaryEligible(version({ model: "grok-4.6" }), settings).eligible,
    ).toBe(true);
    expect(
      canaryEligible(version({ model: "grok-4.6" }), DEFAULT_SETTINGS).eligible,
    ).toBe(false);
  });

  it("refuses to move a high-risk asset towards the product", async () => {
    const store = new MemoryIntelStore();
    await expect(
      transition(store, version({ riskClass: "high" }), "canary", {}),
    ).rejects.toThrow(/high_risk/);
    await expect(
      transition(store, version({ status: "rejected" }), "champion", {}),
    ).rejects.toThrow(/illegal/);
  });
});

describe("capabilities and gaps", () => {
  const row = (overrides: Partial<Experience>): Experience => ({
    id: "x",
    source: "trial",
    taskRef: "t",
    taskType: "coding",
    capabilityIds: ["coding.debug"],
    difficulty: 3,
    strategyVersionId: "v",
    model: "m",
    skills: [],
    tools: [],
    trajectory: { actions: [] },
    verification: { verdicts: [] },
    outcome: "failure",
    failureClass: "wrong_fix",
    repairs: 0,
    costUsd: 0,
    tokens: 0,
    latencyMs: 0,
    confidence: null,
    qualityScore: 0.5,
    fingerprint: "f",
    partition: "dev",
    provenance: {},
    createdAt: new Date().toISOString(),
    ...overrides,
  });

  it("names the missing piece from the trajectory", () => {
    expect(
      analyzeExperience(
        row({
          trajectory: {
            actions: [
              {
                action: "USE_TOOL",
                toolId: "workspace.replace",
                outcome: "ok",
              },
            ],
          },
        }),
      )?.kind,
    ).toBe("planning");
    expect(analyzeExperience(row({ trajectory: { actions: [] } }))?.kind).toBe(
      "execution",
    );
    expect(
      analyzeExperience(row({ failureClass: "provider:insufficient_credit" }))
        ?.kind,
    ).toBe("model");
    expect(
      analyzeExperience(row({ taskType: "math", failureClass: "no_answer" }))
        ?.kind,
    ).toBe("verification");
    expect(analyzeExperience(row({ outcome: "verified_success" }))).toBeNull();
  });

  it("measures only independently judged, non-provider outcomes", () => {
    const capability = {
      id: "coding.debug",
      domain: "coding",
      name: "",
      description: "",
      status: "unmeasured" as const,
      verifiedSuccessRate: null,
      sampleCount: 0,
      failurePatterns: [],
      preferred: {},
      costProfile: {},
      latencyProfile: {},
      version: 1,
      lastEvaluatedAt: null,
    };
    const measured = measure(capability, [
      row({ outcome: "verified_success", failureClass: null }),
      row({ outcome: "verified_success", failureClass: null }),
      row({}),
      row({
        source: "product",
        outcome: "verified_success",
        failureClass: null,
      }),
      row({ outcome: "error", failureClass: "provider:rate_limited" }),
    ]);
    expect(measured.sampleCount).toBe(3);
    expect(measured.verifiedSuccessRate).toBeCloseTo(2 / 3, 3);
    expect(measured.status).toBe("developing");
  });
});

describe("training", () => {
  it("reports no provider and refuses to fake a run", async () => {
    const provider = new NoTrainingProvider();
    expect((await provider.capabilities()).available).toBe(false);
    await expect(provider.train()).rejects.toThrow(/training_unavailable/);
  });
});

/**
 * A scripted model for the loop test. It answers the task it is asked about
 * and, like a weak real model, buries its number unless a directive tells it
 * to state the result on its own line. A strategy that adds that directive
 * is therefore genuinely better on the judge; the loop has to find that out.
 */
function scriptedModel(
  answers: Array<{ objective: string; value: number }>,
): ModelProvider {
  const usage = { inputTokens: 200, outputTokens: 40, cost: 0 };
  return {
    modelId: () => "scripted-free",
    structured: async <T>(input: {
      messages: unknown[];
      validate: (value: unknown) => T;
    }) => {
      const text = JSON.stringify(input.messages);
      const value =
        answers.find((entry) => text.includes(entry.objective.slice(0, 50)))
          ?.value ?? 0;
      const clear = /Final answer: <value>|Compute every numeric result/.test(
        text,
      );
      const answer = clear
        ? `Worked it through.\nFinal answer: ${value}`
        : `The result is ${value}, checked against 3 cases.`;
      const candidates: unknown[] = [
        { action: "FINISH", summary: "Answered", answer },
        { verdict: "pass", reason: "Consistent." },
      ];
      for (const candidate of candidates) {
        try {
          return { value: input.validate(candidate), usage };
        } catch {
          // try the next shape
        }
      }
      throw new Error("scripted model: no reply fits");
    },
    complete: async () => ({ text: "", usage }),
    stream: async function* () {
      yield { type: "delta" as const, text: "" };
    },
    capabilities: async () => ({}),
    healthCheck: async () => true,
    cancel: async () => undefined,
    normalizeUsage: () => ({}),
    normalizeError: () => new Error("x"),
  } as unknown as ModelProvider;
}

describe("intelligence research loop", () => {
  it("runs a complete cycle: baseline, gap, hypotheses, trials, verified improvement, new champion, compiled experience, next target", async () => {
    const store = new MemoryIntelStore();
    await store.saveSettings({
      ...DEFAULT_SETTINGS,
      flags: {
        ...DEFAULT_SETTINGS.flags,
        intelligencePlane: true,
        experiments: true,
        strategyEvolution: true,
        compilation: true,
        curriculum: true,
        selfPlay: true,
        redIntelligence: true,
      },
      foundryModel: "scripted-free",
    });
    // Point the agenda at math: its tasks need no sandbox.
    const answers: Array<{ objective: string; value: number }> = [];
    const executor = new InProcessExecutor({
      provider: () => scriptedModel(answers),
      // No sandbox here: compute falls back to mathjs, coding stays unverified.
      sandbox: async () => new UnconfiguredSandbox("unit test"),
    });
    const originalExecute = executor.execute.bind(executor);
    executor.execute = async (input) => {
      if (input.task.spec.verify.kind === "numeric")
        answers.push({
          objective: input.task.spec.objective,
          value: input.task.spec.verify.value,
        });
      return originalExecute(input);
    };
    const log: string[] = [];
    let report;
    for (let step = 0; step < 60; step += 1) {
      report = await foundryStep({
        store,
        executor,
        owner: "test",
        deadline: Date.now() + 120_000,
        signal: new AbortController().signal,
        suite: { dev: 4, adversarial: 2, holdout: 3 },
        maxChallengers: 2,
        log: (line) => log.push(line),
      });
      const done = (await store.listCycles(10)).filter(
        (entry) => entry.status === "completed",
      );
      if (done.some((entry) => entry.capabilityId === "math.quantitative"))
        break;
    }
    expect(report).toBeTruthy();
    if (process.env.FOUNDRY_TEST_LOG) console.log(log.join("\n"));
    const cycle = (await store.listCycles(10)).find(
      (entry) =>
        entry.status === "completed" &&
        entry.capabilityId === "math.quantitative",
    );
    expect(cycle, log.join("\n")).toBeTruthy();
    // With no sandbox, coding tasks stay unverified; the math cycle is the
    // one that can run, whichever the agenda picked first.
    const decisions = (await store.listExperiments()).map(
      (experiment) => experiment.conclusion?.outcome,
    );
    const promotions = await store.listPromotions();
    const champions = (await store.listVersions("math.quantitative")).filter(
      (version) => version.status === "champion",
    );
    if (cycle!.capabilityId === "math.quantitative") {
      expect(decisions, log.join("\n")).toContain("improved");
      expect(champions).toHaveLength(1);
      expect(champions[0]!.version).toBeGreaterThan(1);
      expect(promotions.some((event) => event.toStatus === "champion")).toBe(
        true,
      );
      expect(cycle!.summary.whyImproved).toBeTruthy();
      const artifacts = await store.listArtifacts({});
      expect(
        artifacts.some((artifact) => artifact.kind === "strategic_memory"),
      ).toBe(true);
      expect(
        artifacts.some((artifact) => artifact.kind === "causal_memory"),
      ).toBe(true);
      expect((await store.listDatasetVersions()).length).toBeGreaterThan(0);
    }
    expect(cycle!.summary.next).toBeTruthy();
    expect((await store.listExperience({})).length).toBeGreaterThan(0);
    expect((await store.usage()).model_calls).toBeGreaterThan(0);
  }, 120_000);
});

describe("provider refusals", () => {
  it("classifies refusals by shape, transient or permanent", async () => {
    const { providerRefusalOf, refusalDelaySeconds } =
      await import("../src/lib/models/provider");
    const make = (code: string, retryAfterMs?: number) =>
      Object.assign(new Error(code), {
        name: "ProviderError",
        code,
        retryAfterMs,
      });
    expect(providerRefusalOf(make("rate_limited", 120_000))).toEqual({
      code: "rate_limited",
      transient: true,
      retryAfterMs: 120_000,
    });
    expect(providerRefusalOf(make("insufficient_credit"))?.transient).toBe(
      false,
    );
    // A bad reply or a timeout is about the work, not a refusal.
    expect(providerRefusalOf(make("invalid_json"))).toBeNull();
    expect(providerRefusalOf(make("timeout"))).toBeNull();
    expect(providerRefusalOf(new Error("rate_limited"))).toBeNull();
    expect(
      refusalDelaySeconds({
        code: "rate_limited",
        transient: true,
        retryAfterMs: 5_000,
      }),
    ).toBe(60);
    expect(
      refusalDelaySeconds({
        code: "rate_limited",
        transient: true,
        retryAfterMs: 48 * 3_600_000,
      }),
    ).toBe(6 * 3600);
  });

  it("judges a refused trial as a provider failure, not the strategy's", () => {
    const result = trialResultFrom({
      verify: { kind: "numeric", value: 4, tolerance: 0 },
      run: {
        status: "failed",
        answer: "",
        verdicts: [],
        hiddenCheck: null,
        notes: ["answer failed: provider_rate_limited (retry after 3600s)"],
      },
      costUsd: 0,
      tokens: 0,
      latencyMs: 1000,
      modelCalls: 0,
      toolCalls: 0,
      repairs: 0,
    });
    expect(result.failureClass).toBe("provider:rate_limited");
  });

  it("pauses the Foundry on a refusal and re-queues the trial uncounted", async () => {
    const { pauseFor, allowance } =
      await import("../src/lib/intelligence/governor/governor");
    const now = new Date("2026-09-23T23:17:00Z");
    expect(
      pauseFor(
        "rate_limited",
        ["x failed: provider_rate_limited (retry after 600s)"],
        now,
      ),
    ).toBe(600_000);
    // No stated wait: until the UTC midnight reset, at least 15 minutes.
    expect(pauseFor("rate_limited", [], now)).toBe(43 * 60_000);
    expect(pauseFor("insufficient_credit", [], now)).toBe(6 * 3_600_000);

    const store = new MemoryIntelStore();
    const settings = await store.settings();
    await store.saveSettings({
      ...settings,
      flags: { ...settings.flags, intelligencePlane: true },
      providerPause: {
        until: new Date(Date.now() + 60_000).toISOString(),
        code: "rate_limited",
        observedCalls: 92,
        at: new Date().toISOString(),
      },
    });
    const state = await allowance(store, await store.settings());
    expect(state.allowed).toBe(false);
    expect(state.reason).toMatch(/^Provider paused until .* \(rate_limited\)$/);
  });
});

describe("research loop under a provider refusal", () => {
  it("pauses instead of charging the refusal to the strategy", async () => {
    const store = new MemoryIntelStore();
    await store.saveSettings({
      ...DEFAULT_SETTINGS,
      flags: {
        ...DEFAULT_SETTINGS.flags,
        intelligencePlane: true,
        experiments: true,
        strategyEvolution: true,
      },
      foundryModel: "scripted-free",
    });
    const refusing: ModelProvider = {
      modelId: () => "scripted-free",
      structured: async () => {
        throw Object.assign(new Error("daily free budget spent"), {
          name: "ProviderError",
          code: "rate_limited",
          retryAfterMs: 2 * 3_600_000,
        });
      },
      complete: async () => {
        throw Object.assign(new Error("daily free budget spent"), {
          name: "ProviderError",
          code: "rate_limited",
          retryAfterMs: 2 * 3_600_000,
        });
      },
    } as unknown as ModelProvider;
    const executor = new InProcessExecutor({
      provider: () => refusing,
      sandbox: async () => new UnconfiguredSandbox("unit test"),
    });
    const log: string[] = [];
    let waiting: string | null = null;
    for (let step = 0; step < 12 && !waiting?.startsWith("Provider"); step += 1)
      waiting = (
        await foundryStep({
          store,
          executor,
          owner: "test",
          deadline: Date.now() + 60_000,
          signal: new AbortController().signal,
          focusCapability: "math.quantitative",
          suite: { dev: 3, adversarial: 1, holdout: 3 },
          log: (line) => log.push(line),
        })
      ).waiting;
    expect(waiting, log.join("\n")).toMatch(/^Provider paused until/);
    const settings = await store.settings();
    expect(settings.providerPause?.code).toBe("rate_limited");
    // Nothing was judged: no experience, and every trial is still pending.
    expect(await store.listExperience({})).toHaveLength(0);
    const [experiment] = await store.listExperiments(1);
    const trials = await store.listTrials(experiment!.id);
    expect(trials.every((trial) => trial.status === "pending")).toBe(true);
    expect(trials.every((trial) => trial.attempts === 0)).toBe(true);
    // And the next step does not start another trial while paused.
    const again = await foundryStep({
      store,
      executor,
      owner: "test",
      deadline: Date.now() + 60_000,
      signal: new AbortController().signal,
    });
    expect(again.waiting).toMatch(/^Provider paused until/);
  });
});

describe("value of compute and skill evolution", () => {
  it("recommends a tier only with evidence, and prefers the cheaper of near-equals", async () => {
    const { estimateTiers, recommendTier, computeHypothesis, skillHypothesis } =
      await import("../src/lib/intelligence/routing/value-of-compute");
    const version = (id: string, tier?: "FAST" | "DEEP") =>
      [
        id,
        {
          id,
          strategyId: "math.quantitative",
          kind: "math_science",
          version: 1,
          genome: tier ? { computeTier: tier } : {},
          parentId: null,
          mutation: { operator: "baseline", rationale: "" },
          status: "champion",
          riskClass: "low",
          model: "m",
          canaryPercent: 0,
          metrics: {},
        },
      ] as const;
    const versions = new Map([version("std"), version("deep", "DEEP")]);
    const row = (versionId: string, verified: boolean) =>
      ({
        source: "trial",
        outcome: verified ? "verified_success" : "failure",
        capabilityIds: ["math.quantitative"],
        strategyVersionId: versionId,
        trajectory: { actions: [{ action: "RESPOND", outcome: "ok" }] },
      }) as never;
    // Two DEEP samples are not enough to recommend anything.
    const thin = estimateTiers(
      [
        row("std", false),
        row("std", false),
        row("std", true),
        row("deep", true),
        row("deep", true),
      ],
      versions as never,
      "math.quantitative",
    );
    expect(recommendTier(thin)).toBeNull();
    const rows = [
      row("std", false),
      row("std", false),
      row("std", true),
      row("deep", true),
      row("deep", true),
      row("deep", true),
    ];
    const estimates = estimateTiers(
      rows,
      versions as never,
      "math.quantitative",
    );
    expect(recommendTier(estimates)?.tier).toBe("DEEP");
    const hypothesis = computeHypothesis(estimates, {});
    expect(hypothesis?.intervention).toEqual({ computeTier: "DEEP" });
    // Already at the recommended tier: nothing to propose.
    expect(computeHypothesis(estimates, { computeTier: "DEEP" })).toBeNull();

    const skill = skillHypothesis(
      [
        {
          id: "a",
          cycleId: null,
          kind: "skill_candidate",
          capabilityId: "math.quantitative",
          taskPattern: null,
          content: {
            instruction: "State the final value on its own line.",
            source: "math v2",
          },
          evidence: {},
          support: 3,
          status: "active",
          fingerprint: "x",
        },
      ],
      "math_science",
      {},
      () => "math_science",
    );
    expect(skill?.intervention.directives).toEqual([
      "State the final value on its own line.",
    ]);
  });
});

describe("team topology", () => {
  it("routes a draft through critic and synthesizer, and keeps the draft when the critic cannot run", async () => {
    const { armFor } = await import("../src/lib/arms/registry");
    const arm = armFor("thinking") as unknown as {
      teamReview(
        context: unknown,
        input: { answer: string; observations: string[] },
      ): Promise<string>;
    };
    const activities: string[] = [];
    const context = (structured: (id: string) => unknown) => ({
      identity: { userId: "u", organizationId: "o", workspaceId: "w" },
      work: {
        runId: "r",
        stageId: "s",
        attemptNumber: 1,
        objective: "Add 5 and 7.",
      },
      signal: new AbortController().signal,
      state: {},
      runtime: {
        provider: {
          modelId: () => "m",
          structured: async (input: {
            requestId: string;
            validate: (v: unknown) => unknown;
          }) => ({
            value: input.validate(structured(input.requestId)),
            usage: { inputTokens: 1, outputTokens: 1, cost: 0 },
          }),
        },
        repository: {
          createModelCall: async () => "call",
          finishModelCall: async () => undefined,
        },
        activity: async (type: string) => {
          activities.push(type);
          return { id: "e" };
        },
      },
    });
    const revised = await arm.teamReview(
      context((id) =>
        id.endsWith(":critic")
          ? { verdict: "revise", issues: ["5 + 7 is 12, not 13."] }
          : { answer: "5 + 7 = 12." },
      ),
      { answer: "5 + 7 = 13.", observations: [] },
    );
    expect(revised).toBe("5 + 7 = 12.");
    expect(activities).toEqual(["team.critic", "team.revised"]);

    const kept = await arm.teamReview(
      context(() => {
        throw Object.assign(new Error("quota"), {
          name: "ProviderError",
          code: "rate_limited",
        });
      }),
      { answer: "5 + 7 = 12.", observations: [] },
    );
    expect(kept).toBe("5 + 7 = 12.");
  });
});

describe("chaos: the Foundry survives failures", () => {
  const settingsFor = () => ({
    ...DEFAULT_SETTINGS,
    flags: {
      ...DEFAULT_SETTINGS.flags,
      intelligencePlane: true,
      experiments: true,
      strategyEvolution: true,
      compilation: true,
    },
    foundryModel: "scripted-free",
  });
  const mathExecutor = () => {
    const answers: Array<{ objective: string; value: number }> = [];
    const executor = new InProcessExecutor({
      provider: () => scriptedModel(answers),
      sandbox: async () => new UnconfiguredSandbox("unit test"),
    });
    const original = executor.execute.bind(executor);
    executor.execute = async (input) => {
      if (input.task.spec.verify.kind === "numeric")
        answers.push({
          objective: input.task.spec.objective,
          value: input.task.spec.verify.value,
        });
      return original(input);
    };
    return executor;
  };

  it("resumes a cycle from its checkpoint after the database fails mid-step", async () => {
    const store = new MemoryIntelStore();
    await store.saveSettings(settingsFor());
    // The database drops the third experience write, once.
    let writes = 0;
    const insert = store.insertExperience.bind(store);
    store.insertExperience = async (row) => {
      writes += 1;
      if (writes === 3) throw new Error("connection terminated unexpectedly");
      return insert(row);
    };
    const executor = mathExecutor();
    const step = () =>
      foundryStep({
        store,
        executor,
        owner: "tick",
        deadline: Date.now() + 60_000,
        signal: new AbortController().signal,
        focusCapability: "math.quantitative",
        suite: { dev: 3, adversarial: 1, holdout: 3 },
        maxChallengers: 1,
      });
    let failures = 0;
    for (let index = 0; index < 60; index += 1) {
      try {
        await step();
      } catch {
        failures += 1;
      }
      if (
        (await store.listCycles(5)).some(
          (cycle) => cycle.status === "completed",
        )
      )
        break;
    }
    expect(failures).toBe(1);
    const cycle = (await store.listCycles(5)).find(
      (entry) => entry.status === "completed",
    );
    expect(cycle).toBeTruthy();
    // The failure is on the record, and the lease was released each time.
    expect(
      (cycle!.state.log ?? []).some((entry) =>
        entry.note.startsWith("step failed"),
      ),
    ).toBe(true);
  });

  it("lets another worker take over a cycle whose worker crashed", async () => {
    const store = new MemoryIntelStore();
    await store.insertCycle({
      status: "running",
      phase: "measure",
      agendaItemId: null,
      capabilityId: null,
      state: {},
      summary: {},
    });
    const crashed = await store.leaseActiveCycle("worker-a", 0.05);
    expect(crashed).toBeTruthy();
    expect(await store.leaseActiveCycle("worker-b", 60)).toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect((await store.leaseActiveCycle("worker-b", 60))?.id).toBe(
      crashed!.id,
    );
  });

  it("pauses without running a trial when the day's envelope is spent", async () => {
    const store = new MemoryIntelStore();
    await store.saveSettings({
      ...settingsFor(),
      budgets: { ...DEFAULT_SETTINGS.budgets, dailyModelCalls: 0 },
    });
    let executed = 0;
    const executor = mathExecutor();
    const original = executor.execute.bind(executor);
    executor.execute = async (input) => {
      executed += 1;
      return original(input);
    };
    let report;
    for (let index = 0; index < 6; index += 1) {
      report = await foundryStep({
        store,
        executor,
        owner: "tick",
        deadline: Date.now() + 30_000,
        signal: new AbortController().signal,
        focusCapability: "math.quantitative",
      });
      if (report.waiting) break;
    }
    expect(report!.waiting).toBe("Daily model-call envelope spent");
    expect(executed).toBe(0);
  });
});

function evalTask(
  overrides: Partial<EvalTask> & Pick<EvalTask, "id" | "partition">,
): EvalTask {
  return {
    suite: "m26",
    capabilityId: "coding.debug",
    difficulty: {},
    difficultyScore: 2,
    generator: "seed",
    fingerprint: "11",
    parentId: null,
    labelVerified: true,
    labelEvidence: {},
    ...overrides,
    spec: {
      kind: "coding",
      objective: overrides.spec?.objective ?? overrides.id,
      verify: overrides.spec?.verify ?? { kind: "includes", all: ["ok"] },
    },
  };
}

function verifiedExperience(
  overrides: Partial<Experience> & Pick<Experience, "id" | "taskRef">,
): Experience {
  return {
    source: "trial",
    taskType: "coding",
    capabilityIds: ["coding.debug"],
    difficulty: 2,
    strategyVersionId: "policy-v1",
    model: "m",
    skills: [],
    tools: [],
    trajectory: { output: "fixed" },
    verification: {
      verdicts: ["verified"],
      check: { passed: true, detail: "ok" },
    },
    outcome: "verified_success",
    failureClass: null,
    repairs: 0,
    costUsd: 0,
    tokens: 10,
    latencyMs: 10,
    confidence: null,
    qualityScore: 1,
    fingerprint: overrides.id,
    partition: "dev",
    provenance: {},
    createdAt: "2026-09-24T00:00:00.000Z",
    ...overrides,
  };
}

describe("dataset verification", () => {
  it("drops duplicate examples and holdout overlap, including near-duplicates and rows already stored", async () => {
    const store = new MemoryIntelStore();
    const holdoutObjective =
      "fix the median bug in stats module for even arrays";
    const nearObjective =
      "fix the median bug in the stats module for even arrays";
    const otherObjective =
      "compute the determinant of a three by three matrix quickly";
    const tasks = new Map<string, EvalTask>([
      [
        "h",
        evalTask({
          id: "h",
          partition: "holdout",
          spec: {
            kind: "coding",
            objective: holdoutObjective,
            verify: { kind: "includes", all: ["ok"] },
          },
        }),
      ],
      [
        "a",
        evalTask({
          id: "a",
          partition: "train",
          spec: {
            kind: "coding",
            objective: holdoutObjective,
            verify: { kind: "includes", all: ["ok"] },
          },
        }),
      ],
      [
        "b",
        evalTask({
          id: "b",
          partition: "train",
          spec: {
            kind: "coding",
            objective: holdoutObjective,
            verify: { kind: "includes", all: ["ok"] },
          },
        }),
      ],
      [
        "n",
        evalTask({
          id: "n",
          partition: "train",
          spec: {
            kind: "coding",
            objective: nearObjective,
            verify: { kind: "includes", all: ["ok"] },
          },
        }),
      ],
      [
        "u",
        evalTask({
          id: "u",
          partition: "train",
          spec: {
            kind: "coding",
            objective: otherObjective,
            verify: { kind: "includes", all: ["ok"] },
          },
        }),
      ],
      [
        "d1",
        evalTask({
          id: "d1",
          partition: "train",
          spec: {
            kind: "coding",
            objective: "sort a list of integers stably",
            verify: { kind: "includes", all: ["ok"] },
          },
        }),
      ],
      [
        "d2",
        evalTask({
          id: "d2",
          partition: "train",
          spec: {
            kind: "coding",
            objective: "sort a list of integers stably",
            verify: { kind: "includes", all: ["ok"] },
          },
        }),
      ],
    ]);
    const built = await buildDatasets(store, {
      capabilityId: "coding.debug",
      tasks,
      experience: [
        verifiedExperience({ id: "eh", taskRef: "h" }),
        verifiedExperience({
          id: "ea",
          taskRef: "a",
          strategyVersionId: "policy-v2",
        }),
        verifiedExperience({
          id: "eb",
          taskRef: "b",
          strategyVersionId: "policy-v2",
        }),
        verifiedExperience({ id: "en", taskRef: "n" }),
        verifiedExperience({ id: "eu", taskRef: "u" }),
        verifiedExperience({
          id: "ed1",
          taskRef: "d1",
          strategyVersionId: "policy-v2",
        }),
        verifiedExperience({
          id: "ed2",
          taskRef: "d2",
          strategyVersionId: "policy-v2",
        }),
      ],
    });
    const problem = built.find((set) =>
      set.datasetId.endsWith("problem_solution"),
    )!;
    expect(problem.contamination.duplicates).toBeGreaterThan(0);
    expect(problem.contamination.holdoutOverlap).toBeGreaterThan(0);
    expect(problem.contamination.nearDuplicates).toBe(1);
    expect(problem.contamination.rejected).toBe(problem.contamination.dropped);
    expect(problem.counts.holdout).toBe(1);
    expect(problem.counts.train).toBe(2);
    expect(problem.versionId).toBeTruthy();
    const stored = await store.listDatasetVersions(5);
    expect(stored[0]!.provenance.strategyVersionIds).toEqual(
      expect.arrayContaining(["policy-v1", "policy-v2"]),
    );

    const leaked = await buildDatasets(store, {
      capabilityId: "coding.debug",
      tasks,
      experience: [
        verifiedExperience({
          id: "again",
          taskRef: "u",
          strategyVersionId: "policy-v9",
        }),
        verifiedExperience({
          id: "leak",
          taskRef: "a",
          strategyVersionId: "policy-v9",
        }),
      ],
    });
    const second = leaked.find((set) =>
      set.datasetId.endsWith("problem_solution"),
    )!;
    expect(second.contamination.holdoutOverlap).toBeGreaterThan(0);
    expect(second.counts.train ?? 0).toBe(1);
    expect(second.counts.holdout).toBeUndefined();
  });
});

describe("model candidates", () => {
  it("does not record a candidate when the provider cannot train", async () => {
    const store = new MemoryIntelStore();
    const report = await attemptTraining({
      store,
      provider: new NoTrainingProvider(),
      type: "sft",
      baseModel: "deepseek-v4-pro-0813:free",
      datasetVersionId: null,
    });
    expect(report.trained).toBe(false);
    expect(report.candidate).toBeNull();
    expect(report.run.status).toBe("failed");
    expect(candidateTrained(report.run)).toBe(false);
    expect(await store.listModelCandidates()).toEqual([]);
  });

  it("records a candidate only after the provider succeeds, and will not crown it without an evaluation", async () => {
    const store = new MemoryIntelStore();
    const provider: TrainingProvider = {
      id: "fake",
      async capabilities() {
        return {
          available: true,
          reason: null,
          jobTypes: ["sft"],
          baseModels: ["base"],
        };
      },
      async prepareDataset() {
        return { uploadedId: "up" };
      },
      async train(input) {
        return {
          id: "job-1",
          type: input.type,
          baseModel: input.baseModel,
          datasetVersionId: input.datasetVersionId,
          status: "succeeded",
        };
      },
      async resume(jobId) {
        return {
          id: jobId,
          type: "sft",
          baseModel: "base",
          datasetVersionId: "d",
          status: "succeeded",
        };
      },
      async cancel() {},
      async status(jobId) {
        return {
          id: jobId,
          type: "sft",
          baseModel: "base",
          datasetVersionId: "d",
          status: "succeeded",
        };
      },
      async artifacts() {
        return {};
      },
      async evaluate() {
        return {};
      },
      async publishCandidate() {
        return { modelCandidateId: "nope" };
      },
    };
    const report = await attemptTraining({
      store,
      provider,
      type: "sft",
      baseModel: "base",
      datasetVersionId: null,
    });
    expect(report.trained).toBe(true);
    expect(report.candidate?.status).toBe("candidate");
    expect(candidateTrained(report.run)).toBe(true);
    await expect(
      store.updateModelCandidate(report.candidate!.id, { status: "champion" }),
    ).rejects.toThrow(/candidate_transition/);
    const evaluating = await store.updateModelCandidate(report.candidate!.id, {
      status: "evaluating",
    });
    expect(evaluating.status).toBe("evaluating");
    const champion = await store.updateModelCandidate(evaluating.id, {
      status: "champion",
      evaluation: { verdict: "pass" },
    });
    expect(champion.status).toBe("champion");
    expect(
      candidateTransitionProblems({
        from: "candidate",
        to: "evaluating",
        trainingStatus: "failed",
        evaluation: {},
      }),
    ).toContain("training_not_succeeded");
  });
});

describe("architecture comparison", () => {
  it("names a solver-critic change separately from an unchanged single worker", () => {
    expect(architectureOf({})).toBe("single_worker");
    expect(architectureOf({ team: { critic: true } })).toBe("solver_critic");
    expect(architectureComparison({}, { team: { critic: true } })).toEqual({
      champion: "single_worker",
      challenger: "solver_critic",
      changed: true,
    });
    expect(
      architectureComparison(
        { coding: { reproduceFirst: true } },
        { coding: { reproduceFirst: true }, computeTier: "DEEP" },
      ).changed,
    ).toBe(false);
  });
});
