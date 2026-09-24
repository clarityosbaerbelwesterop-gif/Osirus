import { describe, expect, it } from "vitest";
import {
  evaluateGate,
  gateMetrics,
  type GateMetrics,
} from "../src/lib/arena/gate";
import type { TaskResult } from "../src/lib/arena/metrics";

function result(
  suite: string,
  verified: boolean,
  falseCompletion = false,
): TaskResult {
  return {
    taskId: `${suite}-${Math.random()}`,
    suite: suite as TaskResult["suite"],
    arm: suite,
    status: "completed",
    verdicts: [verified ? "verified" : "rejected"],
    success: verified,
    verifiedSuccess: verified,
    falseCompletion,
    toolCalls: 0,
    modelCalls: 1,
    inputTokens: 0,
    outputTokens: 0,
    costUsd: 0,
    latencyMs: 1,
    repairs: 0,
    humanInterventions: 0,
    securityEvents: 0,
    notes: [],
    answerExcerpt: "",
  };
}

const baseline: GateMetrics = gateMetrics("m", [
  result("coding", true),
  result("coding", true),
  result("research", true),
  result("research", true),
]);

describe("regression gate", () => {
  it("passes when nothing got worse", () => {
    const gate = evaluateGate({ baseline, current: baseline });
    expect(gate.enforced).toBe(true);
    expect(gate.passed).toBe(true);
  });

  it("fails on more false completions", () => {
    const current = gateMetrics("m", [
      result("coding", true),
      result("coding", false, true),
      result("research", true),
      result("research", true),
    ]);
    const gate = evaluateGate({ baseline, current });
    expect(gate.passed).toBe(false);
    expect(
      gate.findings.find((f) => f.rule === "false_completion_rate")?.status,
    ).toBe("failed");
  });

  it("fails when coding verification collapses or citations stop holding", () => {
    const current = gateMetrics("m", [
      result("coding", false),
      result("coding", false),
      result("research", false),
      result("research", true),
    ]);
    const gate = evaluateGate({ baseline, current });
    const failed = gate.findings
      .filter((f) => f.status === "failed")
      .map((f) => f.rule);
    expect(failed).toEqual(
      expect.arrayContaining(["coding_verified_rate", "citation_validity"]),
    );
  });

  it("fails when math verification drops beyond threshold", () => {
    const mathBaseline = gateMetrics("m", [
      result("math", true),
      result("math", true),
      result("coding", true),
    ]);
    const current = gateMetrics("m", [
      result("math", false),
      result("math", false),
      result("coding", true),
    ]);
    const gate = evaluateGate({ baseline: mathBaseline, current });
    expect(
      gate.findings.find((f) => f.rule === "math_verified_rate")?.status,
    ).toBe("failed");
  });

  it("fails on security or tenant isolation regardless of baseline", () => {
    expect(
      evaluateGate({
        baseline: null,
        current: baseline,
        securitySuitePassed: false,
      }).passed,
    ).toBe(false);
    expect(
      evaluateGate({
        baseline: null,
        current: baseline,
        tenantIsolationPassed: false,
      }).passed,
    ).toBe(false);
  });

  it("reports but does not enforce without a baseline for the model", () => {
    const worse = gateMetrics("other-model", [result("coding", false, true)]);
    const gate = evaluateGate({ baseline, current: worse });
    expect(gate.enforced).toBe(false);
    expect(gate.passed).toBe(true);
  });
});
