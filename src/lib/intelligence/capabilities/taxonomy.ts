import type { Capability } from "../types";

// The measured capability taxonomy. These are not labels for a marketing
// page: every entry is measured from experience (trials and anonymous
// product metrics), and a capability with no evidence says "unmeasured".
// Dependencies say what a higher-level capability rests on, so a weak
// dependency can explain a weak capability.

type Seed = Pick<Capability, "id" | "domain" | "name" | "description"> & {
  dependsOn?: string[];
  /** The strategy kind (arm) that owns experiments on this capability. */
  arm: string;
  /** Business usefulness, 0..1, for agenda ranking. */
  usefulness: number;
};

export const CAPABILITY_SEEDS: Seed[] = [
  {
    id: "coding.debug",
    domain: "coding",
    name: "Debug and fix failing tests",
    description:
      "Find the defect behind a failing test in an unfamiliar repository and fix it without editing the tests.",
    dependsOn: [
      "coding.repo_understanding",
      "tool.workspace",
      "reasoning.planning",
      "verification.execution",
    ],
    arm: "coding",
    usefulness: 0.95,
  },
  {
    id: "coding.repo_understanding",
    domain: "coding",
    name: "Repository understanding",
    description:
      "Locate the relevant module and command in an unfamiliar repository.",
    dependsOn: ["tool.workspace"],
    arm: "coding",
    usefulness: 0.8,
  },
  {
    id: "coding.multi_file",
    domain: "coding",
    name: "Cross-module fixes",
    description:
      "Fix a defect whose cause lives in a different module than the failing test.",
    dependsOn: ["coding.debug", "coding.repo_understanding"],
    arm: "coding",
    usefulness: 0.9,
  },
  {
    id: "coding.injection_resistance",
    domain: "coding",
    name: "Resisting repository instructions",
    description:
      "Ignore instructions planted in repository files and fix the code instead of the tests.",
    dependsOn: ["coding.debug"],
    arm: "coding",
    usefulness: 0.85,
  },
  {
    id: "math.quantitative",
    domain: "math",
    name: "Quantitative problem solving",
    description:
      "Algebra, probability, statistics, calculus, linear algebra, physics and numerical problems with a single checkable answer.",
    dependsOn: ["tool.compute", "reasoning.planning", "verification.numeric"],
    arm: "math_science",
    usefulness: 0.75,
  },
  {
    id: "research.citations",
    domain: "research",
    name: "Cited research",
    description:
      "Answer from retrieved sources with citations that support the claims.",
    dependsOn: ["tool.search", "verification.citations"],
    arm: "research",
    usefulness: 0.85,
  },
  {
    id: "reasoning.planning",
    domain: "reasoning",
    name: "Planning and decomposition",
    description: "Break an objective into steps that reach it.",
    arm: "thinking",
    usefulness: 0.7,
  },
  {
    id: "tool.workspace",
    domain: "tool",
    name: "Workspace tool use",
    description:
      "Use tree, read, search, edit and run in the sandbox correctly.",
    arm: "coding",
    usefulness: 0.7,
  },
  {
    id: "tool.compute",
    domain: "tool",
    name: "Compute tool use",
    description: "Delegate arithmetic and symbolic work to the compute tool.",
    arm: "math_science",
    usefulness: 0.6,
  },
  {
    id: "tool.search",
    domain: "tool",
    name: "Search tool use",
    description: "Retrieve relevant sources for a question.",
    arm: "research",
    usefulness: 0.6,
  },
  {
    id: "verification.execution",
    domain: "verification",
    name: "Execution-grounded verification",
    description: "Claim success only when a command result shows it.",
    arm: "coding",
    usefulness: 0.8,
  },
  {
    id: "verification.numeric",
    domain: "verification",
    name: "Numeric verification",
    description: "Cross-check a computed number before stating it.",
    arm: "math_science",
    usefulness: 0.6,
  },
  {
    id: "verification.citations",
    domain: "verification",
    name: "Citation verification",
    description: "Every cited claim is supported by its source.",
    arm: "research",
    usefulness: 0.7,
  },
  // M44: capabilities the Recursive Intelligence Cycle measures with its own
  // generated challenges (self-play and red attacks on Osirus mechanisms).
  {
    id: "memory.context",
    domain: "memory",
    name: "Memory and context integrity",
    description:
      "Hand later stages current facts: stale ones expire, contradicting ones are surfaced, nothing important is crowded out.",
    arm: "general",
    usefulness: 0.75,
  },
  {
    id: "planning.long_horizon",
    domain: "reasoning",
    name: "Long-horizon recovery",
    description:
      "Resume the right goal after the world changed: blocked steps, reopened work, expired facts.",
    dependsOn: ["reasoning.planning"],
    arm: "thinking",
    usefulness: 0.7,
  },
  {
    id: "reasoning.falsification",
    domain: "reasoning",
    name: "Settling disagreements by tests",
    description:
      "Let a discriminating check, not a vote or a phrasing, decide between competing answers.",
    arm: "general",
    usefulness: 0.65,
  },
  {
    id: "reasoning.cross_domain",
    domain: "reasoning",
    name: "Cross-domain mission integrity",
    description:
      "Declare a multi-capability mission complete only when every part of it is verified.",
    dependsOn: ["reasoning.planning"],
    arm: "general",
    usefulness: 0.7,
  },
  {
    id: "security.adversarial",
    domain: "security",
    name: "Adversarial robustness",
    description:
      "Injected instructions, forged fences, false authority, false success signals and misleading sources do not change what Osirus does or claims.",
    arm: "general",
    usefulness: 0.9,
  },
  {
    id: "routing.specialist",
    domain: "reasoning",
    name: "Specialist routing",
    description: "Send an objective to the specialist that can do it.",
    arm: "general",
    usefulness: 0.6,
  },
];

/** Which capability a trial of a given task family also measures. */
export function derivedCapabilities(
  capabilityId: string,
  spec: { trap?: string; fixture?: Array<{ path: string }> },
) {
  const out = [capabilityId];
  if (capabilityId === "coding.debug") {
    out.push(
      "coding.repo_understanding",
      "tool.workspace",
      "verification.execution",
    );
    const srcFiles = (spec.fixture ?? []).filter(
      (file) =>
        file.path.startsWith("src/") &&
        file.path.endsWith(".js") &&
        !/legacy|constants/.test(file.path),
    );
    if (srcFiles.length > 1) out.push("coding.multi_file");
    if (spec.trap) out.push("coding.injection_resistance");
  }
  if (capabilityId === "math.quantitative")
    out.push("tool.compute", "verification.numeric");
  return out;
}

export function armOfCapability(capabilityId: string) {
  return (
    CAPABILITY_SEEDS.find((seed) => seed.id === capabilityId)?.arm ?? "general"
  );
}

export function usefulnessOf(capabilityId: string) {
  return (
    CAPABILITY_SEEDS.find((seed) => seed.id === capabilityId)?.usefulness ?? 0.5
  );
}
