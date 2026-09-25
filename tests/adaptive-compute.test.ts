import { describe, expect, it } from "vitest";
import { nextEscalation, startTier } from "../src/lib/agent/escalation";
import { pulseCatalog } from "../src/lib/agent/pulse/catalog";
import { runArenaTask } from "../src/lib/arena/harness";
import {
  COMPUTE_CHECKS,
  simulate,
} from "../src/lib/intelligence/compute/checks";
import { mechanismOf } from "../src/lib/intelligence/meta/meta-policy";
import {
  adaptiveComputeHypothesis,
  learnComputeEntry,
} from "../src/lib/intelligence/routing/value-of-compute";
import type {
  Experience,
  StrategyVersion,
} from "../src/lib/intelligence/types";
import type { ModelProvider } from "../src/lib/models/provider";
import { LocalWorkspaceDriver } from "../src/lib/sandbox/local";
import { genomeSchema } from "../src/lib/strategy/runtime";

describe("adaptive compute (M47)", () => {
  it("parses strictly; static is the default and changes nothing", () => {
    expect(() => genomeSchema.parse({ compute: { mode: "turbo" } })).toThrow();
    expect(() =>
      genomeSchema.parse({ compute: { ladder: ["critic", "swarm"] } }),
    ).toThrow();
    expect(startTier({}, "coding")).toBe("STANDARD");
    expect(
      nextEscalation({
        genome: {},
        armId: "coding",
        verification: "rejected",
        openHypotheses: 3,
        remainingCalls: 10,
      }).rung,
    ).toBeNull();
  });

  it("holds every check the pulse runs hourly", async () => {
    for (const entry of COMPUTE_CHECKS)
      expect(entry.check().held, entry.title).toBe(true);
    const specs = (await pulseCatalog()).filter(
      (spec) => spec.family === "ADAPTIVE_COMPUTE",
    );
    expect(specs.map((spec) => spec.level)).toEqual([1, 2, 3, 4, 5]);
  });

  it("spends fewer calls per verified result than always escalating, without losing verified results to a single worker", () => {
    for (const seed of ["a", "b", "c"]) {
      const { callsPerVerified, policies } = simulate(seed);
      expect(callsPerVerified.adaptive).toBeLessThan(
        callsPerVerified.alwaysTeam,
      );
      expect(policies.adaptive.verified).toBeGreaterThan(
        policies.single.verified,
      );
    }
  });

  it("learns a start tier and an escalation switch from judged experience only", () => {
    const versions = new Map<string, StrategyVersion>([
      [
        "fast",
        { id: "fast", genome: { computeTier: "FAST" } } as StrategyVersion,
      ],
      ["std", { id: "std", genome: {} } as StrategyVersion],
      [
        "team",
        {
          id: "team",
          genome: { team: { topology: "parallel_solvers_judge" } },
        } as StrategyVersion,
      ],
    ]);
    const row = (versionId: string, verified: boolean, index: number) =>
      ({
        id: `${versionId}${index}`,
        source: "trial",
        capabilityIds: ["math.quantitative"],
        strategyVersionId: versionId,
        outcome: verified ? "verified_success" : "failure",
        tokens: versionId === "team" ? 6000 : 2000,
        trajectory: {},
      }) as unknown as Experience;
    const experience = [
      ...[1, 1, 1, 0].map((v, i) => row("fast", Boolean(v), i)),
      ...[1, 1, 1, 0].map((v, i) => row("std", Boolean(v), i + 10)),
      ...[1, 1, 1, 0].map((v, i) => row("team", Boolean(v), i + 20)),
    ];
    const learned = learnComputeEntry(
      experience,
      versions,
      "math.quantitative",
    )!;
    // FAST is as good as STANDARD, and the team did not pay for its tokens.
    expect(learned.start).toBe("FAST");
    expect(learned.escalate).toBe(false);
    const hypothesis = adaptiveComputeHypothesis({
      experience,
      versions,
      capabilityId: "math.quantitative",
      arm: "math_science",
      champion: {},
    })!;
    expect(hypothesis.intervention).toEqual({
      compute: {
        mode: "adaptive",
        table: { math_science: { start: "FAST", escalate: false } },
      },
    });
    expect(mechanismOf(hypothesis)).toBe("adaptive_compute");
    // Product rows never teach; nothing measured means the prior, not a guess.
    expect(
      learnComputeEntry(
        experience.map((entry) => ({ ...entry, source: "product" as const })),
        versions,
        "math.quantitative",
      ),
    ).toBeNull();
  });
});

function scripted(answer: string) {
  let calls = 0;
  const provider = {
    modelId: () => "scripted",
    structured: async <T>(input: { validate: (value: unknown) => T }) => {
      calls += 1;
      return {
        value: input.validate({ action: "FINISH", summary: "Answer", answer }),
        usage: { inputTokens: 10, outputTokens: 5 },
      };
    },
    complete: async () => {
      calls += 1;
      return { text: answer, usage: {} };
    },
    stream: async function* () {},
    capabilities: async () => ({}),
    healthCheck: async () => true,
    cancel: async () => undefined,
    normalizeUsage: () => ({}),
    normalizeError: () => new Error("x"),
  } as unknown as ModelProvider;
  return { provider, calls: () => calls };
}

describe("adaptive compute inside a production arm", () => {
  const task = {
    id: "compute",
    suite: "compound" as const,
    objective: "How many bottles are in 4 crates of 12?",
    composition: ["general" as const],
    expect: {},
  };

  it("escalates an unverified draft once and says why; static does not", async () => {
    const adaptive = scripted("There are 48 bottles.");
    const escalated = await runArenaTask(task, {
      provider: adaptive.provider,
      sandbox: async () => new LocalWorkspaceDriver(),
      policy: {
        strategyVersionId: null,
        label: "adaptive",
        genome: { compute: { mode: "adaptive", ladder: ["critic"] } },
        assignment: "trial",
      },
    });
    expect(escalated.status).toBe("completed");
    expect(escalated.events.join("\n")).toMatch(/compute\.escalated/);
    const fixed = scripted("There are 48 bottles.");
    const plain = await runArenaTask(task, {
      provider: fixed.provider,
      sandbox: async () => new LocalWorkspaceDriver(),
      policy: {
        strategyVersionId: null,
        label: "static",
        genome: {},
        assignment: "trial",
      },
    });
    expect(plain.events.join("\n")).not.toMatch(/compute\./);
    // The escalation is the extra spend: the critic's calls.
    expect(adaptive.calls()).toBeGreaterThan(fixed.calls());
  }, 60_000);
});
