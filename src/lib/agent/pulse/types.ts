import type { CapabilityLane, CapabilityLevel } from "./lanes";

export type PulseTaskSource = "builtin" | "registered";

/** A descriptor stored by the registration API; built-ins resolve to runners. */
export type PulseTaskRegistration = {
  id: string;
  lane: CapabilityLane;
  level: CapabilityLevel;
  source: PulseTaskSource;
  /** Built-in ref, e.g. `baseline:THINKING` or `fixture:tool-multimodal`. */
  ref: string;
  title: string;
  objective: string;
  registeredAt: string;
};

export type PulseTaskResult = {
  taskId: string;
  lane: CapabilityLane;
  level: CapabilityLevel;
  success: boolean;
  verifiedSuccess: boolean;
  falseCompletion: boolean;
  modelCalls: number;
  toolCalls: number;
  steps: number;
  repairs: number;
  latencyMs: number;
  notes: string;
};

export type PulseCycleState = {
  cycleId: string;
  startedAt: string;
  completedAt: string | null;
  cursor: number;
  taskIds: string[];
  results: PulseTaskResult[];
};

export type PulseTickReport = {
  ran: boolean;
  reason: string | null;
  cycleId: string | null;
  tasksRun: number;
  completedCycle: boolean;
  continueChain: boolean;
};

export type PulseBaselineCell = {
  lane: CapabilityLane;
  level: CapabilityLevel;
  verifiedSuccessRate: number;
  sampleCount: number;
  lastObservedAt: string;
};
