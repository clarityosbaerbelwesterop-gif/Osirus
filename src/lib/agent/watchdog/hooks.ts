import type { LoopHooks, LoopResult } from "../loop";
import type { CapabilityLane, CapabilityLevel } from "../pulse/lanes";
import { finalizeRsiWatchdog, trackLoopStep } from "./rsi";

// Merge RSI watchdog hooks into an arm's existing loop hooks.

export function withRsiWatchdogHooks(input: {
  lane: CapabilityLane;
  level?: CapabilityLevel;
  runId: string;
  hooks?: LoopHooks;
}): LoopHooks {
  const prior = input.hooks ?? {};
  return {
    ...prior,
    onStep: async (step) => {
      await prior.onStep?.(step);
      trackLoopStep({ steps: [step] } as never);
    },
  };
}

export async function afterAgentLoop(input: {
  lane: CapabilityLane;
  level?: CapabilityLevel;
  result: LoopResult;
  runId: string;
}) {
  return finalizeRsiWatchdog(input);
}
