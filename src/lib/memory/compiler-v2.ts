import { createHash } from "node:crypto";
import type { MemoryCompileInput } from "./index";

// Memory Compiler V2: what a finished run is allowed to teach the workspace.
//
// Candidates are derived from evidence the run recorded -- commands and their
// exit codes, the repository map, claims the research arm could support --
// never from the model's prose about itself. Every candidate carries the
// run's verdict, and the compiler promotes only verified ones; an unverified
// run stays in working memory for that run and is not remembered.
//
// Experience memory is the part a later run benefits from most: which command
// really runs this repository's tests, and which failure was fixed by what.

export type RunOutcome = {
  runId: string;
  armId: string;
  objective: string;
  answer: string;
  verdicts: string[];
  state: Record<string, unknown>;
};

/** Kinds the memory_items constraint accepts, used for run-derived memory. */
export type CandidateKind = "run_summary" | "pattern" | "project_map" | "fact";

export type MemoryCandidate = MemoryCompileInput & {
  kind: CandidateKind;
  content: string;
  source: Record<string, unknown>;
};

type CheckRun = { phase: string; command: string; exitCode: number | null };
type Evidence = {
  toolId: string;
  ok: boolean;
  input?: { commandId?: string; cmd?: string; args?: string[] };
  data?: {
    command?: string;
    exitCode?: number | null;
    analysis?: { failureClass?: string; evidence?: string } | null;
  };
};

function key(value: string) {
  return createHash("sha256")
    .update(value.toLowerCase().trim())
    .digest("hex")
    .slice(0, 24);
}

export function isVerifiedOutcome(verdicts: string[]) {
  return (
    verdicts.length > 0 && verdicts.every((verdict) => verdict === "verified")
  );
}

export function memoryCandidates(outcome: RunOutcome): MemoryCandidate[] {
  const verified = isVerifiedOutcome(outcome.verdicts);
  const source = {
    runId: outcome.runId,
    armId: outcome.armId,
    verification: outcome.verdicts.join(","),
  };
  const base = {
    source,
    verified,
    requireVerified: true,
    scope: "workspace" as const,
  };
  const candidates: MemoryCandidate[] = [
    {
      ...base,
      kind: "run_summary",
      content: `Objective: ${outcome.objective}\nResult: ${outcome.answer.slice(0, 4_000)}`,
      confidence: verified ? 0.75 : 0.4,
      importance: 0.6,
      novel: true,
      recurring: false,
      authoritative: false,
    },
  ];

  const workspace = outcome.state.workspace as
    | {
        repository?: string | null;
        languages?: string[];
        frameworks?: string[];
      }
    | undefined;
  const repository = workspace?.repository ?? null;

  // Commands observed to work, per phase: the next run on this repository
  // starts from them instead of rediscovering them.
  if (repository) {
    for (const run of (outcome.state.checkRuns as CheckRun[] | undefined) ??
      []) {
      if (run.exitCode !== 0) continue;
      candidates.push({
        ...base,
        kind: "pattern",
        source: { ...source, memory: "experience.command" },
        content: `In ${repository}, \`${run.command}\` is the ${run.phase} command; it exited 0 in run ${outcome.runId}.`,
        subjectKey: `repo:${repository}:${run.phase}-command`,
        canonicalValue: run.command,
        confidence: 0.85,
        importance: 0.7,
        recurring: true,
        authoritative: false,
      });
    }
    if (workspace?.frameworks?.length) {
      const frameworks = [...workspace.frameworks].sort().join(", ");
      candidates.push({
        ...base,
        kind: "project_map",
        source: { ...source, memory: "repository.frameworks" },
        content: `${repository} uses ${frameworks}.`,
        subjectKey: `repo:${repository}:frameworks`,
        canonicalValue: frameworks,
        confidence: 0.9,
        importance: 0.55,
        recurring: true,
        authoritative: false,
      });
    }
  }

  // Failure followed by a pass of the same command: what broke and that the
  // run's change fixed it.
  const runs = (
    (outcome.state.toolEvidence as Evidence[] | undefined) ?? []
  ).filter(
    (entry) => entry.toolId === "workspace.run" && entry.ok && entry.data,
  );
  for (let index = 0; index < runs.length; index += 1) {
    const failed = runs[index]!;
    if (failed.data?.exitCode === 0 || !failed.data?.analysis) continue;
    const later = runs
      .slice(index + 1)
      .find(
        (entry) =>
          entry.data?.command === failed.data?.command &&
          entry.data?.exitCode === 0,
      );
    if (!later) continue;
    const analysis = failed.data.analysis;
    candidates.push({
      ...base,
      kind: "pattern",
      source: { ...source, memory: "experience.repair" },
      content: `${repository ? `In ${repository}, ` : ""}\`${failed.data.command}\` failed with a ${analysis.failureClass} failure (${(analysis.evidence ?? "").slice(0, 200)}) and passed after the run's change.`,
      subjectKey: null,
      confidence: 0.7,
      importance: 0.6,
      recurring: false,
      novel: true,
      authoritative: false,
    });
  }

  // Research: claims the evidence supported, with the documents retrieved.
  const claims =
    (outcome.state.researchClaims as
      | Array<{ statement: string; status: string; confidence: number }>
      | undefined) ?? [];
  const retrieved =
    (outcome.state.retrieved as Array<{ url: string }> | undefined) ?? [];
  for (const claim of claims) {
    if (claim.status !== "SUPPORTED") continue;
    candidates.push({
      ...base,
      kind: "fact",
      source: {
        ...source,
        memory: "research.supported_claim",
        documents: retrieved.slice(0, 8).map((doc) => doc.url),
      },
      content: `${claim.statement} (sources: ${retrieved
        .slice(0, 4)
        .map((doc) => doc.url)
        .join(", ")})`,
      subjectKey: `fact:${key(claim.statement)}`,
      canonicalValue: claim.statement.trim(),
      confidence: Math.min(0.9, Math.max(0.5, Number(claim.confidence) || 0.6)),
      importance: 0.55,
      recurring: false,
      novel: true,
      authoritative: false,
    });
  }
  return candidates;
}
