import type { BaselineDomain } from "../baseline";
import {
  CAPABILITY_LANES,
  laneKey,
  type CapabilityLane,
  type CapabilityLevel,
} from "./lanes";
import type { PulseTaskRegistration, PulseTaskResult } from "./types";

// Registration API for pulse tasks. M35–M44 register additional lane/level
// tasks here; the hourly pulse walks the merged suite in stable order.

type PulseRunner = () => Promise<PulseTaskResult>;

const runners = new Map<string, PulseRunner>();
const registrations = new Map<string, PulseTaskRegistration>();

const BASELINE_DOMAIN_BY_LANE: Partial<
  Record<CapabilityLane, BaselineDomain | BaselineDomain[]>
> = {
  THINKING: "THINKING",
  REASONING: "REASONING",
  CODING: "CODING",
  RESEARCH: "RESEARCH",
  MATH_SCIENCE: "MATH",
  BUILDING_COMPUTER: ["BUILDING", "COMPUTER"],
  MEMORY_CONTEXT: "MEMORY",
};

export function registerPulseTask(
  registration: Omit<PulseTaskRegistration, "registeredAt"> & {
    registeredAt?: string;
  },
  run?: PulseRunner,
) {
  const stored: PulseTaskRegistration = {
    ...registration,
    registeredAt: registration.registeredAt ?? new Date().toISOString(),
  };
  registrations.set(stored.id, stored);
  if (run) runners.set(stored.id, run);
}

export function unregisterPulseTask(id: string) {
  registrations.delete(id);
  runners.delete(id);
}

export function listPulseRegistrations(filter?: {
  lane?: CapabilityLane;
  level?: CapabilityLevel;
}) {
  return [...registrations.values()]
    .filter((entry) => (filter?.lane ? entry.lane === filter.lane : true))
    .filter((entry) => (filter?.level ? entry.level === filter.level : true))
    .sort((a, b) =>
      `${a.lane}:L${a.level}:${a.id}`.localeCompare(
        `${b.lane}:L${b.level}:${b.id}`,
      ),
    );
}

export function resolvePulseRunner(id: string): PulseRunner | null {
  return runners.get(id) ?? null;
}

export function orderedPulseTaskIds(): string[] {
  const ids: string[] = [];
  for (const lane of CAPABILITY_LANES)
    for (const level of [1, 2, 3, 4, 5] as CapabilityLevel[]) {
      const match = [...registrations.values()].find(
        (entry) => entry.lane === lane && entry.level === level,
      );
      if (match) ids.push(match.id);
    }
  return ids;
}

export function registrationFor(id: string) {
  return registrations.get(id) ?? null;
}

export function clearPulseRegistry() {
  registrations.clear();
  runners.clear();
}

export function seedDefaultPulseRegistry() {
  if (registrations.size > 0) return;
  for (const lane of CAPABILITY_LANES) {
    registerPulseTask({
      id: `builtin:${laneKey(lane, 3)}`,
      lane,
      level: 3,
      source: "builtin",
      ref: `lane:${lane}`,
      title: `${lane} L3`,
      objective: `${lane} capability pulse at level 3`,
    });
  }
}

function baselineRunner(
  registration: PulseTaskRegistration,
  record: {
    success: boolean;
    verifiedSuccess: boolean;
    falseCompletion: boolean;
    modelCalls: number;
    toolCalls: number;
    steps: number;
    repairs: number;
    latencyMs: number;
    notes: string;
  },
): PulseRunner {
  return async () => ({
    taskId: registration.id,
    lane: registration.lane,
    level: registration.level,
    success: record.success,
    verifiedSuccess: record.verifiedSuccess,
    falseCompletion: record.falseCompletion,
    modelCalls: record.modelCalls,
    toolCalls: record.toolCalls,
    steps: record.steps,
    repairs: record.repairs,
    latencyMs: record.latencyMs,
    notes: record.notes,
  });
}

export async function ensureBuiltinRunners() {
  const { runCapabilityBaseline } = await import("../baseline");
  const { crossDomainLongHorizonL3, toolMultimodalL3 } =
    await import("./fixtures");

  const baselineByDomain = new Map(
    (await runCapabilityBaseline()).map((record) => [record.domain, record]),
  );

  for (const registration of registrations.values()) {
    if (runners.has(registration.id)) continue;
    if (registration.ref === "fixture:tool-multimodal") {
      runners.set(registration.id, toolMultimodalL3);
      continue;
    }
    if (registration.ref === "fixture:cross-domain") {
      runners.set(registration.id, crossDomainLongHorizonL3);
      continue;
    }
    if (registration.ref === "baseline:COMPUTER") {
      const record = baselineByDomain.get("COMPUTER");
      if (record)
        runners.set(registration.id, baselineRunner(registration, record));
      continue;
    }
    const mapping = BASELINE_DOMAIN_BY_LANE[registration.lane];
    const domain = Array.isArray(mapping) ? mapping[0] : mapping;
    if (!domain) continue;
    const record = baselineByDomain.get(domain);
    if (!record) continue;
    runners.set(registration.id, baselineRunner(registration, record));
  }
}

/** Parse a registration payload from the HTTP API. */
export function parsePulseRegistration(body: {
  id: string;
  lane: string;
  level: number;
  ref: string;
  title?: string;
  objective?: string;
}): PulseTaskRegistration | { error: string } {
  if (!body.id?.trim()) return { error: "id_required" };
  if (!isCapabilityLane(body.lane)) return { error: "invalid_lane" };
  if (!isCapabilityLevel(body.level)) return { error: "invalid_level" };
  if (!body.ref?.trim()) return { error: "ref_required" };
  return {
    id: body.id.trim(),
    lane: body.lane,
    level: body.level,
    source: "registered",
    ref: body.ref.trim(),
    title: body.title?.trim() || `${body.lane} L${body.level}`,
    objective:
      body.objective?.trim() ||
      `Registered pulse task for ${body.lane} at L${body.level}`,
    registeredAt: new Date().toISOString(),
  };
}

function isCapabilityLane(value: string): value is CapabilityLane {
  return (CAPABILITY_LANES as readonly string[]).includes(value);
}

function isCapabilityLevel(value: number): value is CapabilityLevel {
  return value >= 1 && value <= 5 && Number.isInteger(value);
}
