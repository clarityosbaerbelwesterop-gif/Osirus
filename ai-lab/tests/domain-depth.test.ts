import { describe, expect, it } from "vitest";
import { executeArmPolicy } from "../programs/arm-policy";
import { gradeArm, runAssertionFixture } from "../programs/behavior";
import { darusProgram } from "../programs/darus";
import {
  checkCitation,
  classifyRepoPath,
  dependencyCycle,
  dryRunPlan,
  independentExpected,
  nameTool,
  parseStatement,
  reactionBalance,
  readPlan,
  readStrategy,
} from "../programs/domains";
import { quasnirProgram } from "../programs/quasnir";
import { runReasoningPolicy } from "../programs/reasoning";
import { rougeProgram } from "../programs/rouge";
import { gradeRsiSample } from "../programs/rsi";

describe("thin domain fixtures", () => {
  it("fails a research claim that has no citation id and does not fetch", () => {
    expect(checkCitation("claim=water is wet")).toEqual({
      detail: "missing-id",
      id: null,
    });
    expect(checkCitation("https://example.test/id=fixture")).toMatchObject({
      detail: "no fetch in this fixture",
    });
    const research = rougeProgram.arms.find(
      (arm) => arm.id === "ROUGE_RESEARCH",
    );
    expect(research).toBeTruthy();
    const absent = executeArmPolicy(research!, "summarize the notes");
    expect(
      absent.steps.some(
        (step) => step.startsWith("research:") && step.includes("missing-id"),
      ),
    ).toBe(false);
    expect(
      absent.steps.some(
        (step) => step.startsWith("research:") && step.includes("no citation"),
      ),
    ).toBe(true);
    const claim = executeArmPolicy(research!, "claim=water is wet");
    expect(claim.steps.some((step) => step.includes("missing-id"))).toBe(true);
    const darus = darusProgram.arms.find((arm) => arm.id === "DARUS_RESEARCH");
    expect(
      gradeArm(darus!.task.grader, {
        input: "claim=breadth without a source",
        target: "missing-id",
      }).passed,
    ).toBe(true);
  });

  it("fails a plan that skips a required step and executes none", () => {
    const skipped = readPlan("need:gather,compare;steps:gather.");
    expect(skipped).toMatchObject({
      executed: 0,
      skipped: "compare",
      complete: false,
    });
    const held = readPlan("need:gather,compare;steps:gather. compare.");
    expect(held.complete).toBe(true);
    expect(held.executed).toBe(0);
    const planning = rougeProgram.arms.find(
      (arm) => arm.id === "ROUGE_PLANNING",
    );
    const ran = executeArmPolicy(
      planning!,
      "need:gather,compare;steps:gather.",
    );
    expect(ran.steps.some((step) => step.includes("skipped compare"))).toBe(
      true,
    );
    expect(ran.steps.some((step) => step.includes("0 executed"))).toBe(true);
  });

  it("compares verification against an independent expected value", () => {
    expect(independentExpected("expr=(2+3)*4;expect=20")).toBe("match");
    expect(independentExpected("claimed=21;expr=(2+3)*4;expect=20")).toBe(
      "mismatch",
    );
    expect(independentExpected("expr=1/0;expect=0")).toBe("refused");
    const verification = rougeProgram.arms.find(
      (arm) => arm.id === "ROUGE_VERIFICATION",
    );
    const plain = executeArmPolicy(verification!, "look at this note");
    expect(
      plain.steps.some(
        (step) =>
          step.startsWith("verification:") &&
          (step.includes("same") || step.includes("match")),
      ),
    ).toBe(false);
    const ran = executeArmPolicy(verification!, "expr=(2+3)*4;expect=20");
    expect(ran.steps.some((step) => step.includes("verification: match"))).toBe(
      true,
    );
  });

  it("parses a statement without a connection and refuses a live devops change", () => {
    expect(parseStatement("select 1")).toEqual({
      kind: "select",
      connected: false,
      detail: "1",
    });
    expect(parseStatement("select name from fixture where id=1")).toMatchObject(
      { kind: "select", connected: false, detail: "parsed" },
    );
    expect(parseStatement("drop table fixture").detail).toBe("refused");
    expect(parseStatement("select 1; select 2").connected).toBe(false);
    expect(dryRunPlan("dry-run plan")).toBe("dry-run");
    expect(dryRunPlan("live restart")).toBe("refused");
    expect(dryRunPlan("deploy now")).toBe("refused");
    const database = quasnirProgram.arms.find(
      (arm) => arm.id === "QUASNIR_DATABASE",
    );
    const parsed = executeArmPolicy(database!, "select name from fixture");
    expect(parsed.steps.some((step) => step.includes("connected=false"))).toBe(
      true,
    );
    const quiet = executeArmPolicy(database!, "review the schema notes");
    expect(quiet.steps.some((step) => step.includes("parsed"))).toBe(false);
  });

  it("fails an unmet assertion only after the fixture runs", () => {
    expect(runAssertionFixture("assert:1+2=4")).toEqual({
      ran: true,
      detail: "unmet",
    });
    expect(runAssertionFixture("assert:1+2=3")).toEqual({
      ran: true,
      detail: "met",
    });
    const testing = quasnirProgram.arms.find(
      (arm) => arm.id === "QUASNIR_TESTING",
    );
    const unmet = gradeArm(testing!.task.grader, {
      input: "assert:1+2=4",
      target: "pass",
    });
    expect(unmet.passed).toBe(false);
    expect(unmet.detail).toBe("fail after run");
    const ran = executeArmPolicy(testing!, "assert:1+2=4");
    expect(ran.steps.some((step) => step.includes("fail after run"))).toBe(
      true,
    );
  });

  it("fails a dependency cycle and an unsafe repository path", () => {
    expect(dependencyCycle("edges:web>api,api>db")).toBe("acyclic");
    expect(dependencyCycle("edges:api>db,db>api")).toBe("cycle");
    expect(dependencyCycle("edges:a>a")).toBe("cycle");
    expect(classifyRepoPath("repo:fixture/%2e%2e/secret")).toBe("refused");
    expect(classifyRepoPath("repo:fixture/a/../../secret")).toBe("refused");
    expect(classifyRepoPath("repo:etc/passwd")).toBe("outside");
    expect(classifyRepoPath("repo:fixture/readme")).toBe("fixture/readme");
    const architecture = quasnirProgram.arms.find(
      (arm) => arm.id === "QUASNIR_ARCHITECTURE",
    );
    expect(architecture?.task.grader).toBe("graph");
    const ran = executeArmPolicy(architecture!, "edges:api>db,db>api");
    expect(ran.steps.some((step) => step.includes("architecture: cycle"))).toBe(
      true,
    );
  });

  it("names a tool without calling it and keeps the world step able to block", () => {
    expect(nameTool("tool:notes")).toEqual({ status: "named", called: false });
    expect(nameTool("call:notes")).toEqual({
      status: "refused",
      called: false,
    });
    const tool = darusProgram.arms.find(
      (arm) => arm.id === "DARUS_TOOL_REASONING",
    );
    const named = executeArmPolicy(tool!, "tool:notes");
    expect(named.steps.some((step) => step.includes("called=false"))).toBe(
      true,
    );
    const idle = executeArmPolicy(tool!, "consider the notes");
    expect(idle.steps.some((step) => step.startsWith("tool:"))).toBe(true);
    expect(
      idle.steps.some(
        (step) => step.startsWith("tool:") && step.includes("called="),
      ),
    ).toBe(false);
    const world = darusProgram.arms.find(
      (arm) => arm.id === "DARUS_WORLD_MODEL",
    );
    const blocked = executeArmPolicy(world!, "pos=1,1;action=up");
    expect(blocked.steps.some((step) => step.includes("world: blocked"))).toBe(
      true,
    );
    const multimodal = darusProgram.arms.find(
      (arm) => arm.id === "DARUS_MULTIMODAL",
    );
    expect(
      gradeArm(multimodal!.task.grader, {
        input: "encoder:image",
        target: "refused",
      }).detail,
    ).toMatch(/no encoder/);
    expect(
      gradeArm(multimodal!.task.grader, {
        input: "no-encoder",
        target: "unavailable",
      }).passed,
    ).toBe(true);
  });

  it("records a strategy choice and a rejected alternative", () => {
    expect(readStrategy("choose:hold;reject:ship")).toEqual({
      ok: true,
      choice: "hold",
      rejected: "ship",
      executed: 0,
    });
    expect(readStrategy("choose:hold")).toMatchObject({
      ok: false,
      detail: "missing-alternative",
    });
    expect(readStrategy("choose:hold;reject:hold")).toMatchObject({
      ok: false,
      detail: "not-alternative",
    });
    const strategy = darusProgram.arms.find(
      (arm) => arm.id === "DARUS_STRATEGY",
    );
    const ran = executeArmPolicy(strategy!, "choose:hold;reject:ship");
    expect(
      ran.steps.some((step) =>
        step.includes("chose hold, rejected ship, 0 executed"),
      ),
    ).toBe(true);
    const quiet = executeArmPolicy(strategy!, "hold the work");
    expect(
      quiet.steps.some(
        (step) => step.startsWith("strategy:") && step.includes("chose"),
      ),
    ).toBe(false);
    expect(
      quiet.steps.some(
        (step) => step.startsWith("strategy:") && step.includes("no choice"),
      ),
    ).toBe(true);
  });

  it("balances a reaction and bounds the fixture context without a score", () => {
    expect(reactionBalance("2H2+O2->2H2O")).toBe("balanced");
    expect(reactionBalance("H2+O2->H2O")).toBe("unbalanced");
    const science = rougeProgram.arms.find((arm) => arm.id === "ROUGE_SCIENCE");
    const quiet = executeArmPolicy(science!, "describe the lab");
    expect(
      quiet.steps.some(
        (step) => step.startsWith("science:") && step.includes("H:"),
      ),
    ).toBe(false);
    expect(
      quiet.steps.some(
        (step) => step.startsWith("science:") && step.includes("no formula"),
      ),
    ).toBe(true);
    const ran = executeArmPolicy(science!, "count H2O");
    expect(ran.steps.some((step) => step.includes("H:2,O:1"))).toBe(true);
    const context = rougeProgram.arms.find(
      (arm) => arm.id === "ROUGE_LONG_CONTEXT",
    );
    expect(
      gradeArm(context!.task.grader, { input: "8", target: "fits" }).passed,
    ).toBe(true);
    expect(
      gradeArm(context!.task.grader, { input: "0", target: "refused" }).passed,
    ).toBe(true);
    expect(
      gradeArm(context!.task.grader, { input: "9", target: "fits" }).passed,
    ).toBe(false);
  });

  it("shows thinking only after classification and still withholds a bad RSI step", () => {
    const quasnir = runReasoningPolicy(quasnirProgram, "patch the function");
    expect(quasnir.phases).not.toContain("thinking");
    const thought = runReasoningPolicy(quasnirProgram, "think about the patch");
    expect(thought.phases).toContain("thinking");
    const darus = runReasoningPolicy(darusProgram, "compare across domains");
    expect(darus.phases).not.toContain("thinking");
    const darusThought = runReasoningPolicy(darusProgram, "think and plan");
    expect(darusThought.phases).toContain("thinking");
    expect(darusThought.phases.indexOf("deep_reasoning")).toBeLessThan(
      darusThought.phases.indexOf("thinking"),
    );
    expect(
      gradeRsiSample({ input: "empty", target: "not-applied" }).passed,
    ).toBe(true);
    expect(
      gradeRsiSample({ input: "locked:evaluation_integrity", target: "threw" })
        .passed,
    ).toBe(true);
    expect(
      gradeRsiSample({ input: "production", target: "threw" }).passed,
    ).toBe(true);
  });
});
