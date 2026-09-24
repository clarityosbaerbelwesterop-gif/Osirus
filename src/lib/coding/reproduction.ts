import { z } from "zod";

// Structured evidence that a bug was reproduced before patching.
//
// The coding arm treats bug-class objectives as requiring a reproduction
// artifact when the workspace is available and the strategy asks for it.
// Artifacts are stored on the run state and checked at verification time.

export const REPRODUCTION_STATUSES = [
  "pending",
  "reproduced",
  "not_reproducible",
  "skipped",
] as const;

export type ReproductionStatus = (typeof REPRODUCTION_STATUSES)[number];

export type ReproductionArtifact = {
  id: string;
  command: string;
  environment: Record<string, string>;
  expected: string;
  actual: string;
  status: ReproductionStatus;
  evidencePaths: string[];
  createdAt: string;
  failureClass?: string;
  notes?: string;
};

export const reproductionArtifactSchema = z.object({
  id: z.string().min(1).max(80).optional(),
  command: z.string().min(1).max(500),
  environment: z.record(z.string(), z.string()).optional(),
  expected: z.string().max(2_000),
  actual: z.string().max(8_000),
  status: z.enum(REPRODUCTION_STATUSES),
  evidencePaths: z.array(z.string().max(400)).max(12).optional(),
  failureClass: z.string().max(80).optional(),
  notes: z.string().max(1_000).optional(),
});

const BUG_CLASS =
  /\b(bug|fix|fails?|broken|regression|stack ?trace|assertion|wrong value|incorrect|patch|defect|error in)\b/i;

const TRIVIAL =
  /\b(explain|what is|how does|describe|document|readme|comment only|no code)\b/i;

/** Whether the objective looks like a non-trivial bug fix. */
export function isBugClassTask(objective: string) {
  if (TRIVIAL.test(objective)) return false;
  return BUG_CLASS.test(objective);
}

export function createReproductionArtifact(
  input: z.infer<typeof reproductionArtifactSchema>,
): ReproductionArtifact {
  const parsed = reproductionArtifactSchema.parse(input);
  return {
    id: parsed.id ?? `repro-${Date.now()}`,
    command: parsed.command,
    environment: parsed.environment ?? {},
    expected: parsed.expected,
    actual: parsed.actual,
    status: parsed.status,
    evidencePaths: parsed.evidencePaths ?? [],
    createdAt: new Date().toISOString(),
    failureClass: parsed.failureClass,
    notes: parsed.notes,
  };
}

/** Parse artifact JSON from CREATE_ARTIFACT content or tool output. */
export function parseReproductionArtifact(
  raw: string,
): ReproductionArtifact | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const json = JSON.parse(trimmed) as unknown;
    if (!json || typeof json !== "object") return null;
    return createReproductionArtifact(json as z.infer<typeof reproductionArtifactSchema>);
  } catch {
    return null;
  }
}

export function renderReproductionArtifact(artifact: ReproductionArtifact) {
  return [
    `[reproduction ${artifact.status}] ${artifact.command}`,
    `expected: ${artifact.expected.slice(0, 400)}`,
    `actual: ${artifact.actual.slice(0, 600)}`,
    artifact.failureClass ? `failure: ${artifact.failureClass}` : null,
    artifact.evidencePaths.length
      ? `evidence: ${artifact.evidencePaths.join(", ")}`
      : null,
  ]
    .filter(Boolean)
    .join(" | ");
}

export type ReproductionGateResult = {
  ok: boolean;
  detail: string;
  artifacts: ReproductionArtifact[];
};

/**
 * Gate FINISH / verification when a bug-class task requires reproduction first.
 *
 * `requireReproduction` comes from strategy.genome.coding.reproduceFirst or
 * from the objective class when workspace tools were available.
 */
export function evaluateReproductionGate(input: {
  objective: string;
  requireReproduction: boolean;
  workspaceAvailable: boolean;
  artifacts: ReproductionArtifact[];
}): ReproductionGateResult {
  const bug = isBugClassTask(input.objective);
  if (!bug || !input.requireReproduction || !input.workspaceAvailable) {
    return {
      ok: true,
      detail: bug
        ? "Reproduction not required for this run."
        : "Not a bug-class task.",
      artifacts: input.artifacts,
    };
  }
  const reproduced = input.artifacts.filter(
    (artifact) => artifact.status === "reproduced",
  );
  const skipped = input.artifacts.filter(
    (artifact) => artifact.status === "not_reproducible" || artifact.status === "skipped",
  );
  if (reproduced.length > 0) {
    return {
      ok: true,
      detail: `Reproduction recorded (${reproduced.length} artifact(s)).`,
      artifacts: input.artifacts,
    };
  }
  if (skipped.length > 0) {
    return {
      ok: true,
      detail: `Reproduction waived: ${skipped[0]?.notes ?? skipped[0]?.status}.`,
      artifacts: input.artifacts,
    };
  }
  return {
    ok: false,
    detail:
      "Bug-class task: reproduce the failure with workspace.run and record a reproduction artifact before patching.",
    artifacts: input.artifacts,
  };
}

/** Merge a new artifact into the run state list (dedupe by id). */
export function mergeReproductionArtifacts(
  prior: ReproductionArtifact[],
  next: ReproductionArtifact,
) {
  const without = prior.filter((artifact) => artifact.id !== next.id);
  return [...without, next].slice(-6);
}

/** Build a reproduction artifact from a failed workspace.run result. */
export function artifactFromCommandFailure(input: {
  command: string;
  exitCode: number | null;
  stdout?: string;
  stderr?: string;
  failureClass?: string;
  expected?: string;
}) {
  const output = `${input.stdout ?? ""}\n${input.stderr ?? ""}`.trim();
  return createReproductionArtifact({
    command: input.command,
    expected: input.expected ?? "failure reproducing the reported bug",
    actual: `exit ${input.exitCode ?? "null"}: ${output.slice(-2_000)}`,
    status:
      input.exitCode !== 0 ? "reproduced" : "skipped",
    failureClass: input.failureClass,
    evidencePaths: [],
    notes:
      input.exitCode === 0
        ? "Command succeeded; no failure to reproduce."
        : "Failure captured before patch.",
  });
}
