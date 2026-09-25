import type { Handoff } from "../agent/handoff";
import {
  MAX_SWITCHES,
  reconcileMission,
  recordHandoff,
  recordSwitch,
  seedForStage,
  type MissionState,
  type StageSeed,
} from "../agent/mission";
import type { TaskState } from "../agent/task-state";
import {
  PgMissionStore,
  updateMission,
  type MissionStore,
} from "../runtime/missions";
import type { Capability } from "../runtime/types";
import { armFor, ARM_IDS } from "./registry";
import type {
  AppendedNode,
  ArmId,
  ArmStageContext,
  GraphAppender,
} from "./types";

// How an arm's stage takes part in its mission: seeded from the mission when
// it starts, folded back into it when its loop ends and when it is verified,
// and able to add a capability the mission turns out to need.

export function missionStoreOf(context: ArmStageContext): MissionStore {
  return (
    context.runtime.stores?.missions?.() ??
    new PgMissionStore(context.identity.userId)
  );
}

function graphOf(context: ArmStageContext): GraphAppender {
  const provided = context.runtime.stores?.graph?.();
  if (provided) return provided;
  return {
    append: async (input) => {
      const { appendStages } = await import("../runtime/dispatch");
      return appendStages(input);
    },
  };
}

/** The mission node a stage belongs to: its segment and arm. */
export function segmentKey(stageInput: Record<string, unknown>) {
  const segment =
    typeof stageInput.segment === "number" ? stageInput.segment : 0;
  const armId =
    typeof stageInput.armId === "string" ? stageInput.armId : "general";
  return `s${segment}-${armId}`;
}

/** What this stage starts from, or null when the run has no mission. */
export async function seedFromMission(
  context: ArmStageContext,
  armId: ArmId,
): Promise<(StageSeed & { mission: MissionState }) | null> {
  const stored = await missionStoreOf(context)
    .load(context.work.runId)
    .catch(() => null);
  if (!stored) return null;
  return { ...seedForStage(stored.state, armId), mission: stored.state };
}

/** Fold the loop's working state into the mission, and count the handoff. */
export async function reconcileLoop(
  context: ArmStageContext,
  armId: ArmId,
  kernel: TaskState | undefined,
  seeded: StageSeed | null,
) {
  if (!kernel) return;
  const stageKey = segmentKey(context.work.stageInput);
  const received = seeded
    ? (seeded.task.knownFacts?.filter((fact) =>
        kernel.knownFacts.some((known) => known === fact),
      ).length ?? 0)
    : 0;
  await updateMission(missionStoreOf(context), context.work.runId, (state) =>
    recordHandoff(
      reconcileMission(state, { stageKey, capability: armId, kernel }),
      seeded?.seededFactIds.length ?? 0,
      received,
    ),
  ).catch(() => null);
}

/** Record the stage's verdict and typed handoff on its mission node. */
export async function reconcileVerdict(
  context: ArmStageContext,
  armId: ArmId,
  verdict: "verified" | "unverified" | "rejected" | "conflicted",
  handoff: Handoff | null,
) {
  await updateMission(missionStoreOf(context), context.work.runId, (state) =>
    reconcileMission(state, {
      stageKey: segmentKey(context.work.stageInput),
      capability: armId,
      verdict,
      handoff,
    }),
  ).catch(() => null);
}

function capabilityOfArm(armId: ArmId): Capability {
  return armId === "math_science"
    ? "math_science"
    : armId === "general"
      ? "general"
      : (armId as Capability);
}

export type CapabilityRequest = {
  capability: string;
  objective: string;
  reason: string;
  evidence: string[];
};

/**
 * Add a capability the running mission needs: that arm's segment, then a
 * continuation of this arm, and everything that waited on this stage now
 * waits on the continuation. The plan revision says why and on what
 * evidence. Bounded per mission.
 */
export async function requestCapability(
  context: ArmStageContext,
  from: ArmId,
  request: CapabilityRequest,
): Promise<{ summary: string; output: string }> {
  const target = (ARM_IDS as readonly string[]).includes(request.capability)
    ? (request.capability as ArmId)
    : null;
  if (!target)
    return {
      summary: "Unknown capability",
      output: `No capability "${request.capability}". Available: ${ARM_IDS.join(", ")}.`,
    };
  if (target === from)
    return {
      summary: "Same capability",
      output: "This stage already has that capability; continue here.",
    };
  const store = missionStoreOf(context);
  const stored = await store.load(context.work.runId).catch(() => null);
  if (!stored)
    return {
      summary: "No mission",
      output:
        "This run has no mission state; continue with the tools you have.",
    };
  if (stored.state.switches.length >= MAX_SWITCHES)
    return {
      summary: "Switch budget spent",
      output: `This mission already added ${MAX_SWITCHES} capabilities. Finish with what the evidence supports and name what is missing.`,
    };

  const next = Math.max(
    stored.state.nodes.length,
    ...stored.state.nodes.map(
      (node) => Number(/^s(\d+)-/.exec(node.key)?.[1] ?? 0) + 1,
    ),
  );
  const insertedKey = `s${next}-${target}`;
  const continuationKey = `s${next + 1}-${from}`;
  const segment = armFor(target).buildWorkflow({
    objective: request.objective,
    capabilities: [],
  });
  const nodes: AppendedNode[] = segment.nodes.map((node) => ({
    key: `${insertedKey}-${node.key}`,
    name: `${node.name} (${target})`,
    capability: node.capability,
    input: {
      ...node.input,
      armId: target,
      segment: next,
      composed: true,
      subObjective: request.objective.slice(0, 2_000),
      inserted: { from, reason: request.reason.slice(0, 300) },
    },
    dependsOn: node.dependsOn.map(
      (dependency) => `${insertedKey}-${dependency}`,
    ),
    retryPolicy: node.retryPolicy,
    requiresVerification: node.requiresVerification,
  }));
  const tail = segment.nodes
    .map((node) => `${insertedKey}-${node.key}`)
    .filter(
      (key) =>
        !segment.nodes.some((node) =>
          node.dependsOn.some(
            (dependency) => `${insertedKey}-${dependency}` === key,
          ),
        ),
    );
  const continuation: AppendedNode[] = [
    {
      key: `${continuationKey}-answer`,
      name: `Continue the mission (${from})`,
      capability: capabilityOfArm(from),
      input: {
        stageKind: "answer",
        armId: from,
        segment: next + 1,
        composed: true,
        continuation: true,
      },
      dependsOn: tail,
      retryPolicy: { maxAttempts: 2, maxSlices: 8 },
      requiresVerification: true,
    },
    {
      key: `${continuationKey}-verify`,
      name: `Verify the continued result (${from})`,
      capability: capabilityOfArm(from),
      input: {
        stageKind: "verify",
        armId: from,
        segment: next + 1,
        composed: true,
      },
      dependsOn: [`${continuationKey}-answer`],
      requiresVerification: true,
    },
  ];
  await graphOf(context).append({
    runId: context.work.runId,
    afterStageId: context.work.stageId,
    nodes: [...nodes, ...continuation],
    tailKey: `${continuationKey}-verify`,
  });
  await updateMission(store, context.work.runId, (state) =>
    recordSwitch(
      state,
      {
        from: {
          capability: from,
          stageKey: segmentKey(context.work.stageInput),
        },
        to: target,
        reason: request.reason,
        evidence: request.evidence,
        addedNodes: [insertedKey, continuationKey],
      },
      [
        { key: insertedKey, capability: target, objective: request.objective },
        {
          key: continuationKey,
          capability: from,
          objective:
            "Continue the mission with what the added capability established.",
        },
      ],
    ),
  );
  await context.runtime.activity(
    "mission.capability_added",
    `${from} added ${target}: ${request.reason.slice(0, 160)}`,
    { from, to: target, evidence: request.evidence.slice(0, 4) },
    "user",
  );
  return {
    summary: `Added ${target} to the mission`,
    output: `A ${target} segment now runs after this stage, then a ${from} continuation with its results. FINISH this stage now with what you have established and name what the ${target} segment must settle.`,
  };
}

export type StageVerdictRow = {
  ordinal: number;
  verdict: string | null;
  armId: string;
  segment: number;
  kind: string;
};

/** The latest verdict per mission node, and of the latest contract check. */
export function gateVerdicts(rows: StageVerdictRow[]) {
  const latest = new Map<
    string,
    {
      key: string;
      capability: string;
      verdict: string | null;
      meta?: boolean;
      ordinal: number;
    }
  >();
  for (const row of [...rows].sort((a, b) => a.ordinal - b.ordinal)) {
    if (row.kind === "meta_verify") {
      latest.set("meta", {
        key: `meta-${row.segment}`,
        capability: row.armId,
        verdict: row.verdict,
        meta: true,
        ordinal: row.ordinal,
      });
      continue;
    }
    if (row.kind !== "verify") continue;
    const key = `s${row.segment}-${row.armId}`;
    latest.set(key, {
      key,
      capability: row.armId,
      verdict: row.verdict,
      ordinal: row.ordinal,
    });
  }
  return [...latest.values()].map(({ ordinal: _ordinal, ...entry }) => entry);
}

/**
 * The contract check found the mission incomplete. Re-run the capability
 * that fell short once -- answer and verify -- and check the contract again
 * afterwards. Bounded by MAX_REPAIRS per mission.
 */
export async function requestRepair(
  context: ArmStageContext,
  gate: import("../agent/mission").MissionGate,
  failing: { key: string; capability: string } | null,
): Promise<boolean> {
  const { MAX_REPAIRS } = await import("../agent/mission");
  if (!failing || !(ARM_IDS as readonly string[]).includes(failing.capability))
    return false;
  const store = missionStoreOf(context);
  const stored = await store.load(context.work.runId).catch(() => null);
  if (!stored || stored.state.repairs >= MAX_REPAIRS) return false;
  const armId = failing.capability as ArmId;
  const next = Math.max(
    stored.state.nodes.length,
    ...stored.state.nodes.map(
      (node) => Number(/^s(\d+)-/.exec(node.key)?.[1] ?? 0) + 1,
    ),
  );
  const key = `s${next}-${armId}`;
  const reason = `repair: ${gate.missing.slice(0, 3).join(" ")}`.slice(0, 300);
  await graphOf(context).append({
    runId: context.work.runId,
    afterStageId: context.work.stageId,
    nodes: [
      {
        key: `${key}-answer`,
        name: `Repair ${armId}: supply the missing evidence`,
        capability: capabilityOfArm(armId),
        input: {
          stageKind: "answer",
          armId,
          segment: next,
          composed: true,
          subObjective:
            `Supply the evidence the contract check found missing: ${gate.missing.slice(0, 4).join(" ")}`.slice(
              0,
              2_000,
            ),
          repair: true,
        },
        dependsOn: [],
        retryPolicy: { maxAttempts: 2, maxSlices: 8 },
        requiresVerification: true,
      },
      {
        key: `${key}-verify`,
        name: `Verify the repair (${armId})`,
        capability: capabilityOfArm(armId),
        input: { stageKind: "verify", armId, segment: next, composed: true },
        dependsOn: [`${key}-answer`],
        requiresVerification: true,
      },
      {
        key: `${key}-meta-verify`,
        name: "Verify against the acceptance contract again",
        capability: "general",
        input: {
          stageKind: "meta_verify",
          armId: context.work.stageInput.armId ?? "general",
          segment: next + 1,
        },
        dependsOn: [`${key}-verify`],
        requiresVerification: true,
      },
    ],
    tailKey: `${key}-meta-verify`,
  });
  await updateMission(store, context.work.runId, (state) => ({
    ...state,
    repairs: state.repairs + 1,
    nodes: [
      ...state.nodes,
      {
        key,
        capability: armId,
        objective: reason,
        prerequisites: [failing.key],
        expectedArtifact: null,
        requiredEvidence: [],
        acceptance: gate.missing.slice(0, 4),
        status: "pending",
        inserted: { reason, evidence: [], after: "meta-verify" },
      },
    ],
    planRevisions: [
      ...state.planRevisions,
      {
        at: new Date().toISOString(),
        stageKey: failing.key,
        reason: "mission gate: repair",
        summary: gate.missing.slice(0, 4).join(" "),
      },
    ].slice(-24),
  }));
  await context.runtime.activity(
    "mission.repair",
    `Re-running ${armId}: ${gate.missing[0] ?? "missing evidence"}`.slice(
      0,
      200,
    ),
    { capability: armId, missing: gate.missing.slice(0, 4) },
    "user",
  );
  return true;
}
