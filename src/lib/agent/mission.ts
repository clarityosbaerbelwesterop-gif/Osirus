import type { Handoff } from "./handoff";
import type { ActionEntry, MissionGoal, MissionWait } from "./long-horizon";
import type { HypothesisSeed, TaskSeed, TaskState } from "./task-state";

// One mission, one cognition state.
//
// A compound objective runs as one run whose stages belong to different
// capabilities. Each stage keeps its own working TaskState while it runs;
// the mission state is the authoritative record across all of them: the
// contract, the capability nodes, the facts with their provenance, the
// hypotheses (rejected ones included), contradictions, open questions, plan
// revisions and capability switches. A stage is seeded from it and
// reconciled into it; nothing passes between capabilities as prose alone.
//
// Pure functions only. Persistence is runtime/missions.ts.

export type Volatility = "static" | "slow" | "fast" | "event";
const VOLATILITY_ORDER: Volatility[] = ["static", "slow", "fast", "event"];

export type MissionFact = {
  id: string;
  statement: string;
  /** Where it came from: which capability, which stage, which kind. */
  provenance: {
    capability: string;
    stageKey: string;
    kind:
      | "tool"
      | "memory"
      | "verification"
      | "artifact"
      | "research"
      | "compute"
      | "change"
      | "seed";
  };
  evidenceRefs: string[];
  /** Whether a verifier or an independent check stood behind it. */
  verified: boolean;
  observedAt: string;
  /** How fast the fact can go stale; used when a mission resumes (M40). */
  volatility: Volatility;
  validUntil: string | null;
  /** Set when a later observation invalidated it. */
  invalidated?: { at: string; reason: string } | null;
};

export type MissionHypothesis = {
  statement: string;
  status: "OPEN" | "SUPPORTED" | "WEAKENED" | "REJECTED" | "CONFIRMED";
  owner: string;
  supporting: string[];
  counter: string[];
};

export type MissionNodeStatus =
  | "pending"
  | "running"
  | "verified"
  | "unverified"
  | "rejected"
  | "conflicted"
  | "blocked";

export type MissionNode = {
  key: string;
  capability: string;
  objective: string;
  prerequisites: string[];
  expectedArtifact: string | null;
  requiredEvidence: string[];
  acceptance: string[];
  status: MissionNodeStatus;
  /** Present when the node was added while the mission ran. */
  inserted: { reason: string; evidence: string[]; after: string } | null;
};

export type CapabilitySwitch = {
  at: string;
  from: { capability: string; stageKey: string };
  to: string;
  reason: string;
  evidence: string[];
  addedNodes: string[];
};

export type MissionPlanRevision = {
  at: string;
  stageKey: string;
  reason: string;
  summary: string;
};

export type MissionState = {
  version: 1;
  objective: string;
  contract: {
    successCriteria: string[];
    requiredEvidence: string[];
    deliverables: string[];
  };
  nodes: MissionNode[];
  facts: MissionFact[];
  hypotheses: MissionHypothesis[];
  contradictions: Array<{ statement: string; between: string[] }>;
  openQuestions: string[];
  assumptions: string[];
  constraints: string[];
  artifacts: Array<{ ref: string; kind: string; from: string }>;
  planRevisions: MissionPlanRevision[];
  completedSubgoals: string[];
  blockedSubgoals: string[];
  switches: CapabilitySwitch[];
  repairs: number;
  /** How much of what earlier stages established later stages received. */
  handoff: { offered: number; received: number };
  outcome: "running" | "complete" | "partial" | "failed";
  /** M40 long-horizon state (agent/long-horizon.ts); absent on older rows. */
  waits?: MissionWait[];
  goals?: MissionGoal[];
  actions?: ActionEntry[];
  lastActiveAt?: string | null;
  nextWake?: string | null;
};

const MAX_FACTS = 60;
const MAX_LIST = 24;
export const MAX_SWITCHES = 4;
export const MAX_REPAIRS = 1;

export function normalize(text: string) {
  return text
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[.;,]+$/, "")
    .trim();
}

function unique(values: string[], limit = MAX_LIST) {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const key = normalize(value);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out.slice(-limit);
}

function factId(statement: string) {
  let h = 5381;
  for (const char of normalize(statement)) h = (h * 33) ^ char.charCodeAt(0);
  return `f${(h >>> 0).toString(36)}`;
}

export function createMission(input: {
  objective: string;
  successCriteria?: string[];
  requiredEvidence?: string[];
  deliverables?: string[];
  nodes: Array<{
    key: string;
    capability: string;
    objective?: string;
    prerequisites?: string[];
    requiredEvidence?: string[];
    acceptance?: string[];
  }>;
}): MissionState {
  return {
    version: 1,
    objective: input.objective,
    contract: {
      successCriteria: unique(input.successCriteria ?? []),
      requiredEvidence: unique(input.requiredEvidence ?? []),
      deliverables: unique(input.deliverables ?? []),
    },
    nodes: input.nodes.map((node) => ({
      key: node.key,
      capability: node.capability,
      objective: node.objective ?? input.objective,
      prerequisites: node.prerequisites ?? [],
      expectedArtifact: null,
      requiredEvidence: node.requiredEvidence ?? [],
      acceptance: node.acceptance ?? [],
      status: "pending",
      inserted: null,
    })),
    facts: [],
    hypotheses: [],
    contradictions: [],
    openQuestions: [],
    assumptions: [],
    constraints: [],
    artifacts: [],
    planRevisions: [],
    completedSubgoals: [],
    blockedSubgoals: [],
    switches: [],
    repairs: 0,
    handoff: { offered: 0, received: 0 },
    outcome: "running",
  };
}

type FactInput = Omit<MissionFact, "id" | "observedAt" | "validUntil"> & {
  observedAt?: string;
  validUntil?: string | null;
};

/** Add facts, one row per statement; a verified sighting upgrades it. */
export function addFacts(
  mission: MissionState,
  incoming: FactInput[],
  now = new Date().toISOString(),
): MissionState {
  const byId = new Map(mission.facts.map((fact) => [fact.id, fact]));
  for (const input of incoming) {
    const statement = input.statement.trim().slice(0, 600);
    if (!statement) continue;
    const id = factId(statement);
    const existing = byId.get(id);
    if (existing) {
      byId.set(id, {
        ...existing,
        verified: existing.verified || input.verified,
        evidenceRefs: unique(
          [...existing.evidenceRefs, ...input.evidenceRefs],
          12,
        ),
        observedAt: input.observedAt ?? now,
        // A fact is as volatile as its most volatile sighting (M40).
        volatility:
          VOLATILITY_ORDER.indexOf(input.volatility) >
          VOLATILITY_ORDER.indexOf(existing.volatility)
            ? input.volatility
            : existing.volatility,
        invalidated: null,
      });
      continue;
    }
    byId.set(id, {
      id,
      statement,
      provenance: input.provenance,
      evidenceRefs: unique(input.evidenceRefs, 12),
      verified: input.verified,
      observedAt: input.observedAt ?? now,
      volatility: input.volatility,
      validUntil: input.validUntil ?? null,
      invalidated: null,
    });
  }
  const facts = [...byId.values()];
  // Keep verified facts first when the list is full.
  facts.sort((a, b) => Number(b.verified) - Number(a.verified));
  return { ...mission, facts: facts.slice(0, MAX_FACTS) };
}

function factsFromHandoff(handoff: Handoff, stageKey: string): FactInput[] {
  const verified = handoff.verdict === "verified";
  switch (handoff.kind) {
    case "research_facts":
      return handoff.facts.map((fact) => ({
        statement: fact.statement,
        provenance: { capability: "research", stageKey, kind: "research" },
        evidenceRefs: fact.sources,
        verified: verified && fact.status === "SUPPORTED",
        volatility: "slow",
      }));
    case "computed_values":
      return handoff.values.map((value) => ({
        statement: `${value.request} = ${value.result}`,
        provenance: { capability: "math_science", stageKey, kind: "compute" },
        evidenceRefs: [],
        verified: verified || value.independentlyConfirmed === true,
        volatility: "static",
      }));
    case "change_evidence":
      return handoff.commands.map((command) => ({
        statement: `${command.phase}: \`${command.command}\` exited ${command.exitCode ?? "without a code"}`,
        provenance: { capability: handoff.from, stageKey, kind: "change" },
        evidenceRefs: handoff.previewUrl ? [handoff.previewUrl] : [],
        verified: command.exitCode === 0,
        volatility: "fast",
      }));
    case "plan_contract":
      return [];
    case "answer_summary":
      // What a capability without a structured handoff established: its
      // own result, marked verified only if its verifier said so.
      return [
        {
          statement: handoff.summary,
          provenance: { capability: handoff.from, stageKey, kind: "seed" },
          evidenceRefs: [],
          verified,
          volatility: "slow",
        },
      ];
  }
}

/**
 * Fold one stage's working state into the mission: facts with provenance,
 * hypotheses (a rejection is kept, not dropped), open questions, plan
 * revisions, subgoals, artifacts; and the node's verdict.
 */
export function reconcileMission(
  mission: MissionState,
  input: {
    stageKey: string;
    capability: string;
    kernel?: TaskState | null;
    handoff?: Handoff | null;
    verdict?: "verified" | "unverified" | "rejected" | "conflicted" | null;
    artifacts?: Array<{ ref: string; kind: string }>;
    now?: string;
  },
): MissionState {
  const now = input.now ?? new Date().toISOString();
  let next = mission;
  const kernel = input.kernel;
  if (kernel) {
    const supported = new Set(
      kernel.evidence.map((entry) => entry.summary.trim()),
    );
    next = addFacts(
      next,
      [
        ...kernel.knownFacts.map((statement) => ({
          statement,
          provenance: {
            capability: input.capability,
            stageKey: input.stageKey,
            kind: "memory" as const,
          },
          evidenceRefs: [],
          verified: supported.has(statement.trim()),
          volatility: "slow" as Volatility,
        })),
        ...kernel.evidence
          .filter((entry) => entry.source !== "seed")
          .map((entry) => ({
            statement: entry.summary,
            provenance: {
              capability: input.capability,
              stageKey: input.stageKey,
              kind: (entry.source === "verification"
                ? "verification"
                : entry.source === "artifact"
                  ? "artifact"
                  : entry.source === "memory"
                    ? "memory"
                    : "tool") as MissionFact["provenance"]["kind"],
            },
            evidenceRefs: entry.ref ? [entry.ref] : [],
            verified: entry.source === "verification",
            volatility: "fast" as Volatility,
          })),
      ],
      now,
    );

    const hypotheses = new Map(
      next.hypotheses.map((entry) => [normalize(entry.statement), entry]),
    );
    const contradictions = [...next.contradictions];
    for (const hypothesis of kernel.hypotheses) {
      const key = normalize(hypothesis.statement);
      const prior = hypotheses.get(key);
      const incoming: MissionHypothesis = {
        statement: hypothesis.statement,
        status: hypothesis.status,
        owner: input.capability,
        supporting: hypothesis.supportingEvidence.slice(-6),
        counter: hypothesis.counterEvidence.slice(-6),
      };
      if (
        prior &&
        prior.owner !== input.capability &&
        ((["SUPPORTED", "CONFIRMED"].includes(prior.status) &&
          incoming.status === "REJECTED") ||
          (prior.status === "REJECTED" &&
            ["SUPPORTED", "CONFIRMED"].includes(incoming.status)))
      )
        contradictions.push({
          statement: hypothesis.statement,
          between: [prior.owner, input.capability],
        });
      hypotheses.set(
        key,
        prior && prior.status !== "OPEN" && incoming.status === "OPEN"
          ? prior
          : incoming,
      );
    }
    next = {
      ...next,
      hypotheses: [...hypotheses.values()].slice(-MAX_LIST),
      contradictions: contradictions.slice(-MAX_LIST),
      openQuestions: unique([...next.openQuestions, ...kernel.openQuestions]),
      assumptions: unique([...next.assumptions, ...kernel.assumptions]),
      constraints: unique([...next.constraints, ...kernel.constraints]),
      completedSubgoals: unique([
        ...next.completedSubgoals,
        ...kernel.completedSubgoals,
      ]),
      blockedSubgoals: unique([
        ...next.blockedSubgoals,
        ...kernel.blockedSubgoals,
      ]),
      planRevisions: [
        ...next.planRevisions,
        ...kernel.planRevisions.map((revision) => ({
          at: now,
          stageKey: input.stageKey,
          reason: revision.reason,
          summary: revision.summary,
        })),
      ].slice(-MAX_LIST),
    };
  }
  if (input.handoff)
    next = addFacts(next, factsFromHandoff(input.handoff, input.stageKey), now);
  if (input.artifacts?.length)
    next = {
      ...next,
      artifacts: [
        ...next.artifacts,
        ...input.artifacts.map((artifact) => ({
          ...artifact,
          from: input.capability,
        })),
      ].slice(-MAX_LIST),
    };
  if (input.verdict)
    next = {
      ...next,
      nodes: next.nodes.map((node) =>
        node.key === input.stageKey ||
        (node.capability === input.capability &&
          input.stageKey.startsWith(`${node.key}`))
          ? { ...node, status: input.verdict! }
          : node,
      ),
    };
  return next;
}

export type StageSeed = {
  task: TaskSeed;
  hypotheses: HypothesisSeed[];
  context: string[];
  seededFactIds: string[];
};

/**
 * What a stage starts from: the mission's facts (verified first, each with
 * where it came from), live hypotheses, rejected ones as known dead ends,
 * open questions, constraints and the contract.
 */
export function seedForStage(
  mission: MissionState,
  capability: string,
): StageSeed {
  const live = mission.facts.filter((fact) => !fact.invalidated);
  const ordered = [
    ...live.filter((fact) => fact.verified),
    ...live.filter((fact) => !fact.verified),
  ].slice(0, 12);
  const label = (fact: MissionFact) =>
    `${fact.statement} [${fact.verified ? "verified" : "unverified"}; from ${fact.provenance.capability}/${fact.provenance.kind}${fact.evidenceRefs.length ? `; refs ${fact.evidenceRefs.slice(0, 3).join(", ")}` : ""}]`;
  const rejected = mission.hypotheses.filter((h) => h.status === "REJECTED");
  const active = mission.hypotheses.filter(
    (h) => h.status !== "REJECTED" && h.owner !== capability,
  );
  return {
    task: {
      knownFacts: ordered.map(label),
      constraints: mission.constraints.slice(-12),
      openQuestions: mission.openQuestions.slice(-12),
      assumptions: mission.assumptions.slice(-12),
      successCriteria: mission.contract.successCriteria.slice(0, 10),
      deliverables: mission.contract.deliverables.slice(0, 6),
    },
    hypotheses: active.slice(-6).map((hypothesis) => ({
      statement: hypothesis.statement,
      status: hypothesis.status,
    })),
    context: [
      `[mission] ${mission.objective.slice(0, 600)}`,
      ...(rejected.length
        ? [
            `[mission: rejected hypotheses -- do not revive without new evidence] ${rejected
              .slice(-6)
              .map((h) => h.statement)
              .join(" | ")}`,
          ]
        : []),
      ...(mission.contradictions.length
        ? [
            `[mission: unresolved contradictions] ${mission.contradictions
              .slice(-4)
              .map((c) => `${c.statement} (${c.between.join(" vs ")})`)
              .join(" | ")}`,
          ]
        : []),
    ],
    seededFactIds: ordered.map((fact) => fact.id),
  };
}

/** Count what a stage was offered and what it actually received. */
export function recordHandoff(
  mission: MissionState,
  offered: number,
  received: number,
): MissionState {
  return {
    ...mission,
    handoff: {
      offered: mission.handoff.offered + offered,
      received: mission.handoff.received + received,
    },
  };
}

/** Share of upstream facts a later stage did not receive. 0 is lossless. */
export function handoffLoss(mission: MissionState) {
  return mission.handoff.offered === 0
    ? 0
    : Number(
        (1 - mission.handoff.received / mission.handoff.offered).toFixed(4),
      );
}

/** A capability switch the running mission decided on, with its evidence. */
export function recordSwitch(
  mission: MissionState,
  input: Omit<CapabilitySwitch, "at"> & { at?: string },
  added: Array<{ key: string; capability: string; objective: string }>,
): MissionState {
  const at = input.at ?? new Date().toISOString();
  return {
    ...mission,
    switches: [...mission.switches, { ...input, at }],
    nodes: [
      ...mission.nodes,
      ...added.map((node) => ({
        key: node.key,
        capability: node.capability,
        objective: node.objective,
        prerequisites: [input.from.stageKey],
        expectedArtifact: null,
        requiredEvidence: [],
        acceptance: [],
        status: "pending" as const,
        inserted: {
          reason: input.reason,
          evidence: input.evidence,
          after: input.from.stageKey,
        },
      })),
    ],
    planRevisions: [
      ...mission.planRevisions,
      {
        at,
        stageKey: input.from.stageKey,
        reason: `capability switch to ${input.to}`,
        summary: `${input.reason}${input.evidence.length ? ` (evidence: ${input.evidence.slice(0, 3).join("; ")})` : ""}`,
      },
    ].slice(-MAX_LIST),
  };
}

export type MissionGate = {
  status: "complete" | "partial" | "failed";
  missing: string[];
  coverage: { satisfied: number; required: number };
};

/**
 * The mission is complete only when every capability node it ran is backed
 * by verified evidence, no stage was rejected, and no contradiction between
 * capabilities is left open. The last specialist saying "done" is not
 * enough: correct code with a rejected research claim is not complete.
 */
export function assessMissionGate(
  mission: MissionState,
  verdicts: Array<{
    key: string;
    capability: string;
    verdict: string | null;
    meta?: boolean;
  }>,
): MissionGate {
  const missing: string[] = [];
  let failed = false;
  const scored = verdicts.filter((entry) => !entry.meta);
  for (const entry of verdicts) {
    if (entry.verdict === "rejected" || entry.verdict === "conflicted") {
      failed = true;
      missing.push(
        entry.meta
          ? `The contract check rejected the result (${entry.key}).`
          : `${entry.capability} (${entry.key}) was ${entry.verdict}.`,
      );
    }
  }
  const verified = scored.filter((entry) => entry.verdict === "verified");
  for (const entry of scored)
    if (
      entry.verdict !== "verified" &&
      entry.verdict !== "rejected" &&
      entry.verdict !== "conflicted"
    )
      missing.push(
        `${entry.capability} (${entry.key}) has no verified evidence.`,
      );
  for (const contradiction of mission.contradictions) {
    failed = true;
    missing.push(
      `Unresolved contradiction between ${contradiction.between.join(" and ")}: ${contradiction.statement}`,
    );
  }
  const status: MissionGate["status"] = failed
    ? "failed"
    : missing.length
      ? "partial"
      : "complete";
  return {
    status,
    missing,
    coverage: { satisfied: verified.length, required: scored.length },
  };
}
