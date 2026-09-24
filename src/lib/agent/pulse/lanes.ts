import type { ArmId } from "../../arms/types";
import type { Capability } from "../../runtime/types";

// Capability lanes measured by the hourly pulse. Each lane spans L1–L5
// difficulty; tasks register against a lane and level rather than an arm id.

export const CAPABILITY_LANES = [
  "THINKING",
  "REASONING",
  "CODING",
  "RESEARCH",
  "MATH_SCIENCE",
  "BUILDING_COMPUTER",
  "MEMORY_CONTEXT",
  "TOOL_MULTIMODAL",
  "CROSS_DOMAIN_LONG_HORIZON",
] as const;

export type CapabilityLane = (typeof CAPABILITY_LANES)[number];

export const CAPABILITY_LEVELS = [1, 2, 3, 4, 5] as const;
export type CapabilityLevel = (typeof CAPABILITY_LEVELS)[number];

export function isCapabilityLane(value: string): value is CapabilityLane {
  return (CAPABILITY_LANES as readonly string[]).includes(value);
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
      return "BUILDING_COMPUTER";
    case "general":
      return "CROSS_DOMAIN_LONG_HORIZON";
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
      return "TOOL_MULTIMODAL";
    case "computer_use":
      return "BUILDING_COMPUTER";
    case "general":
      return "CROSS_DOMAIN_LONG_HORIZON";
    default:
      return "THINKING";
  }
}

export function laneKey(lane: CapabilityLane, level: CapabilityLevel) {
  return `${lane}:L${level}`;
}
