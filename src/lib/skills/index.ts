export type Skill = {
  id: string;
  slug: string;
  version: string;
  category: string;
  description: string;
  capabilities: string[];
  activation: string[];
  risk: "low" | "medium" | "high";
  requiredTools: string[];
  contextCost: number;
  state: "enabled" | "disabled" | "deprecated" | "experimental";
};
export function selectSkills(
  input: string,
  skills: Skill[],
  capabilities: string[],
  max = 8,
) {
  return skills
    .filter(
      (s) =>
        s.state === "enabled" &&
        s.capabilities.some((c) => capabilities.includes(c)),
    )
    .map((s) => ({
      s,
      score:
        s.activation.reduce(
          (n, a) => n + (input.toLowerCase().includes(a.toLowerCase()) ? 2 : 0),
          0,
        ) -
        s.contextCost / 10000,
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.min(max, 8))
    .map((x) => x.s);
}
