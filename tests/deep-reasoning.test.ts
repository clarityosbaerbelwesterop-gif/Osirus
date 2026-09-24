import { describe, expect, it } from "vitest";
import {
  buildReasoningProfile,
  chooseReasoningPath,
  reasoningDirectives,
} from "../src/lib/agent/reasoning";

describe("deep reasoning paths", () => {
  it("stays direct when no kernel gates are seeded", () => {
    expect(
      chooseReasoningPath({ objective: "What is the capital of France?" }),
    ).toBe("direct");
    expect(reasoningDirectives("direct")).toEqual([]);
  });

  it("uses standard deliberation for gated tasks with success criteria", () => {
    expect(
      chooseReasoningPath({
        objective: "Ship the export",
        task: {
          successCriteria: ["Name the conflict"],
        },
      }),
    ).toBe("standard");
    expect(reasoningDirectives("standard").join(" ")).toMatch(/VERIFY/i);
  });

  it("uses adversarial deliberation for rival hypotheses", () => {
    expect(
      chooseReasoningPath({
        objective: "Two sources disagree on the opening year.",
        hypotheses: [
          { id: "h-a", statement: "Opened in 1998." },
          { id: "h-b", statement: "Opened in 2001." },
        ],
      }),
    ).toBe("adversarial");
    expect(reasoningDirectives("adversarial").join(" ")).toMatch(
      /rival hypotheses/i,
    );
  });

  it("uses compound deliberation for multi-segment objectives", () => {
    expect(
      chooseReasoningPath({
        objective: "Research the bridge date then compute the toll.",
        hypotheses: [{ statement: "Toll depends on opening year." }],
        compound: true,
      }),
    ).toBe("compound");
    expect(
      buildReasoningProfile({
        objective: "Research the bridge date then compute the toll.",
        hypotheses: [{ statement: "Toll depends on opening year." }],
        compound: true,
      }).phases,
    ).toContain("cross_check_segments");
  });
});
