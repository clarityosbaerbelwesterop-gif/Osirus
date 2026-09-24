import { describe, expect, it } from "vitest";
import {
  assessFinishGate,
  finishGateDirective,
  kernelHasFinishGates,
} from "../src/lib/agent/finish-gate";
import { createHypothesis, createTaskState } from "../src/lib/agent/task-state";
import type { AgentStep } from "../src/lib/agent/loop";

function step(action: AgentStep["action"], overrides: Partial<AgentStep> = {}) {
  return {
    index: 0,
    action,
    summary: "s",
    outcome: "ok" as const,
    latencyMs: 1,
    ...overrides,
  };
}

describe("finish gate", () => {
  it("does not gate tasks without hypotheses or success criteria", () => {
    const state = createTaskState({ objective: "What is 2+2?" });
    expect(kernelHasFinishGates(state)).toBe(false);
    expect(
      assessFinishGate(state, "Result: 4", []).allowed,
    ).toBe(true);
  });

  it("requires VERIFY before FINISH when hypotheses are present", () => {
    const state = createTaskState({
      objective: "Fill the tank",
      hypotheses: [{ id: "h-net", statement: "The tank fills in 12 hours." }],
    });
    expect(kernelHasFinishGates(state)).toBe(true);
    const blocked = assessFinishGate(state, "Result: 12 hours.", []);
    expect(blocked.allowed).toBe(false);
    expect(blocked.reason).toMatch(/VERIFY/i);
    const allowed = assessFinishGate(state, "Result: 12 hours.", [
      step("VERIFY"),
    ]);
    expect(allowed.allowed).toBe(true);
  });

  it("blocks FINISH that claims success after a rejected verification", () => {
    const state = createTaskState({
      objective: "Ship the export",
      hypotheses: [
        {
          id: "h-both",
          statement: "Both constraints can be met together.",
          falsifiers: ["finance says the schema is wrong"],
        },
      ],
      task: {
        successCriteria: ["Name the conflict"],
      },
    });
    state.verificationState = {
      status: "rejected",
      lastSummary: "finance says the schema is wrong",
      checks: [{ status: "rejected", summary: "both cannot hold" }],
    };
    state.hypotheses[0] = createHypothesis({
      id: "h-both",
      statement: state.hypotheses[0]!.statement,
      status: "REJECTED",
    });
    const blocked = assessFinishGate(
      state,
      "All constraints are satisfied and the complete export shipped.",
      [step("VERIFY")],
    );
    expect(blocked.allowed).toBe(false);
    expect(blocked.reason).toMatch(/REJECTED|conflict/i);
    const allowed = assessFinishGate(
      state,
      "The export cannot be both complete and schema-frozen; finance says the schema is wrong.",
      [step("VERIFY")],
    );
    expect(allowed.allowed).toBe(true);
  });

  it("blocks Result: 6 when the supported hypothesis says 12", () => {
    const state = createTaskState({
      objective: "Pump and leak",
      hypotheses: [
        {
          id: "h-pump",
          statement: "The tank fills in 6 hours because that is the pump's time.",
        },
        { id: "h-net", statement: "The tank fills in 12 hours at the net rate." },
      ],
    });
    state.hypotheses[0] = createHypothesis({
      id: "h-pump",
      statement: state.hypotheses[0]!.statement,
      status: "REJECTED",
    });
    state.hypotheses[1] = createHypothesis({
      id: "h-net",
      statement: state.hypotheses[1]!.statement,
      status: "SUPPORTED",
      supportingEvidence: ["compute-1"],
    });
    const blocked = assessFinishGate(
      state,
      "Result: 6 hours. The pump figure stands.",
      [step("VERIFY"), step("VERIFY", { index: 1 })],
    );
    expect(blocked.allowed).toBe(false);
    expect(blocked.reason).toMatch(/REJECTED|12/);
  });

  it("blocks picking one year when two supported hypotheses disagree", () => {
    const state = createTaskState({
      objective: "When was the bridge opened?",
      hypotheses: [
        { id: "h-1998", statement: "The bridge opened in 1998." },
        { id: "h-2001", statement: "The bridge opened in 2001." },
      ],
    });
    state.hypotheses[0] = createHypothesis({
      id: "h-1998",
      statement: state.hypotheses[0]!.statement,
      status: "SUPPORTED",
      supportingEvidence: ["archive"],
    });
    state.hypotheses[1] = createHypothesis({
      id: "h-2001",
      statement: state.hypotheses[1]!.statement,
      status: "SUPPORTED",
      supportingEvidence: ["records"],
    });
    const blocked = assessFinishGate(
      state,
      "The bridge opened in 1998. The other source can be ignored.",
      [step("VERIFY"), step("VERIFY", { index: 1 })],
    );
    expect(blocked.allowed).toBe(false);
    expect(blocked.reason).toMatch(/disagree|contradiction/i);
  });

  it("returns a directive when gates are present", () => {
    const state = createTaskState({
      objective: "Reason",
      hypotheses: [{ statement: "A claim." }],
    });
    expect(finishGateDirective(state)).toMatch(/VERIFY/i);
    expect(finishGateDirective(createTaskState({ objective: "Simple" }))).toBe(
      "",
    );
  });
});
