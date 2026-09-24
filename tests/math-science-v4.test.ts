import { describe, expect, it } from "vitest";
import { MathScienceArm } from "../src/lib/arms/math-science";
import {
  formalizeProblem,
  renderFormalizationPlan,
  underdeterminedFailureDetail,
} from "../src/lib/math-science/formalization";
import {
  counterexampleGateCheck,
  recomputationGateCheck,
  sanityGateCheck,
} from "../src/lib/math-science/verification-gates";
import {
  MATH_SCIENCE_PULSE_TASKS,
  pulseTasksForLevel,
} from "../src/lib/math-science/pulse-suite";
import {
  formatPulseMarkdown,
  registerMathSciencePulseHook,
  runMathSciencePulse,
} from "../src/lib/math-science/pulse";
import type { ArmStageContext } from "../src/lib/arms/types";

function contextFor(objective: string, state: Record<string, unknown> = {}) {
  return {
    identity: {
      userId: "u",
      organizationId: "o",
      workspaceId: "w",
    },
    work: {
      attemptId: "a",
      leaseToken: "t",
      leaseExpiresAt: new Date().toISOString(),
      attemptNumber: 1,
      sliceCount: 0,
      handoff: {},
      runId: "11111111-1111-4111-8111-111111111111",
      stageId: "22222222-2222-4222-8222-222222222222",
      organizationId: "o",
      workspaceId: "w",
      sessionId: "s",
      requestedBy: "u",
      objective,
      stageName: "verify",
      capability: "math_science",
      ordinal: 0,
      stageInput: { stageKind: "verify", armId: "math_science" },
      requiresVerification: true,
    },
    runtime: {
      provider: {
        structured: async () => ({
          value: { verdict: "pass", reason: "reads as complete" },
          usage: {},
        }),
      },
    },
    state,
  } as unknown as ArmStageContext;
}

describe("M37 formalization", () => {
  it("extracts knowns, unknowns and plan steps from a quantitative objective", () => {
    const formalization = formalizeProblem(
      "A ball is thrown at 20 m/s. Using g = 9.81 m/s^2, compute the maximum height in metres.",
    );
    expect(formalization.knowns.length).toBeGreaterThan(0);
    expect(formalization.unknowns.length).toBeGreaterThan(0);
    expect(formalization.planSteps.length).toBeGreaterThanOrEqual(3);
    expect(formalization.underdetermined).toBe(false);
    expect(renderFormalizationPlan(formalization)).toContain("Plan:");
  });

  it("marks underdetermined systems and plans honest failure", () => {
    const formalization = formalizeProblem(
      "Find x and y given only that x + y = 10. Do not invent a second equation.",
    );
    expect(formalization.underdetermined).toBe(true);
    expect(
      formalization.planSteps.some((step) => /underdetermined/i.test(step.action)),
    ).toBe(true);
    const failure = underdeterminedFailureDetail(
      formalization,
      "Result: x=3 and y=7.",
    );
    expect(failure).toMatch(/underdetermined/i);
  });

  it("flags universal claims for counterexample search", () => {
    const formalization = formalizeProblem(
      "Prove that n^2 + n + 41 is prime for every positive integer n.",
    );
    expect(formalization.needsCounterexampleSearch).toBe(true);
    expect(
      formalization.planSteps.some((step) =>
        /counterexample/i.test(step.action),
      ),
    ).toBe(true);
  });
});

describe("M37 verification gates", () => {
  const evidence = [
    {
      toolId: "compute.run",
      ok: true,
      input: { op: "evaluate", expression: "80 * 0.85 * 1.1" },
      data: {
        result: { op: "evaluate", ok: true, value: 74.8, text: "74.8" },
        check: { agrees: true, method: "plain_summation" },
      },
    },
  ];

  it("passes sanity and recomputation when result matches computation", () => {
    const answer =
      "Result: 74.8 after discount and tax. 80 * 0.85 = 68; 68 * 1.1 = 74.8.";
    expect(sanityGateCheck(answer).status).toBe("passed");
    expect(recomputationGateCheck(answer, evidence).status).toBe("passed");
  });

  it("fails sanity on impossible physical values", () => {
    const answer = "Result: -5 metres maximum height.";
    expect(sanityGateCheck(answer).status).toBe("failed");
  });

  it("requires counterexample search for universal claims", () => {
    expect(
      counterexampleGateCheck("This identity holds for all integers n.").status,
    ).toBe("failed");
    expect(
      counterexampleGateCheck(
        "Tested n=40 as a counterexample; the claim fails there.",
      ).status,
    ).toBe("passed");
  });
});

describe("M37 math_science arm integration", () => {
  const arm = new MathScienceArm();

  it("adds formalization stage and M37 verification gates", async () => {
    const workflow = arm.buildWorkflow();
    const keys = workflow.nodes.map((node) => node.key);
    expect(keys).toContain("formalize-problem");

    const verdict = await arm.verify(
      contextFor("Compute 2 + 2.", {
        answer: "2 + 2 = 4.\n\nResult: 4",
        toolEvidence: [
          {
            toolId: "compute.run",
            ok: true,
            input: { op: "evaluate", expression: "2+2" },
            data: {
              result: { ok: true, value: 4, text: "4" },
              check: { agrees: true, method: "plain_summation" },
            },
          },
        ],
        mathFormalization: formalizeProblem("Compute 2 + 2."),
      }),
    );
    expect(verdict.checks.map((check) => check.id)).toEqual(
      expect.arrayContaining([
        "sanity-gate",
        "recomputation-gate",
        "counterexample-gate",
        "computed-result",
      ]),
    );
  });

  it("rejects underdetermined answers that invent a definite result", async () => {
    const formalization = formalizeProblem("Find x and y where x + y = 10.");
    const verdict = await arm.verify(
      contextFor("Find x and y where x + y = 10.", {
        answer: "Result: x=4 and y=6.",
        mathFormalization: formalization,
        toolEvidence: [],
      }),
    );
    expect(verdict.status).toBe("rejected");
  });
});

describe("M37 pulse suite", () => {
  it("defines L1–L5 tasks", () => {
    expect(MATH_SCIENCE_PULSE_TASKS.length).toBe(10);
    for (const level of [1, 2, 3, 4, 5] as const) {
      expect(pulseTasksForLevel(level).length).toBeGreaterThanOrEqual(2);
    }
  });

  it("runs offline pulse with independent gates", async () => {
    const seen: string[] = [];
    registerMathSciencePulseHook((records) => {
      seen.push(...records.map((record) => record.id));
    });
    const records = await runMathSciencePulse(5);
    expect(records.length).toBe(10);
    expect(seen.length).toBe(10);
    for (const record of records) {
      expect(record.liveProvider).toBe(false);
      expect(record.falseCompletion).toBe(true);
    }
    const unverified = records.filter((record) => !record.verifiedSuccess);
    expect(unverified.map((record) => record.id)).toEqual([]);
    expect(records.filter((record) => record.verifiedSuccess).length).toBe(
      records.length,
    );
    const markdown = formatPulseMarkdown(records);
    expect(markdown).toContain("M37 Math/Science pulse");
    expect(markdown).toContain("pulse-l5-underdetermined");
  }, 120_000);
});
