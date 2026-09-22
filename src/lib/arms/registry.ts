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

/** Arms that compete for an objective. Thinking is escalated to, not routed to. */
export function routableArms(): AgentArm[] {
  return allArms().filter((arm) => arm.id !== "thinking");
}

export const ARM_IDS = Object.keys(arms) as ArmId[];
