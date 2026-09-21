export type Skill = {
  id: string;
  slug: string;
  version: string;
  name?: string;
  category: string;
  description: string;
  instruction?: string;
  priority?: "P0" | "P1";
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

export type SkillSelectionPolicy = {
  maxActiveSkills?: number;
  maxP0Skills?: number;
  maxContextTokens?: number;
  allowHighRisk?: boolean;
};

const alwaysConsider = new Set(["intent-contract", "uncertainty-calibration"]);

function keywordScore(input: string, skill: Skill) {
  const terms = new Set(
    input.toLowerCase().match(/[a-z0-9][a-z0-9_-]{2,}/g) ?? [],
  );
  const haystack =
    `${skill.slug} ${skill.name ?? ""} ${skill.description} ${skill.activation.join(" ")}`
      .toLowerCase()
      .match(/[a-z0-9][a-z0-9_-]{2,}/g) ?? [];
  return haystack.reduce((score, term) => score + (terms.has(term) ? 1 : 0), 0);
}

export function rankSkills(
  input: string,
  skills: Skill[],
  capabilities: string[],
  policy: SkillSelectionPolicy = {},
): RankedSkill[] {
  const maxActive = Math.min(Math.max(policy.maxActiveSkills ?? 8, 1), 8);
  const maxP0 = Math.min(Math.max(policy.maxP0Skills ?? 4, 0), maxActive);
  const maxContext = Math.max(policy.maxContextTokens ?? 4000, 0);
  const candidates = skills
    .filter(
      (skill) =>
        skill.state === "enabled" &&
        (policy.allowHighRisk || skill.risk !== "high") &&
        (skill.capabilities.length === 0 ||
          skill.capabilities.some((capability) =>
            capabilities.includes(capability),
          ) ||
          alwaysConsider.has(skill.slug)),
    )
    .map((skill) => {
      const activationHits = keywordScore(input, skill);
      const capabilityHits = skill.capabilities.filter((capability) =>
        capabilities.includes(capability),
      ).length;
      const riskPenalty =
        skill.risk === "high" ? 1.5 : skill.risk === "medium" ? 0.5 : 0;
      const score =
        activationHits * 0.34 +
        capabilityHits * 2 +
        (skill.priority === "P0" ? 0.7 : 0) +
        (alwaysConsider.has(skill.slug) ? 2 : 0) -
        skill.contextCost / 10000 -
        riskPenalty;
      return {
        skill,
        score,
        reason: `capability=${capabilityHits}; signals=${activationHits}; risk=${skill.risk}`,
      };
    })
    .sort((left, right) => right.score - left.score)
    .slice(0, 20);

  const ranked: RankedSkill[] = [];
  let contextCost = 0;
  let p0Count = 0;
  for (const candidate of candidates) {
    if (ranked.length >= maxActive) break;
    if (candidate.skill.priority === "P0" && p0Count >= maxP0) continue;
    if (contextCost + candidate.skill.contextCost > maxContext) continue;
    ranked.push(candidate);
    contextCost += candidate.skill.contextCost;
    if (candidate.skill.priority === "P0") p0Count += 1;
  }
  return ranked;
}

export function selectSkills(
  input: string,
  skills: Skill[],
  capabilities: string[],
  policy: SkillSelectionPolicy = {},
) {
  return rankSkills(input, skills, capabilities, policy).map(
    (candidate) => candidate.skill,
  );
}
