import { describe, expect, it } from "vitest";
import { rankSkills, type Skill } from "../src/lib/skills";
import { allArms } from "../src/lib/arms/registry";

function skill(overrides: Partial<Skill> & { id: string }): Skill {
  return {
    slug: overrides.id,
    version: "1.0.0",
    category: "general",
    description: "A skill.",
    capabilities: ["coding"],
    activation: [],
    risk: "low",
    requiredTools: [],
    contextCost: 100,
    state: "enabled",
    ...overrides,
  };
}

const objective = "Refactor the claim function and keep the tests passing";

describe("skill ranking", () => {
  it("breaks a tie towards the arm's own categories", () => {
    const skills = [
      skill({ id: "a", category: "engineering" }),
      skill({ id: "b", category: "marketing" }),
    ];
    const [top] = rankSkills(objective, skills, ["coding"], {
      armAffinity: ["engineering"],
    });
    expect(top?.skill.id).toBe("a");
    expect(top?.reason).toContain("affinity=yes");
  });

  it("does not exclude a skill outside the arm's categories", () => {
    // Affinity is a tie-breaker. A skill that matches the objective strongly
    // still has to be able to win from outside the arm's usual ground.
    const skills = [
      skill({ id: "a", category: "engineering" }),
      skill({
        id: "b",
        category: "marketing",
        activation: ["refactor", "claim", "function", "tests", "passing"],
      }),
    ];
    const ranked = rankSkills(objective, skills, ["coding"], {
      armAffinity: ["engineering"],
    });
    expect(ranked[0]?.skill.id).toBe("b");
    expect(ranked).toHaveLength(2);
  });

  it("weights a skill that has been verified before, within bounds", () => {
    const skills = [skill({ id: "a" }), skill({ id: "b" })];
    const [top] = rankSkills(objective, skills, ["coding"], {
      outcomeWeights: { b: 1 },
    });
    expect(top?.skill.id).toBe("b");

    // History nudges, it does not take over: a strong objective match still
    // outranks a perfect record on an unrelated skill.
    const [stillTop] = rankSkills(
      objective,
      [
        skill({ id: "a", activation: ["refactor", "claim", "tests"] }),
        skill({ id: "b" }),
      ],
      ["coding"],
      { outcomeWeights: { b: 1 } },
    );
    expect(stillTop?.skill.id).toBe("a");
  });

  it("ignores an out-of-range history weight rather than trusting it", () => {
    const skills = [skill({ id: "a" }), skill({ id: "b" })];
    const ranked = rankSkills(objective, skills, ["coding"], {
      outcomeWeights: { b: 99, a: -99 },
    });
    // Clamped to [0, 1], so the gap is 0.5 at most and nothing is unbounded.
    expect(ranked[0]!.score - ranked[1]!.score).toBeCloseTo(0.5, 6);
  });

  it("still caps the selection at eight skills", () => {
    const skills = Array.from({ length: 30 }, (_, index) =>
      skill({ id: `s${index}`, contextCost: 10 }),
    );
    expect(
      rankSkills(objective, skills, ["coding"], { armAffinity: ["general"] }),
    ).toHaveLength(8);
  });
});

describe("arm skill affinity", () => {
  it("declares categories for every specialised arm", () => {
    for (const arm of allArms()) {
      const affinity = (
        arm as unknown as { skillAffinity(): string[] }
      ).skillAffinity();
      if (arm.id === "general") {
        expect(affinity).toEqual([]);
        continue;
      }
      expect(affinity.length, arm.id).toBeGreaterThan(0);
    }
  });
});
