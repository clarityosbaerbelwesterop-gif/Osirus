import { describe, expect, it } from "vitest";
import { forwardTokens, initParams } from "../programs/architecture";
import { runResearchLoop } from "../programs/loop";
import { darusProgram } from "../programs/darus";
import { activityFor, provenanceLine } from "../programs/serve";

describe("darus model program", () => {
  it("routes two experts and refuses a trained or production claim", () => {
    expect(darusProgram.arms.map((arm) => arm.id)).toEqual([
      "DARUS_REASONING",
      "DARUS_MATH",
      "DARUS_SCIENCE",
      "DARUS_CODING",
      "DARUS_RESEARCH",
      "DARUS_PLANNING",
      "DARUS_LONG_CONTEXT",
      "DARUS_MEMORY",
      "DARUS_TOOL_REASONING",
      "DARUS_WORLD_MODEL",
      "DARUS_MULTIMODAL",
      "DARUS_VERIFICATION",
      "DARUS_STRATEGY",
    ]);
    const params = initParams(
      darusProgram.architecture.fixture,
      darusProgram.training.seed,
    );
    const out = forwardTokens(params, [1, 2, 3]);
    const gates = out.route[0] ?? [];
    expect(gates).toHaveLength(2);
    expect(Math.abs((gates[0] ?? 0) + (gates[1] ?? 0) - 1)).toBeLessThan(1e-9);
    const report = runResearchLoop(darusProgram);
    expect(report.loopId).toBe("DARUS_LOOP");
    expect(report.trainedModel).toBe(false);
    expect(report.production).toBe(false);
    expect(report.decision === "hold" || report.decision === "reject").toBe(
      true,
    );
    expect(activityFor(darusProgram, "deep_reasoning")).toBe("deep_reasoning");
    expect(activityFor(darusProgram, "security_scan")).toBe("idle");
    expect(
      provenanceLine({
        program: darusProgram,
        provider: "unorouter",
        modelId: "gemini-3.6-flash:free",
        checkpoint: null,
      }),
    ).toBe("DARUS / api_fallback / UnoRouter / gemini-3.6-flash:free");
    expect(darusProgram.training.trainingReady).toBe(false);
    expect(darusProgram.evalSuite.measured).toBe(false);
  });
});
