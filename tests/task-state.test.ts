import { describe, expect, it } from "vitest";
import {
  applyHypothesisEvidence,
  createHypothesis,
  createTaskState,
  hydrateTaskState,
  type TaskHypothesis,
} from "../src/lib/agent/task-state";

function hyp(
  partial: Partial<TaskHypothesis> & { id: string; statement: string },
): TaskHypothesis {
  return createHypothesis({
    confidence: 0.45,
    ...partial,
  });
}

describe("task state", () => {
  it("hydrates a pre-TaskState kernel without inventing support", () => {
    const state = hydrateTaskState(
      {
        goal: "Find the capital",
        hypotheses: [
          {
            id: "h1",
            statement: "The capital is a city.",
            status: "open",
            evidenceRefs: ["doc-1"],
          },
          {
            id: "h2",
            statement: "The lookup failed.",
            status: "contradicted",
            evidenceRefs: ["doc-1"],
          },
        ],
        evidenceRefs: ["doc-1"],
        autoReplans: 1,
        replannedAtStep: 4,
      },
      "unused fallback",
    );
    expect(state.objective).toBe("Find the capital");
    expect(state.goal).toBe("Find the capital");
    expect(state.hypotheses[0]).toMatchObject({
      status: "OPEN",
      supportingEvidence: [],
      counterEvidence: [],
    });
    expect(state.hypotheses[1]).toMatchObject({
      status: "WEAKENED",
      counterEvidence: ["doc-1"],
    });
    expect(state.evidenceRefs).toEqual(["doc-1"]);
    expect(state.evidence[0]?.ref).toBe("doc-1");
    expect(state.autoReplans).toBe(1);
    expect(state.replannedAtStep).toBe(4);
    expect(state.plan).toEqual([]);
    expect(state.verificationState.status).toBe("unverified");
    expect(JSON.stringify(state)).not.toContain("chainOfThought");
  });

  it("does not let one verified result support every open hypothesis", () => {
    const hypotheses = [
      hyp({ id: "h-city", statement: "The capital is a city." }),
      hyp({ id: "h-river", statement: "The city sits on a river." }),
    ];
    applyHypothesisEvidence(hypotheses, {
      verdictStatus: "verified",
      summary: "matches doc-1",
      refs: ["doc-1"],
    });
    expect(hypotheses.map((item) => item.status)).toEqual(["OPEN", "OPEN"]);
  });

  it("supports, weakens, rejects, and confirms only the matched hypothesis", () => {
    const hypotheses = [
      hyp({
        id: "h-1998",
        statement: "The bridge opened in 1998.",
        falsifiers: ["archive records a different opening year"],
      }),
      hyp({ id: "h-2001", statement: "The bridge opened in 2001." }),
    ];
    applyHypothesisEvidence(hypotheses, {
      hypothesisIds: ["h-1998"],
      relation: "supports",
      verdictStatus: "verified",
      summary: "City archive excerpt: opened 1998.",
      refs: ["archive-1998"],
    });
    expect(hypotheses[0]?.status).toBe("SUPPORTED");
    expect(hypotheses[1]?.status).toBe("OPEN");

    applyHypothesisEvidence(hypotheses, {
      hypothesisIds: ["h-1998", "h-2001"],
      relation: "supports",
      verdictStatus: "verified",
      summary:
        "A later correction says the archive records a different opening year.",
      refs: ["correction"],
    });
    expect(hypotheses[0]?.status).toBe("REJECTED");
    expect(hypotheses[1]?.status).toBe("SUPPORTED");

    const paid = hyp({ id: "h-paid", statement: "The amount paid is 74.8." });
    applyHypothesisEvidence([paid], {
      hypothesisIds: ["h-paid"],
      relation: "supports",
      verdictStatus: "verified",
      summary: "first computation",
      refs: ["compute-1"],
    });
    expect(paid.status).toBe("SUPPORTED");
    applyHypothesisEvidence([paid], {
      hypothesisIds: ["h-paid"],
      relation: "supports",
      verdictStatus: "verified",
      summary: "second computation",
      refs: ["compute-2"],
    });
    expect(paid.status).toBe("CONFIRMED");
    expect(paid.confidence).toBeGreaterThanOrEqual(0.85);
  });

  it("weakens on a targeted contradiction and leaves the sibling open", () => {
    const hypotheses = [
      hyp({ id: "h-net", statement: "Net fill time is 12 hours." }),
      hyp({ id: "h-pump", statement: "Fill time is the pump's 6 hours." }),
    ];
    applyHypothesisEvidence(hypotheses, {
      hypothesisIds: ["h-pump"],
      relation: "contradicts",
      verdictStatus: "rejected",
      summary: "The leak changes the net rate.",
      refs: ["rate"],
    });
    expect(hypotheses[0]?.status).toBe("OPEN");
    expect(hypotheses[1]?.status).toBe("WEAKENED");
    expect(hypotheses[1]?.confidence).toBeLessThan(0.45);
  });

  it("seeds structured fields and ignores nothing that was asked for", () => {
    const state = createTaskState({
      objective: "Ship the export",
      hypotheses: [
        {
          statement: "Schema v3 can stay.",
          falsifiers: ["finance requires a new column"],
        },
      ],
      task: {
        constraints: ["Do not change the schema"],
        successCriteria: ["Finance can reconcile the file"],
        unknowns: ["Whether the column already exists"],
        plan: [{ id: "export", title: "Write the export", status: "pending" }],
      },
    });
    expect(state.constraints).toEqual(["Do not change the schema"]);
    expect(state.plan[0]?.status).toBe("pending");
    expect(state.hypotheses[0]?.falsifiers).toEqual([
      "finance requires a new column",
    ]);
    expect(state.hypotheses[0]?.status).toBe("OPEN");
  });
});
