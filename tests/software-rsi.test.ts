import { describe, expect, it } from "vitest";
import { pulseCatalog } from "../src/lib/agent/pulse/catalog";
import {
  benchmarkGaps,
  budgetedProvider,
  rawVsOsirusSide,
} from "../src/lib/intelligence/benchmark/raw-vs-osirus";
import {
  codeReportSchema,
  liveEvidenceSchema,
  reportCodeAttempt,
  reportLiveEvidence,
  takeCodeHypothesis,
  takeLiveOrder,
} from "../src/lib/intelligence/rsi/exchange";
import type { LiveOrderContent } from "../src/lib/intelligence/rsi/phases";
import { GUARDRAIL_CASES } from "../src/lib/intelligence/software-rsi/guardrails";
import {
  credentialFreeEnv,
  findSymbol,
  judgePatch,
  parses,
  patchPrompt,
  regressions,
  spliceSymbol,
} from "../src/lib/intelligence/software-rsi/pipeline";
import {
  checkPatch,
  onAllowlist,
  parseUnifiedDiff,
  trustRootArea,
} from "../src/lib/intelligence/software-rsi/policy";
import { MemoryIntelStore } from "../src/lib/intelligence/store/memory-store";
import type { ModelProvider } from "../src/lib/models/provider";
import {
  checkClaims,
  PULSE_EXPECTATION,
  RSI_LIVE_EXPECTATION,
  SOFTWARE_RSI_EXPECTATION,
} from "../src/lib/security/github-oidc";

describe("software RSI path policy", () => {
  it("never lets the pipeline touch the trust root", () => {
    for (const path of [
      "src/lib/auth/server.ts",
      "src/lib/security/rate-limit.ts",
      "db/migrations/019_recursive_intelligence.sql",
      "src/lib/memory/repository.ts",
      "src/lib/intelligence/rsi/budget.ts",
      "src/lib/verification/outcome.ts",
      "src/lib/sandbox/local.ts",
      "src/lib/tools/registry.ts",
      "src/lib/agent/loop.ts",
      "src/lib/arms/base.ts",
      "tests/team.test.ts",
      ".github/workflows/software-rsi.yml",
      "package.json",
    ]) {
      expect(trustRootArea(path), path).not.toBeNull();
      expect(onAllowlist(path), path).toBe(false);
    }
    expect(onAllowlist("src/lib/agent/team.ts")).toBe(true);
    expect(onAllowlist("src/lib/agent/mission.ts")).toBe(true);
    expect(onAllowlist("src/lib/research/citations.ts")).toBe(true);
  });

  it("reads a unified diff and applies size and content rules", () => {
    const diff = [
      "diff --git a/src/lib/agent/team.ts b/src/lib/agent/team.ts",
      "--- a/src/lib/agent/team.ts",
      "+++ b/src/lib/agent/team.ts",
      "@@ -1 +1 @@",
      "-  return a;",
      "+  return b;",
    ].join("\n");
    const files = parseUnifiedDiff(diff);
    expect(files).toEqual([
      { path: "src/lib/agent/team.ts", added: ["  return b;"], removed: 1 },
    ]);
    expect(checkPatch(files).allowed).toBe(true);
    const bad = checkPatch([
      {
        path: "src/lib/agent/team.ts",
        added: ["const k = process.env.X;"],
        removed: 0,
      },
    ]);
    expect(bad.allowed).toBe(false);
    expect(bad.violations[0]).toMatch(/environment/);
  });

  it("holds every guardrail the pulse checks hourly", async () => {
    for (const entry of GUARDRAIL_CASES)
      expect(entry.check().held, entry.title).toBe(true);
    const specs = (await pulseCatalog()).filter(
      (spec) => spec.family === "SOFTWARE_RSI",
    );
    expect(specs.map((spec) => spec.level)).toEqual([1, 2, 3, 4, 5]);
    for (const spec of specs)
      expect(
        (await spec.run({ signal: new AbortController().signal })).outcome,
      ).toBe("VERIFIED_SUCCESS");
  });
});

describe("software RSI pipeline", () => {
  const source = [
    "import x from 'y';",
    "",
    "export function normalizeClaim(claim: string) {",
    "  return claim.trim();",
    "}",
    "",
    "export class Builder {",
    "  build(input: { a: number }): { b: number } {",
    "    return { b: input.a };",
    "  }",
    "}",
    "",
    "export const table = { a: 1 };",
  ].join("\n");

  it("finds functions, methods and consts by name and splices a replacement", () => {
    const fn = findSymbol(source, "normalizeClaim")!;
    expect(fn.text).toMatch(/^export function normalizeClaim/);
    expect(findSymbol(source, "Builder.build")!.text).toMatch(/^build\(input/);
    expect(findSymbol(source, "table")!.text).toMatch(/^export const table/);
    expect(findSymbol(source, "missing")).toBeNull();
    const next = spliceSymbol(
      source,
      fn,
      "export function normalizeClaim(claim: string) {\n  return claim.trim().toLowerCase();\n}",
    );
    expect(next).toContain("toLowerCase");
    expect(next).toContain("export class Builder");
    expect(parses(next)).toBe(true);
    expect(parses("export function (")).toBe(false);
  });

  it("accepts only a strict improvement on unseen seeds with no regressions", () => {
    const base = {
      testsPassed: true,
      typecheckPassed: true,
      lintPassed: true,
      baseline: { held: 4, instances: 24 },
      regressions: [],
    };
    expect(
      judgePatch({ ...base, patched: { held: 24, instances: 24 } }).improved,
    ).toBe(true);
    expect(
      judgePatch({ ...base, patched: { held: 4, instances: 24 } }).improved,
    ).toBe(false);
    const row = (arena: string, held: number) => ({
      arena,
      level: 2,
      seed: "r",
      held,
      failed: 3 - held,
      invalid: 0,
      instances: 3,
      failures: [],
    });
    expect(
      regressions([row("a", 3), row("b", 2)], [row("a", 3), row("b", 1)]),
    ).toEqual(["b L2 (2→1)"]);
  });

  it("runs patched code without a single credential", () => {
    const env = credentialFreeEnv({ RSI_OUT: "x.json" }, {
      PATH: "/usr/bin",
      HOME: "/home/runner",
      UNOROUTER_API_KEY_1: "k",
      GH_TOKEN: "t",
      GITHUB_TOKEN: "t",
      ACTIONS_ID_TOKEN_REQUEST_TOKEN: "t",
      ACTIONS_ID_TOKEN_REQUEST_URL: "https://x",
      ACTIONS_RUNTIME_TOKEN: "t",
      VERCEL_TOKEN: "t",
      DATABASE_URL_SECRET: "x",
      NODE_ENV: "test",
    } as NodeJS.ProcessEnv);
    expect(Object.keys(env).sort()).toEqual([
      "HOME",
      "NODE_ENV",
      "PATH",
      "RSI_OUT",
    ]);
  });

  it("shows the model dev failures only, never the unseen seeds", () => {
    const prompt = patchPrompt({
      file: "src/lib/agent/team.ts",
      symbol: "normalizeClaim",
      statement: "picks the first number",
      expected: "the stated value wins",
      verifier: "recomputation",
      code: "function normalizeClaim() {}",
      context: "",
      failures: [{ text: "dev-1 instance", detail: "kept wrong" }],
    });
    expect(prompt).toContain("dev-1 instance");
    expect(prompt).not.toMatch(/holdout-/);
    expect(prompt).toMatch(/No new imports, no environment access/);
  });
});

describe("the runners' exchange with production", () => {
  const T = new Date("2026-09-25T15:10:00Z");

  async function withHypothesis(
    store: MemoryIntelStore,
    trustRoot = false,
    file = "src/lib/agent/team.ts",
  ) {
    await store.upsertArtifact({
      cycleId: null,
      kind: "code_hypothesis",
      capabilityId: "reasoning.falsification",
      taskPattern: "solver_vs_falsifier",
      content: {
        statement: "normalizeClaim picks the first number",
        expected: "holds",
        file,
        symbol: "normalizeClaim",
        arena: "solver_vs_falsifier",
        levels: [4, 5],
        failing: ["solver_vs_falsifier:h1:L4:0"],
        trustRoot,
        rsiCycle: "c",
      },
      evidence: {},
      support: 4,
      status: "proposed",
      fingerprint: `hyp-${file}-${trustRoot}`,
    });
  }

  it("hands out one code hypothesis a day, outside the trust root, with calls reserved", async () => {
    const store = new MemoryIntelStore();
    await withHypothesis(store, true, "src/lib/tools/registry.ts");
    expect(await takeCodeHypothesis(store, T)).toBeNull();
    await withHypothesis(store);
    const taken = (await takeCodeHypothesis(store, T))!;
    expect(taken.hypothesis.symbol).toBe("normalizeClaim");
    expect(taken.calls).toBe(3);
    expect((await store.usage("2026-09-25")).rsi_model_calls).toBe(3);
    // Not again within the day.
    expect(
      await takeCodeHypothesis(store, new Date(T.getTime() + 3_600_000)),
    ).toBeNull();
    const report = codeReportSchema.parse({
      id: taken.id,
      outcome: "pr_opened",
      prUrl: "https://github.com/clarityosbaerbelwesterop-gif/Osirus/pull/99",
      branch: "rsi/solver-vs-falsifier-1",
      summary: "4/24 → 24/24",
      measurements: {
        baseline: { held: 4, instances: 24 },
        patched: { held: 24, instances: 24 },
        regressions: [],
        testsPassed: true,
      },
      spent: { modelCalls: 1, tokens: 900 },
    });
    expect((await reportCodeAttempt(store, report)).accepted).toBe(true);
    const usage = await store.usage("2026-09-25");
    expect(usage.rsi_model_calls).toBe(1);
    const [artifact] = (
      await store.listArtifacts({ kind: "code_hypothesis" })
    ).filter((entry) => entry.fingerprint === taken.id);
    expect(artifact!.status).toBe("active");
    expect(() =>
      codeReportSchema.parse({
        ...report,
        prUrl: "https://evil.example/pull/1",
      }),
    ).toThrow();
  });

  it("takes a live order only with a pair's worth of calls, and refuses rows about other tasks", async () => {
    const store = new MemoryIntelStore();
    const order: LiveOrderContent = {
      orderId: "3c4a6f2e-5b1d-4a8e-9f00-1234567890ab",
      rsiCycle: "c",
      capabilityId: "math.quantitative",
      strategyId: "math.quantitative",
      model: "m:free",
      hypothesis: {
        id: "h",
        class: "tool",
        capabilityId: "math.quantitative",
        gap: "tool",
        statement: "s",
        expected: "e",
        origin: "library",
        lane: "live",
      },
      champion: { versionId: "v1", genome: {} },
      challenger: { genome: { math: { computeFirst: true } } },
      tasks: [{ id: "t1", partition: "dev", spec: {} }],
      benchmark: [{ id: "b1", family: "math", spec: {} }],
      calls: 12,
      state: "open",
      evidence: null,
    };
    await store.upsertArtifact({
      cycleId: null,
      kind: "live_order",
      capabilityId: "math.quantitative",
      taskPattern: "m",
      content: order as unknown as Record<string, unknown>,
      evidence: { createdAt: T.toISOString() },
      support: 1,
      status: "proposed",
      fingerprint: "o1",
    });
    await store.addUsage("rsi_model_calls", 31, "2026-09-25");
    expect(await takeLiveOrder(store, T)).toBeNull();
    expect((await store.usage("2026-09-25")).rsi_model_calls).toBe(31);
    await store.addUsage("rsi_model_calls", -10, "2026-09-25");
    const taken = (await takeLiveOrder(store, T))!;
    expect(taken.reserved).toBe(11);
    const evidence = (taskId: string) =>
      liveEvidenceSchema.parse({
        orderId: order.orderId,
        evidence: {
          trials: [
            {
              taskId,
              partition: "dev",
              side: "champion",
              verified: true,
              falseCompletion: false,
              failureClass: null,
              modelCalls: 3,
              tokens: 100,
              latencyMs: 10,
            },
          ],
          benchmark: [
            {
              taskId: "b1",
              family: "math",
              raw: { verified: false, modelCalls: 1, tokens: 50 },
              osirus: { verified: true, modelCalls: 3, tokens: 400 },
            },
          ],
          spent: { modelCalls: 7, tokens: 550 },
          runner: { runId: "1", startedAt: "a", finishedAt: "b" },
        },
      });
    expect(
      (await reportLiveEvidence(store, evidence("elsewhere"))).accepted,
    ).toBe(false);
    expect((await reportLiveEvidence(store, evidence("t1"))).accepted).toBe(
      true,
    );
    expect((await store.usage("2026-09-25")).rsi_model_calls).toBe(21 + 7);
    const bench = await store.listArtifacts({ kind: "benchmark_result" });
    expect(bench[0]!.content).toMatchObject({ mode: "live", family: "math" });
    // Evidence is accepted once.
    expect((await reportLiveEvidence(store, evidence("t1"))).accepted).toBe(
      false,
    );
  });

  it("accepts only its own workflow's tokens, on a separate audience", () => {
    const now = 1_800_000_000;
    const claims = (workflow: string, audience: string) => ({
      iss: "https://token.actions.githubusercontent.com",
      aud: audience,
      exp: now + 300,
      iat: now,
      repository: "clarityosbaerbelwesterop-gif/Osirus",
      ref: "refs/heads/main",
      workflow_ref: `clarityosbaerbelwesterop-gif/Osirus/.github/workflows/${workflow}@refs/heads/main`,
      event_name: "workflow_run",
    });
    expect(
      checkClaims(
        claims("rsi-live.yml", "osirus-rsi"),
        RSI_LIVE_EXPECTATION,
        now,
      ).ok,
    ).toBe(true);
    expect(
      checkClaims(
        claims("software-rsi.yml", "osirus-rsi"),
        RSI_LIVE_EXPECTATION,
        now,
      ).ok,
    ).toBe(false);
    expect(
      checkClaims(
        claims("software-rsi.yml", "osirus-rsi"),
        SOFTWARE_RSI_EXPECTATION,
        now,
      ).ok,
    ).toBe(true);
    // A scheduler token is not an RSI token, and the other way round.
    expect(
      checkClaims(
        claims("rsi-live.yml", "osirus-scheduler"),
        RSI_LIVE_EXPECTATION,
        now,
      ).ok,
    ).toBe(false);
    expect(
      checkClaims(
        claims("capability-pulse.yml", "osirus-rsi"),
        PULSE_EXPECTATION,
        now,
      ).ok,
    ).toBe(false);
  });
});

describe("raw model vs Osirus", () => {
  function scripted(answers: string[]): ModelProvider {
    let index = 0;
    return {
      complete: async () => ({
        text: answers[index++] ?? "",
        usage: { inputTokens: 10, outputTokens: 5 },
      }),
      structured: async () => {
        throw new Error("unused");
      },
      stream: async function* () {},
      modelId: () => "m",
      capabilities: async () => ({}),
      healthCheck: async () => true,
      cancel: async () => undefined,
      normalizeUsage: () => ({}),
      normalizeError: () => new Error("x"),
    } as unknown as ModelProvider;
  }

  it("judges the raw side with the task's own verifier and counts its calls", async () => {
    const meter = budgetedProvider(
      scripted(["The answer is 42.", "It is 7."]),
      1,
    );
    const spec = {
      kind: "math" as const,
      objective: "6*7?",
      verify: { kind: "numeric" as const, value: 42, tolerance: 0 },
    };
    expect(await rawVsOsirusSide.raw(meter.provider, spec, meter)).toEqual({
      verified: true,
      modelCalls: 1,
      tokens: 15,
    });
    // Over budget: excluded, not failed.
    expect(await rawVsOsirusSide.raw(meter.provider, spec, meter)).toBeNull();
    expect(meter.exhausted()).toBe(true);
  });

  it("reports the gap per family only over pairs where both sides were judged", () => {
    const gaps = benchmarkGaps([
      {
        family: "math",
        raw: { verified: false, modelCalls: 1, tokens: 1 },
        osirus: { verified: true, modelCalls: 4, tokens: 1 },
      },
      {
        family: "math",
        raw: { verified: true, modelCalls: 1, tokens: 1 },
        osirus: { verified: true, modelCalls: 3, tokens: 1 },
      },
      {
        family: "math",
        raw: null,
        osirus: { verified: true, modelCalls: 3, tokens: 1 },
      },
    ]);
    expect(gaps).toEqual([
      {
        family: "math",
        pairs: 2,
        raw: { verified: 1, rate: 0.5, callsPerVerified: 2 },
        osirus: { verified: 2, rate: 1, callsPerVerified: 3.5 },
        gap: 0.5,
      },
    ]);
  });
});
