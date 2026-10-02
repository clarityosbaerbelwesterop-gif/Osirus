import { describe, expect, it, vi } from "vitest";
import {
  applyHeadGrad,
  forwardTokens,
  initParams,
  matvec,
  meanNll,
  outputHeadGrad,
} from "../programs/architecture";
import { programAvailability } from "../programs/catalog";
import { checkpointLineage } from "../programs/lineage";
import {
  executeMedian,
  forbidsTrainedClaim,
  gradeArm,
  staticSecurityScan,
} from "../programs/behavior";
import { LAB_BUILD } from "../../src/lib/lab/choices";
import { LoopBoundaryError, runResearchLoop } from "../programs/loop";
import { rougeProgram } from "../programs/rouge";
import {
  activityFor,
  answerWithProgram,
  provenanceLine,
} from "../programs/serve";

const offline = {
  checkpointPresent: false,
  checkpointValidated: false,
  runtimeOnline: false,
};

describe("rouge model program", () => {
  it("runs a real dense-rope forward and an output-head backward step", () => {
    const params = initParams(
      rougeProgram.architecture.fixture,
      rougeProgram.training.seed,
    );
    const tokens = [1, 2, 3];
    const targets = [2, 3, 1];
    const first = forwardTokens(params, tokens);
    expect(first.logits).toHaveLength(3);
    expect(first.logits[0]).toHaveLength(
      rougeProgram.architecture.fixture.vocab,
    );
    expect(first.logits[0]?.every((value) => Number.isFinite(value))).toBe(
      true,
    );
    const before = meanNll(first.logits, targets);
    const hidden = params.embed.slice(0, params.arch.dim);
    const grad = outputHeadGrad(params, hidden, targets[0] ?? 0);
    const eps = 1e-5;
    const bumped = { ...params, head: params.head.slice() };
    bumped.head[0] = (bumped.head[0] ?? 0) + eps;
    const dropped = { ...params, head: params.head.slice() };
    dropped.head[0] = (dropped.head[0] ?? 0) - eps;
    const numeric =
      (meanNll([mat(bumped, hidden)], [targets[0] ?? 0]) -
        meanNll([mat(dropped, hidden)], [targets[0] ?? 0])) /
      (2 * eps);
    expect(Math.abs(numeric - (grad[0] ?? 0))).toBeLessThan(1e-4);
    const stepped = applyHeadGrad(params, grad, 0.1);
    expect(stepped.head).not.toEqual(params.head);
    expect(Number.isFinite(before)).toBe(true);
  });

  it("lists the rouge arms and refuses a trained-model claim", () => {
    expect(rougeProgram.arms.map((arm) => arm.id)).toEqual([
      "ROUGE_REASONING",
      "ROUGE_MATH",
      "ROUGE_SCIENCE",
      "ROUGE_CODING",
      "ROUGE_RESEARCH",
      "ROUGE_LONG_CONTEXT",
      "ROUGE_MEMORY",
      "ROUGE_VERIFICATION",
      "ROUGE_PLANNING",
      "ROUGE_THINKING",
      "ROUGE_CYBERSECURITY",
      "ROUGE_TERMINAL",
      "ROUGE_LONG_HORIZON",
    ]);
    expect(rougeProgram.evalSuite.measured).toBe(false);
    expect(
      forbidsTrainedClaim("I am a trained Rouge model", "Rouge"),
    ).toBeTruthy();
    expect(gradeArm("exact", { input: "yes", target: "yes" }).passed).toBe(
      true,
    );
    expect(staticSecurityScan("eval(code)")).toContain("eval-call");
  });

  it("holds the research loop below production and away from locked surfaces", () => {
    const report = runResearchLoop(rougeProgram);
    expect(report.trainedModel).toBe(false);
    expect(report.production).toBe(false);
    expect(
      report.artifactState === "production" ||
        report.artifactState === "production_candidate",
    ).toBe(false);
    expect(report.loopId).toBe("ROUGE_LOOP");
    expect(() => runResearchLoop(rougeProgram, "budget_limit")).toThrow(
      LoopBoundaryError,
    );
    expect(() => runResearchLoop(rougeProgram, "trust_root")).toThrow(
      LoopBoundaryError,
    );
  });

  it("labels UnoRouter as API fallback and fails closed without a key", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            model: "qwen3:free",
            choices: [{ message: { content: "ok" } }],
            usage: { prompt_tokens: 1, completion_tokens: 1 },
          }),
          { status: 200 },
        ),
    );
    const answer = await answerWithProgram({
      program: rougeProgram,
      native: offline,
      messages: [{ role: "user", content: "hi" }],
      apiKey: "test-key",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      env: { NODE_ENV: "test" },
    });
    expect(answer.userLabel).toBe("ROUGE 1 · API fallback");
    expect(answer.provenance).toBe(
      "ROUGE-1 / api_fallback / UnoRouter / qwen3:free",
    );
    expect(answer.activity).toBe("api_fallback");
    expect(answer.costPolicy).toBe("provider_fallback");
    expect(answer.phases).toEqual(["thinking", "reasoning"]);
    expect(answer.outsideProgram).toBe(false);
    expect(answer.checkpoint).toBeNull();
    expect(answer.trained).toBe(false);
    expect(answer.text).not.toMatch(/trained Rouge checkpoint/);
    await expect(
      answerWithProgram({
        program: rougeProgram,
        native: offline,
        messages: [{ role: "user", content: "hi" }],
        apiKey: undefined,
        env: { NODE_ENV: "test" },
        fetchImpl: vi.fn() as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/UNOROUTER_API_KEY/);
    expect(activityFor(rougeProgram, "code_analysis")).toBe("idle");
    expect(activityFor(rougeProgram, "reasoning")).toBe("reasoning");
    expect(programAvailability()).toEqual({
      rouge: true,
      quasnir: true,
      darus: true,
    });
    expect(LAB_BUILD).toEqual({ rouge: true, quasnir: true, darus: true });
    expect(checkpointLineage(rougeProgram)).toMatchObject({
      trained: false,
      production: false,
      checkpointId: null,
    });
    expect(executeMedian([1, 2, 3, 4])).toBe(2.5);
    expect(
      gradeArm("execute", { input: "1, 2, 3, 4", target: "2.5" }).passed,
    ).toBe(true);
    expect(
      gradeArm("static-scan", { input: "eval(code)", target: "1" }).passed,
    ).toBe(true);
    const fimArch = {
      ...rougeProgram.architecture.fixture,
      family: "fim-causal" as const,
    };
    const fim = initParams(fimArch, 3);
    const plain = forwardTokens(fim, [1, 2, 3]);
    const filled = forwardTokens(fim, [1, 2, 3], { fimMiddleFrom: 1 });
    expect(filled.logits[2]).not.toEqual(plain.logits[2]);
    const routedArch = {
      ...rougeProgram.architecture.fixture,
      family: "routed-dense" as const,
      experts: 2,
    };
    const routed = forwardTokens(initParams(routedArch, 4), [1, 2]);
    const gate = routed.route[0] ?? [];
    expect(gate).toHaveLength(2);
    expect(Math.abs((gate[0] ?? 0) + (gate[1] ?? 0) - 1)).toBeLessThan(1e-9);
    expect(
      provenanceLine({
        program: rougeProgram,
        provider: "native",
        modelId: rougeProgram.nativeModelId,
        checkpoint: "r1-001",
      }),
    ).toBe("ROUGE-1 / native / checkpoint r1-001");
  });
});

function mat(
  params: ReturnType<typeof initParams>,
  hidden: number[],
): number[] {
  return matvec(params.head, params.arch.vocab, params.arch.dim, hidden);
}
