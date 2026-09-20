export type Skill = {
  id: string;
  slug: string;
  version: string;
  name?: string;
  category: string;
  description: string;
  instruction?: string;
  capabilities: string[];
  activation: string[];
  risk: "low" | "medium" | "high";
  requiredTools: string[];
  contextCost: number;
  state: "enabled" | "disabled" | "deprecated" | "experimental";
};

export type RankedSkill = {
  skill: Skill;
  score: number;
  reason: string;
};

export function rankSkills(
  input: string,
  skills: Skill[],
  capabilities: string[],
  max = 8,
): RankedSkill[] {
  const lowered = input.toLowerCase();
  return skills
    .filter(
      (skill) =>
        skill.state === "enabled" &&
        (skill.capabilities.length === 0 ||
          skill.capabilities.some((capability) =>
            capabilities.includes(capability),
          )),
    )
    .map((skill) => {
      const activationHits = skill.activation.filter((signal) =>
        lowered.includes(signal.toLowerCase()),
      ).length;
      const capabilityHits = skill.capabilities.filter((capability) =>
        capabilities.includes(capability),
      ).length;
      const riskPenalty =
        skill.risk === "high" ? 1.5 : skill.risk === "medium" ? 0.5 : 0;
      const score =
        activationHits * 3 +
        capabilityHits * 2 -
        skill.contextCost / 8000 -
        riskPenalty;
      return {
        skill,
        score,
        reason: `capability=${capabilityHits}; signals=${activationHits}; risk=${skill.risk}`,
      };
    })
    .sort((left, right) => right.score - left.score)
    .slice(0, Math.min(Math.max(max, 0), 8));
}

export function selectSkills(
  input: string,
  skills: Skill[],
  capabilities: string[],
  max = 8,
) {
  return rankSkills(input, skills, capabilities, max).map(
    (candidate) => candidate.skill,
  );
}
