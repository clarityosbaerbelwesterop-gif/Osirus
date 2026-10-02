import { describe, expect, it } from "vitest";
import { gradeArm } from "../programs/behavior";
import { runResearchLoop } from "../programs/loop";
import { quasnirProgram } from "../programs/quasnir";
import { provenanceLine, userLabel } from "../programs/serve";

describe("quasnir model program", () => {
  it("grades code, scan, patch, tests, and regression without a perfect score", () => {
    expect(quasnirProgram.arms.map((arm) => arm.id)).toEqual([
      "QUASNIR_CODING",
      "QUASNIR_DEBUGGING",
      "QUASNIR_REPOSITORY",
      "QUASNIR_CODE_REVIEW",
      "QUASNIR_SECURITY",
      "QUASNIR_VULNERABILITY",
      "QUASNIR_DEVOPS",
      "QUASNIR_DATABASE",
      "QUASNIR_INFRASTRUCTURE",
      "QUASNIR_TESTING",
      "QUASNIR_ARCHITECTURE",
    ]);
    const graded = quasnirProgram.arms.map((arm) => {
      const sample = arm.dataset.samples[0];
      if (!sample) throw new Error("missing sample");
      return gradeArm(arm.task.grader, sample).passed;
    });
    expect(graded.every(Boolean)).toBe(true);
    expect(quasnirProgram.evalSuite.measured).toBe(false);
    expect(quasnirProgram.training.trainingReady).toBe(false);
    const report = runResearchLoop(quasnirProgram);
    expect(report.loopId).toBe("QUASNIR_LOOP");
    expect(report.trainedModel).toBe(false);
    expect(report.production).toBe(false);
    expect(userLabel(quasnirProgram, "unorouter")).toBe(
      "QUASNIR · API fallback",
    );
    expect(
      provenanceLine({
        program: quasnirProgram,
        provider: "unorouter",
        modelId: "qwen2.5-coder-32b:free",
        checkpoint: null,
      }),
    ).toBe("QUASNIR / api_fallback / UnoRouter / qwen2.5-coder-32b:free");
  });
});
