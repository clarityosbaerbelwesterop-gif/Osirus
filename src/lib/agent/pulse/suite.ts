import {
  ensureBuiltinRunners,
  listPulseRegistrations,
  orderedPulseTaskIds,
  registerPulseTask,
  registrationFor,
  resolvePulseRunner,
  seedDefaultPulseRegistry,
} from "./registry";
import type { PulseTaskResult } from "./types";

const FIXTURE_REFS: Partial<
  Record<
    "TOOL_MULTIMODAL" | "CROSS_DOMAIN_LONG_HORIZON",
    { ref: string; objective: string }
  >
> = {
  TOOL_MULTIMODAL: {
    ref: "fixture:tool-multimodal",
    objective: "Compute 17 * 23 with the compute tool",
  },
  CROSS_DOMAIN_LONG_HORIZON: {
    ref: "fixture:cross-domain",
    objective: "Recall Atlas facts and answer in one finish",
  },
};

export async function preparePulseSuite() {
  seedDefaultPulseRegistry();
  for (const [lane, fixture] of Object.entries(FIXTURE_REFS) as Array<
    [
      "TOOL_MULTIMODAL" | "CROSS_DOMAIN_LONG_HORIZON",
      { ref: string; objective: string },
    ]
  >) {
    const id = `builtin:${lane}:L3`;
    const existing = registrationFor(id);
    if (existing) {
      registerPulseTask({
        ...existing,
        ref: fixture.ref,
        objective: fixture.objective,
      });
    }
  }
  registerPulseTask({
    id: "builtin:BUILDING_COMPUTER:L4",
    lane: "BUILDING_COMPUTER",
    level: 4,
    source: "builtin",
    ref: "baseline:COMPUTER",
    title: "BUILDING_COMPUTER L4 computer",
    objective: "Computer-use pulse from the M30 baseline",
  });
  await ensureBuiltinRunners();
  return orderedPulseTaskIds();
}

export async function runPulseTaskById(
  taskId: string,
): Promise<PulseTaskResult | null> {
  const runner = resolvePulseRunner(taskId);
  if (!runner) return null;
  const registration = registrationFor(taskId);
  const result = await runner();
  return {
    ...result,
    taskId,
    lane: registration?.lane ?? result.lane,
    level: registration?.level ?? result.level,
  };
}

export function pulseSuiteSummary() {
  return listPulseRegistrations();
}
