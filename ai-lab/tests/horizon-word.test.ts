import { describe, expect, it } from "vitest";
import { executeArmPolicy } from "../programs/arm-policy";
import { gradeArm } from "../programs/behavior";
import { darusProgram } from "../programs/darus";
import { evalWordProblem, readHorizon } from "../programs/domains";
import { quasnirProgram } from "../programs/quasnir";
import { rougeProgram } from "../programs/rouge";

describe("long horizon and word problems", () => {
  it("records a longer horizon and a late failure without a score", () => {
    const deep = readHorizon("ok:a;ok:b;ok:c;ok:d;need:a;need:b;need:c;need:d");
    expect(deep).toMatchObject({
      count: 8,
      executed: 0,
      scored: false,
      failedAt: null,
      malformed: false,
    });
    const late = readHorizon("ok:a;ok:b;ok:c;ok:d;ok:e;ok:f;fail:ship");
    expect(late.failedAt).toBe(7);
    expect(late.scored).toBe(false);
    expect(late.executed).toBe(0);
    const prose = readHorizon("one. two. three. four. five. six.");
    expect(prose.count).toBe(6);
    expect(prose.scored).toBe(false);
    expect(readHorizon("ok:read;later:ship").malformed).toBe(true);
    const arm = rougeProgram.arms.find(
      (item) => item.id === "ROUGE_LONG_HORIZON",
    );
    const ran = executeArmPolicy(arm!, "ok:a;ok:b;ok:c;ok:d;ok:e;fail:ship");
    expect(
      ran.steps.some((step) =>
        step.includes("failed at 6, 0 executed, not scored"),
      ),
    ).toBe(true);
    const quiet = executeArmPolicy(arm!, "hold");
    expect(quiet.steps.some((step) => step.startsWith("horizon:"))).toBe(true);
    expect(
      quiet.steps.some(
        (step) => step.startsWith("horizon:") && step.includes("failed at"),
      ),
    ).toBe(false);
  });

  it("records a word-problem value only after the fields parse", () => {
    expect(evalWordProblem("boxes:3;each:4;ask:total")).toEqual({
      ok: true,
      value: 12,
    });
    expect(evalWordProblem("had:10;got:2;gave:3;ask:left")).toEqual({
      ok: true,
      value: 9,
    });
    expect(evalWordProblem("groups:2;each:5;extra:1;ask:total")).toEqual({
      ok: true,
      value: 11,
    });
    expect(evalWordProblem("boxes:3;ask:total").ok).toBe(false);
    expect(evalWordProblem("boxes:2;each:3;had:1;ask:total").ok).toBe(false);
    const math = quasnirProgram.arms.find((item) => item.id === "QUASNIR_MATH");
    const unmet = gradeArm(math!.task.grader, {
      input: "groups:2;ask:total",
      target: "11",
    });
    expect(unmet.passed).toBe(false);
    expect(unmet.detail).toBe("word problem not parsed");
    const ran = executeArmPolicy(math!, "groups:2;each:5;extra:1;ask:total");
    expect(ran.steps.some((step) => step.includes("word 11 after run"))).toBe(
      true,
    );
    const plain = executeArmPolicy(math!, "review the patch");
    expect(plain.steps.some((step) => step.includes("word"))).toBe(false);
    expect(
      plain.steps.some((step) =>
        step.includes("no integer expression in the request"),
      ),
    ).toBe(true);
    const darus = darusProgram.arms.find((item) => item.id === "DARUS_MATH");
    expect(
      gradeArm(darus!.task.grader, {
        input: "had:20;got:1;gave:4;ask:left",
        target: "17",
      }).passed,
    ).toBe(true);
  });
});
