import { z } from "zod";

// What one arm hands the next in a composed run.
//
// A typed record, not a transcript. Research hands over the claims it could
// support and where each came from; thinking hands over its plan and success
// criteria; coding hands over the diff summary and the exit codes; math hands
// over the values it computed and whether a second method agreed. Each
// handoff says whether the segment that produced it was verified, so the next
// arm can tell a checked fact from a draft.

const verified = z.enum(["verified", "unverified", "rejected", "conflicted"]);

export const handoffSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("research_facts"),
    from: z.literal("research"),
    verdict: verified,
    facts: z
      .array(
        z.object({
          statement: z.string().max(600),
          status: z.string(),
          sources: z.array(z.string().max(500)).max(8),
        }),
      )
      .max(20),
  }),
  z.object({
    kind: z.literal("plan_contract"),
    from: z.literal("thinking"),
    verdict: verified,
    successCriteria: z.array(z.string().max(300)).max(10),
    plan: z
      .array(
        z.object({
          id: z.string(),
          arm: z.string(),
          title: z.string(),
          doneWhen: z.string(),
        }),
      )
      .max(12),
  }),
  z.object({
    kind: z.literal("change_evidence"),
    from: z.enum(["coding", "building"]),
    verdict: verified,
    repository: z.string().nullable(),
    diffSummary: z.string().max(4_000),
    commands: z
      .array(
        z.object({
          phase: z.string(),
          command: z.string().max(300),
          exitCode: z.number().nullable(),
        }),
      )
      .max(20),
    previewUrl: z.string().nullable(),
    qa: z.string().nullable(),
  }),
  z.object({
    kind: z.literal("computed_values"),
    from: z.literal("math_science"),
    verdict: verified,
    values: z
      .array(
        z.object({
          request: z.string().max(300),
          result: z.string().max(300),
          independentlyConfirmed: z.boolean().nullable(),
        }),
      )
      .max(20),
  }),
  z.object({
    kind: z.literal("answer_summary"),
    from: z.string(),
    verdict: verified,
    summary: z.string().max(1_200),
  }),
]);
export type Handoff = z.infer<typeof handoffSchema>;

type State = Record<string, unknown>;

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

/** Build the handoff an arm leaves behind from the state it wrote. */
export function handoffFor(
  armId: string,
  state: State,
  verdict: Handoff["verdict"],
): Handoff {
  if (armId === "research") {
    const retrieved = asArray<{ url: string }>(state.retrieved).map(
      (doc) => doc.url,
    );
    return {
      kind: "research_facts",
      from: "research",
      verdict,
      facts: asArray<{ statement: string; status: string }>(
        state.researchClaims,
      )
        .filter(
          (claim) =>
            claim.status === "SUPPORTED" || claim.status === "CONTESTED",
        )
        .slice(0, 20)
        .map((claim) => ({
          statement: claim.statement.slice(0, 600),
          status: claim.status,
          // The claim graph links claims to documents in the evidence store;
          // the handoff carries the run's retrieved URLs for the next arm to
          // cite, never a URL nobody fetched.
          sources: retrieved.slice(0, 8),
        })),
    };
  }
  if (armId === "thinking") {
    const plan = (state.planGraph as { nodes?: unknown[] } | undefined)?.nodes;
    const model = state.taskModel as { successCriteria?: string[] } | undefined;
    const analysis = state.analysis as
      { successCriteria?: string[] } | undefined;
    return {
      kind: "plan_contract",
      from: "thinking",
      verdict,
      successCriteria: (
        model?.successCriteria ??
        analysis?.successCriteria ??
        []
      ).slice(0, 10),
      plan: asArray<{
        id: string;
        arm: string;
        title: string;
        doneWhen: string;
      }>(plan)
        .slice(0, 12)
        .map((node) => ({
          id: node.id,
          arm: node.arm,
          title: node.title,
          doneWhen: node.doneWhen,
        })),
    };
  }
  if (armId === "coding" || armId === "building") {
    const workspace = state.workspace as
      { repository?: string | null } | undefined;
    const qa = state.qaReport as
      { mode?: string; checks?: Array<{ passed: boolean }> } | undefined;
    const diff =
      typeof state.workspaceDiff === "string" ? state.workspaceDiff : "";
    return {
      kind: "change_evidence",
      from: armId,
      verdict,
      repository: workspace?.repository ?? null,
      diffSummary: diff
        .split("\n")
        .filter((line) => /^(\+\+\+|---|# Untracked|\+ )/.test(line))
        .join("\n")
        .slice(0, 4_000),
      commands: asArray<{
        phase: string;
        command: string;
        exitCode: number | null;
      }>(state.checkRuns).map((run) => ({
        phase: run.phase,
        command: run.command.slice(0, 300),
        exitCode: run.exitCode,
      })),
      previewUrl: null,
      qa: qa?.mode
        ? `${qa.mode}: ${(qa.checks ?? []).filter((check) => check.passed).length}/${(qa.checks ?? []).length} checks passed`
        : null,
    };
  }
  if (armId === "math_science") {
    return {
      kind: "computed_values",
      from: "math_science",
      verdict,
      values: asArray<{
        toolId: string;
        ok: boolean;
        input: unknown;
        data?: {
          result?: { text?: string; value?: unknown };
          check?: { agrees?: boolean | null };
        };
      }>(state.toolEvidence)
        .filter((entry) => entry.toolId === "compute.run" && entry.ok)
        .slice(-20)
        .map((entry) => ({
          request: JSON.stringify(entry.input).slice(0, 300),
          result: String(
            entry.data?.result?.text ?? entry.data?.result?.value ?? "",
          ).slice(0, 300),
          independentlyConfirmed: entry.data?.check?.agrees ?? null,
        })),
    };
  }
  return {
    kind: "answer_summary",
    from: armId,
    verdict,
    summary: String(state.answer ?? "").slice(0, 1_200),
  };
}
