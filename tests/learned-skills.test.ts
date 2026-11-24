import { describe, expect, it } from "vitest";
import { learnedSkill, memoryCandidates } from "../src/lib/memory/compiler-v2";

// The learning loop: a finished agent task becomes a skill the next similar
// task starts from, built from the steps the run really took.

const step = (toolId: string, summary: string, outcome = "ok") => ({
  action: "USE_TOOL",
  toolId,
  summary,
  outcome,
});

const outcome = (
  agentSteps: unknown[],
  answer = "Fertig.",
  verdicts: string[] = [],
) => ({
  runId: "run-1",
  armId: "agent",
  objective:
    "Recherchiere die Preise von drei Cloud-Anbietern https://x.y und fasse sie zusammen",
  answer,
  verdicts,
  state: { agentSteps },
});

describe("a skill learned from a finished task", () => {
  it("keeps the real tool steps, in order, as a procedure", () => {
    const skill = learnedSkill(
      outcome([
        step("web.search", "Nach aktuellen Preisseiten gesucht"),
        { action: "THINK", summary: "Überlegt" },
        step("web.read", "Drei Preisseiten gelesen"),
        step("web.read", "Fehlgeschlagen", "error"),
        step("artifact.create", "Tabelle erstellt"),
      ]),
    );
    expect(skill?.procedure).toBe("web.search > web.read > artifact.create");
    expect(skill?.subjectKey).toMatch(/^skill:[0-9a-f]{24}$/);
    expect(skill?.content).toContain(
      "1. Nach aktuellen Preisseiten gesucht [web.search]",
    );
    expect(skill?.content).toContain("3. Tabelle erstellt [artifact.create]");
    expect(skill?.content).not.toContain("Fehlgeschlagen");
  });

  it("learns nothing from small talk, a single step or an empty answer", () => {
    expect(learnedSkill(outcome([]))).toBeNull();
    expect(learnedSkill(outcome([step("web.search", "Gesucht")]))).toBeNull();
    expect(
      learnedSkill(
        outcome([step("web.search", "a"), step("web.read", "b")], "  "),
      ),
    ).toBeNull();
  });

  it("is the same subject when the same procedure solves a similar task", () => {
    const a = learnedSkill(
      outcome([step("web.search", "a"), step("web.read", "b")]),
    );
    const b = learnedSkill(
      outcome([step("web.search", "anders formuliert"), step("web.read", "c")]),
    );
    expect(a?.subjectKey).toBe(b?.subjectKey);
  });

  it("is remembered from an unverified but finished task", () => {
    const candidates = memoryCandidates(
      outcome([step("web.search", "a"), step("web.read", "b")]),
    );
    const skill = candidates.find(
      (candidate) => candidate.source.memory === "experience.skill",
    );
    expect(skill).toMatchObject({
      kind: "pattern",
      requireVerified: false,
      confidence: 0.65,
    });
    // The run summary still needs a verified run.
    expect(candidates[0]).toMatchObject({
      kind: "run_summary",
      requireVerified: true,
    });
  });
});
