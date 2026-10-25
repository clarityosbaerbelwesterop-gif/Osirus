import { describe, expect, it, vi } from "vitest";
import {
  cachedProvider,
  compactMessagesForCost,
  ModelCostCache,
  normalizeTextForSemanticCache,
} from "../src/lib/models/cache";
import type { ModelProvider, ModelRole } from "../src/lib/models/provider";
import {
  createRougeAgent,
  RougeSelfCloner,
  RougeSkillSelfImprover,
} from "../src/lib/rouge-agent";

function createCountingProvider(model = "glm-5.3-flash") {
  let calls = 0;
  const provider: ModelProvider = {
    async *stream(input) {
      calls += 1;
      yield { type: "delta", text: `stream:${input.role}` };
      yield {
        type: "usage",
        usage: { inputTokens: 400, outputTokens: 100, cost: 0.005 },
      };
    },
    async complete(input) {
      calls += 1;
      await new Promise((r) => setTimeout(r, 5));
      return {
        text: `{"answer":"verified-${input.role}-${calls}"}`,
        usage: { inputTokens: 800, outputTokens: 200, cost: 0.01 },
      };
    },
    async structured(input) {
      const res = await this.complete(input);
      return {
        value: input.validate(JSON.parse(res.text)),
        usage: res.usage,
      };
    },
    modelId: (_role: ModelRole) => model,
    capabilities: async () => ({
      streaming: true,
      cancellation: true,
      roles: ["FAST", "STRONG", "VERIFY"],
    }),
    healthCheck: async () => true,
    cancel: async () => undefined,
    normalizeUsage: (raw) => raw ?? {},
    normalizeError: (err) =>
      err instanceof Error ? err : new Error(String(err)),
  };
  return { provider, getCalls: () => calls };
}

describe("Multi-layer ModelCostCache & 99% cost reduction", () => {
  it("achieves >= 99% cost reduction across repeated, semantic-variant, and concurrent burst calls", async () => {
    const cache = new ModelCostCache();
    const { provider, getCalls } = createCountingProvider("glm-5.3-flash");
    const wrapped = cachedProvider(provider, cache);

    // 100 concurrent identical / semantic-equivalent calls:
    // In-flight coalescing + semantic normalization should hit upstream ONLY ONCE!
    const prompts = Array.from({ length: 100 }, (_, i) => [
      {
        role: "user",
        content:
          i % 2 === 0
            ? "Explain MVCC isolation in Postgres!!"
            : "  explain   mvcc isolation in postgres! ",
      },
    ]);

    const results = await Promise.all(
      prompts.map((messages, idx) =>
        wrapped.complete({
          requestId: `req-${idx}`,
          role: "FAST",
          messages,
        }),
      ),
    );

    expect(getCalls()).toBe(1);
    expect(new Set(results.map((r) => r.text)).size).toBe(1);

    const metrics = cache.metrics();
    expect(metrics.totalRequests).toBe(100);
    expect(metrics.upstreamCalls).toBe(1);
    expect(metrics.costReductionPercent).toBeGreaterThanOrEqual(99);
    expect(metrics.tokensSaved).toBeGreaterThan(50_000);
  });

  it("preserves code blocks verbatim during semantic normalization", () => {
    const a = normalizeTextForSemanticCache(
      "Fix THIS:\n```ts\nconst X = 'HeLLo   World';\n```",
    );
    const b = normalizeTextForSemanticCache(
      "  fix this:\n```ts\nconst X = 'HeLLo   World';\n```",
    );
    const c = normalizeTextForSemanticCache(
      "  fix this:\n```ts\nconst x = 'hello world';\n```",
    );
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  it("compacts long multi-turn histories and deduplicates system prompts", () => {
    const messages = [
      { role: "system", content: "System invariant A" },
      { role: "system", content: "System invariant A" },
      ...Array.from({ length: 14 }, (_, i) => ({
        role: i % 2 === 0 ? "user" : "assistant",
        content: `Turn ${i}: ${"detailed discussion ".repeat(40)}`,
      })),
    ];
    const compacted = compactMessagesForCost(messages, {
      maxCharsBudget: 2000,
      keepRecentTurns: 3,
    });
    expect(compacted.didCompact).toBe(true);
    expect(compacted.savedTokensEstimate).toBeGreaterThan(500);
    expect(compacted.compacted.length).toBeLessThan(messages.length);
  });
});

describe("Pre-Rouge Release: Rouge Agent (self-cloning, unbounded code loops, skill RSI)", () => {
  it("spawns parallel clones, recursively sub-clones, and adjudicates patches with security vetoes", async () => {
    const cloner = new RougeSelfCloner(5, 2);
    const outcomes = await cloner.executeClones(
      {
        objective: "Harden auth and fix bug in src/service.ts",
        iteration: 1,
        failingChecks: ["unit_test: expected 200 got 500"],
        workspaceFiles: { "src/service.ts": "export const v = 1;" },
        skills: [],
        maxParallelClones: 5,
        maxCloneDepth: 2,
      },
      async (spec) => ({
        summary: `Completed ${spec.role}`,
        patches:
          spec.role === "solver"
            ? [
                {
                  file: "src/service.ts",
                  description: "Fix service return value",
                  content: "export const v = 2;",
                  authorCloneId: spec.id,
                  authorRole: spec.role,
                },
              ]
            : [],
        findings: [],
        confidence: spec.role === "solver" ? 0.95 : 0.85,
        tokensUsed: 120,
        cachedHit: true,
        subCloneRequests:
          spec.generation === 1 && spec.role === "solver"
            ? [
                {
                  role: "optimizer",
                  subObjective: "Verify performance of src/service.ts",
                },
              ]
            : [],
      }),
    );

    // 4 root clones (solver, verifier, security_auditor, refactorer) + 1 child clone (optimizer)
    expect(outcomes.length).toBe(5);
    expect(outcomes.some((o) => o.clone.generation === 2)).toBe(true);

    const adjudicated = cloner.adjudicatePatches(outcomes);
    expect(adjudicated.blockingFindings).toEqual([]);
    expect(adjudicated.acceptedPatches).toHaveLength(1);
    expect(adjudicated.acceptedPatches[0]?.content).toBe("export const v = 2;");
  });

  it("iterates across slice continuations, repairs failing checks until verified_perfect, and evolves skills", async () => {
    const agent = createRougeAgent({
      maxIterationsPerSlice: 2,
      maxParallelClones: 4,
      profile: "frontier-max",
      selfImproveSkills: true,
    });

    const result = await agent.executeUntilPerfect({
      objective: "Repair calculation bug and pass all typecheck and unit tests",
      initialFiles: { "src/math.ts": "export const add = (a, b) => a - b;" },
      cloneExecutor: async (spec, ctx) => {
        const fixedContent =
          ctx.iteration >= 3
            ? "export const add = (a: number, b: number): number => a + b;"
            : ctx.iteration === 2
              ? "export const add = (a: number, b: number) => a - b;"
              : "export const add = (a, b) => a - b;";
        return {
          summary: `Iteration ${ctx.iteration} by ${spec.role}`,
          patches:
            spec.role === "solver"
              ? [
                  {
                    file: "src/math.ts",
                    description: "Update add implementation",
                    content: fixedContent,
                    authorCloneId: spec.id,
                    authorRole: spec.role,
                  },
                ]
              : [],
          findings: [],
          confidence: 0.92,
          tokensUsed: 100,
          cachedHit: true,
        };
      },
      verifier: async (files) => {
        const code = files["src/math.ts"] ?? "";
        const typed = code.includes("a: number");
        const correct = code.includes("a + b");
        return [
          {
            name: "typecheck",
            kind: "typecheck",
            passed: typed,
            output: typed ? "ok" : "implicit any on parameters",
            durationMs: 3,
          },
          {
            name: "unit_test",
            kind: "unit_test",
            passed: correct,
            output: correct ? "ok" : "expected 5 got -1",
            durationMs: 4,
          },
        ];
      },
    });

    expect(result.status).toBe("verified_perfect");
    expect(result.iterations).toBe(3);
    // Slice size was 2, so reaching iteration 3 required 1 seamless continuation!
    expect(result.continuations).toBe(1);
    expect(result.evolvedSkills.length).toBeGreaterThanOrEqual(1);
    expect(result.checkpoint.workspaceFiles["src/math.ts"]).toContain("a + b");
  });

  it("synthesizes and ranks learned skills in RougeSkillSelfImprover", () => {
    const improver = new RougeSkillSelfImprover();
    const skill = improver.extractFromVerifiedRepair({
      objective: "Fix SSRF IPv6 hex literal bypass",
      previousFailures: [
        {
          name: "ssrf-ipv6",
          kind: "security",
          passed: false,
          output: "::ffff:7f00:1 allowed",
          durationMs: 5,
        },
      ],
      winningPatches: [
        {
          file: "src/lib/research/fetch.ts",
          description: "Use outbound isPrivateAddress",
          content: "export { isPrivateAddress } from '../security/outbound';",
          authorCloneId: "c1",
          authorRole: "security_auditor",
        },
      ],
      verifiedChecks: [
        {
          name: "ssrf-ipv6",
          kind: "security",
          passed: true,
          output: "blocked",
          durationMs: 5,
        },
      ],
      tokensSavedByCache: 1200,
    });

    expect(skill).not.toBeNull();
    expect(skill?.confidence).toBeGreaterThanOrEqual(0.85);
    const matched = improver.matchSkillsForObjective(
      "Audit fetch.ts for security ssrf-ipv6",
    );
    expect(matched).toHaveLength(1);
  });
});

describe("Security hardening regressions (RT2-06, RT2-09)", () => {
  it("normalizes sign-in errors so account existence is never leaked", async () => {
    vi.doMock("@/lib/auth/server", () => ({
      requireAuthConfiguration: () => undefined,
      auth: {
        signIn: {
          email: vi.fn(async ({ email }: { email: string }) => ({
            error: {
              message: email.includes("unknown")
                ? "User not found"
                : "Incorrect password for existing user",
            },
          })),
        },
      },
    }));
    const { signInWithEmail } = await import("../src/app/auth/sign-in/actions");
    const f1 = new FormData();
    f1.set("email", "unknown@example.com");
    f1.set("password", "secret123");
    const f2 = new FormData();
    f2.set("email", "existing@example.com");
    f2.set("password", "wrongpass");

    const r1 = await signInWithEmail(null, f1);
    const r2 = await signInWithEmail(null, f2);
    expect(r1).toEqual({ error: "Invalid email or password." });
    expect(r2).toEqual({ error: "Invalid email or password." });
  });
});
