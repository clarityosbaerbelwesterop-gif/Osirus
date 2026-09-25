import { createHash } from "node:crypto";
import { fingerprint } from "../evals/random";
import type { IntelStore } from "../store/store";
import type { Experience } from "../types";

// Procedure mining and skill synthesis (M43).
//
// A procedure is a tool sequence that verified runs share across distinct
// tasks AND across at least two task generators, so a benchmark's own
// template is not mistaken for a skill. A procedure becomes a structured
// skill candidate in the existing skill tables (status "candidate"); the
// product loads it only after a policy that names it wins its trials.

export type Procedure = {
  key: string;
  steps: string[];
  tasks: string[];
  generators: string[];
  capabilityIds: string[];
};

function sequenceOf(row: Experience) {
  const steps: string[] = [];
  for (const action of row.trajectory.actions ?? []) {
    const step =
      action.action === "USE_TOOL" && action.outcome === "ok" && action.toolId
        ? action.toolId
        : action.action === "VERIFY" && action.outcome !== "failed"
          ? "VERIFY"
          : null;
    if (step && steps.at(-1) !== step) steps.push(step);
  }
  return steps;
}

export function mineProcedures(
  experience: Experience[],
  options: {
    minTasks?: number;
    minGenerators?: number;
    lengths?: number[];
  } = {},
): Procedure[] {
  const minTasks = options.minTasks ?? 3;
  const minGenerators = options.minGenerators ?? 2;
  const lengths = options.lengths ?? [4, 3, 2];
  const grams = new Map<string, Procedure>();
  for (const row of experience) {
    if (row.source === "product" || row.outcome !== "verified_success")
      continue;
    const steps = sequenceOf(row);
    const task = row.taskRef ?? row.fingerprint;
    const generator = String(
      (row.provenance as { generator?: unknown }).generator ?? row.source,
    );
    for (const n of lengths)
      for (let start = 0; start + n <= steps.length; start += 1) {
        const slice = steps.slice(start, start + n);
        // A procedure has to do something: at least one tool, not only checks.
        if (!slice.some((step) => step !== "VERIFY")) continue;
        const key = slice.join(" > ");
        const entry = grams.get(key) ?? {
          key,
          steps: slice,
          tasks: [],
          generators: [],
          capabilityIds: [],
        };
        if (!entry.tasks.includes(task)) entry.tasks.push(task);
        if (!entry.generators.includes(generator))
          entry.generators.push(generator);
        for (const cap of row.capabilityIds)
          if (!entry.capabilityIds.includes(cap)) entry.capabilityIds.push(cap);
        grams.set(key, entry);
      }
  }
  const supported = [...grams.values()].filter(
    (entry) =>
      entry.tasks.length >= minTasks &&
      entry.generators.length >= minGenerators,
  );
  // Keep the longest: a shorter gram inside a longer one with the same
  // support says nothing new.
  return supported
    .filter(
      (entry) =>
        !supported.some(
          (other) =>
            other.steps.length > entry.steps.length &&
            other.key.includes(entry.key) &&
            other.tasks.length >= entry.tasks.length,
        ),
    )
    .sort(
      (a, b) =>
        b.tasks.length - a.tasks.length || b.steps.length - a.steps.length,
    );
}

export type SkillCandidate = {
  id: string;
  version: string;
  name: string;
  trigger: string;
  preconditions: string[];
  inputs: string[];
  procedure: string[];
  tools: string[];
  verification: string;
  output: string;
  failureModes: string[];
  provenance: { procedure: string; tasks: number; generators: string[] };
  instruction: string;
};

/** A structured skill from a mined procedure. Deterministic, no model. */
export function synthesizeSkill(
  procedure: Procedure,
  arm: string,
): SkillCandidate {
  const tools = procedure.steps.filter((step) => step !== "VERIFY");
  const hash = createHash("sha256")
    .update(procedure.key)
    .digest("hex")
    .slice(0, 10);
  const verifies = procedure.steps.includes("VERIFY");
  const steps = procedure.steps.map((step, index) =>
    step === "VERIFY"
      ? `${index + 1}. Verify the intermediate result before going on.`
      : `${index + 1}. Call ${step} with what the previous step established.`,
  );
  const candidate: Omit<SkillCandidate, "instruction"> = {
    id: `synth.${arm}.${hash}`,
    version: "v1",
    name: `${arm}: ${tools.join(" then ")}`.slice(0, 120),
    trigger: `A ${arm} task that needs ${tools.join(", ")}`,
    preconditions: tools.map((tool) => `${tool} is available to the arm`),
    inputs: ["the objective", "facts the mission already holds"],
    procedure: steps,
    tools,
    verification: verifies
      ? "The procedure's own VERIFY step, then the arm's verifier."
      : "The arm's verifier on the final result.",
    output: "The result of the last step, stated with its evidence.",
    failureModes: [
      "A tool in the procedure is unavailable: fall back to the arm's default loop.",
      "An intermediate result fails verification: stop and replan instead of continuing.",
    ],
    provenance: {
      procedure: procedure.key,
      tasks: procedure.tasks.length,
      generators: procedure.generators,
    },
  };
  return {
    ...candidate,
    instruction: [
      `When: ${candidate.trigger}.`,
      ...candidate.procedure,
      `Check: ${candidate.verification}`,
      `If it fails: ${candidate.failureModes.join(" ")}`,
    ].join("\n"),
  };
}

/**
 * Store a skill candidate in the existing skill tables, status candidate,
 * and record it as a Foundry artifact. System writes only (both tables are
 * system-only by RLS).
 */
export async function persistSkillCandidate(
  store: IntelStore,
  input: { candidate: SkillCandidate; arm: string; cycleId: string | null },
) {
  const { querySystem } = await import("../../db/client");
  const { candidate } = input;
  const source = { origin: "m43_synthesis", procedure: candidate.provenance };
  await querySystem(
    `insert into osirus.skill_definitions
       (id, slug, name, category, description, activation_conditions, priority,
        risk, tool_needs, capability_affinity, estimated_context_cost, source,
        enabled, status)
     values ($1, $1, $2, 'synthesized', $3, $4::jsonb, 'P1', 'low', $5::jsonb,
             $6::jsonb, $7, $8::jsonb, true, 'candidate')
     on conflict (id) do nothing`,
    [
      candidate.id,
      candidate.name,
      candidate.trigger,
      JSON.stringify([candidate.trigger]),
      JSON.stringify(candidate.tools),
      JSON.stringify([input.arm]),
      Math.ceil(candidate.instruction.length / 4),
      JSON.stringify(source),
    ],
  );
  await querySystem(
    `insert into osirus.skill_versions (skill_id, version, instruction, source, status)
     values ($1, $2, $3, $4::jsonb, 'candidate')
     on conflict (skill_id, version) do nothing`,
    [
      candidate.id,
      candidate.version,
      candidate.instruction,
      JSON.stringify(source),
    ],
  );
  return store.upsertArtifact({
    cycleId: input.cycleId,
    kind: "procedure",
    capabilityId: null,
    taskPattern: candidate.provenance.procedure,
    content: { skill: `${candidate.id}@${candidate.version}`, ...candidate },
    evidence: {
      tasks: candidate.provenance.tasks,
      generators: candidate.provenance.generators,
    },
    support: candidate.provenance.tasks,
    status: "proposed",
    fingerprint: fingerprint(
      "procedure_skill",
      candidate.id,
      candidate.version,
    ),
  });
}
