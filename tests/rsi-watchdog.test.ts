import { afterEach, describe, expect, it } from "vitest";
import type { LoopResult } from "../src/lib/agent/loop";
import { resetPulseState } from "../src/lib/agent/pulse/state";
import {
  detectRegression,
  exportPulseBaselines,
  gradeLoopOutcome,
  importPulseBaselines,
} from "../src/lib/agent/watchdog/rsi";

afterEach(() => {
  resetPulseState();
});

describe("RSI watchdog", () => {
  it("grades loop outcomes without inspecting private reasoning", () => {
    const result: LoopResult = {
      status: "finished",
      state: {
        steps: [{ index: 0, action: "FINISH", summary: "done", outcome: "finished", latencyMs: 1 }],
        observations: [],
        disclosedSchemas: {},
        modelCalls: 1,
        toolCalls: 0,
        answer: "Result: 391",
        artifacts: [],
      },
      answer: "Result: 391",
      reason: "finished",
    };
    const graded = gradeLoopOutcome(result);
    expect(graded.success).toBe(true);
    expect(graded.verifiedSuccess).toBe(true);
  });

  it("surfaces regressions against pulse baselines", () => {
    importPulseBaselines([
      {
        lane: "CODING",
        level: 3,
        verifiedSuccessRate: 0.8,
        sampleCount: 5,
        lastObservedAt: new Date().toISOString(),
      },
    ]);
    const regression = detectRegression({
      lane: "CODING",
      level: 3,
      success: false,
      verifiedSuccess: false,
    });
    expect(regression?.kind).toBe("verified_drop");
    expect(exportPulseBaselines()[0]?.lane).toBe("CODING");
  });
});
