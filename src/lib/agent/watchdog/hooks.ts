import type { LoopHooks, LoopResult } from "../loop";
import type { CapabilityLane, CapabilityLevel } from "../pulse/lanes";
import { gradeLoopOutcome } from "./rsi";

// The watchdog's place in an arm's loop. It observes; it concludes nothing
// from a single run. The outcome it derives is returned for the stage to
// record; regressions are decided over windows when a pulse cycle ends.

export function withRsiWatchdogHooks(input: {
  lane: CapabilityLane;
  level?: CapabilityLevel;
  runId: string;
  hooks?: LoopHooks;
}): LoopHooks {
  return input.hooks ?? {};
}

export async function afterAgentLoop(input: {
  lane: CapabilityLane;
  level?: CapabilityLevel;
  result: LoopResult;
  runId: string;
}) {
  return { lane: input.lane, ...gradeLoopOutcome(input.result) };
}
