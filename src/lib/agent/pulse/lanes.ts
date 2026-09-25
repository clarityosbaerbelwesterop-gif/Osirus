import type { ArmId } from "../../arms/types";
import type { Capability } from "../../runtime/types";

// Capability families measured by the pulse. Each family spans L1–L5
// difficulty; a task belongs to one family, one level and one difficulty
// class. The M34 lanes that merged two families are still accepted as
// aliases, so older baselines and API callers keep working.

export const CAPABILITY_LANES = [
  "THINKING",
  "REASONING",
  "CODING",
  "RESEARCH",
  "MATH_SCIENCE",
  "BUILDING",
  "COMPUTER",
  "TOOL_USE",
  "MULTIMODAL",
  "MEMORY_CONTEXT",
  "CROSS_DOMAIN",
  "LONG_HORIZON",
  // M44–M47: Osirus measuring its own improvement machinery.
  "SELF_PLAY",
  "SOFTWARE_RSI",
] as const;

export type CapabilityLane = (typeof CAPABILITY_LANES)[number];

export const CAPABILITY_LEVELS = [1, 2, 3, 4, 5] as const;
export type CapabilityLevel = (typeof CAPABILITY_LEVELS)[number];

/** How a task is hard, independent of how hard it is. */
export const DIFFICULTY_CLASSES = [
  "DIRECT",
  "COMPOSED",
  "ADVERSARIAL",
  "LONG_HORIZON",
  "FRONTIER",
] as const;
export type DifficultyClass = (typeof DIFFICULTY_CLASSES)[number];

const LEGACY_LANES: Record<string, CapabilityLane> = {
  BUILDING_COMPUTER: "BUILDING",
  TOOL_MULTIMODAL: "TOOL_USE",
  CROSS_DOMAIN_LONG_HORIZON: "CROSS_DOMAIN",
};

export function isCapabilityLane(value: string): value is CapabilityLane {
  return (CAPABILITY_LANES as readonly string[]).includes(value);
}

/** A family name, or an M34 lane alias, as a family; null otherwise. */
export function normalizeLane(value: string): CapabilityLane | null {
  if (isCapabilityLane(value)) return value;
  return LEGACY_LANES[value] ?? null;
}

export function isCapabilityLevel(value: number): value is CapabilityLevel {
  return CAPABILITY_LEVELS.includes(value as CapabilityLevel);
}

export function laneForArm(armId: ArmId): CapabilityLane {
  switch (armId) {
    case "thinking":
      return "THINKING";
    case "coding":
      return "CODING";
    case "research":
      return "RESEARCH";
    case "math_science":
      return "MATH_SCIENCE";
    case "building":
      return "BUILDING";
    case "general":
      return "REASONING";
    default:
      return "THINKING";
  }
}

export function laneForCapability(capability: Capability): CapabilityLane {
  switch (capability) {
    case "coding":
      return "CODING";
    case "research":
      return "RESEARCH";
    case "math_science":
    case "data":
      return "MATH_SCIENCE";
    case "multimodal":
      return "MULTIMODAL";
    case "computer_use":
      return "COMPUTER";
    case "general":
      return "REASONING";
    default:
      return "THINKING";
  }
}

export function laneKey(lane: CapabilityLane, level: CapabilityLevel) {
  return `${lane}:L${level}`;
}
