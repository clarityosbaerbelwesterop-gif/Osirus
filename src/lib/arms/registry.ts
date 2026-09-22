import { BuildingArm } from "./building";
import { CodingArm } from "./coding";
import { GeneralArm } from "./general";
import { MathScienceArm } from "./math-science";
import { ResearchArm } from "./research";
import { ThinkingArm } from "./thinking";
import type { AgentArm, ArmId } from "./types";

const arms: Record<ArmId, AgentArm> = {
  thinking: new ThinkingArm(),
  coding: new CodingArm(),
  research: new ResearchArm(),
  math_science: new MathScienceArm(),
  building: new BuildingArm(),
  general: new GeneralArm(),
};

export function armFor(id: ArmId): AgentArm {
  return arms[id] ?? arms.general;
}

export function allArms(): AgentArm[] {
  return Object.values(arms);
}

/**
 * Arms that compete for an objective.
 *
 * Thinking is among them. It is both a destination and an escalation: an
 * objective that asks for analysis, a comparison or a decision is thinking
 * work in its own right, and excluding it here left an arm that was built and
 * could never be reached. It does not hijack ordinary work -- its confidence
 * comes from analysis wording, so "fix the failing build" still routes to
 * coding.
 */
export function routableArms(): AgentArm[] {
  return allArms();
}

export const ARM_IDS = Object.keys(arms) as ArmId[];
