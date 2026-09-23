import type { IntelStore } from "../store/store";
import type { CapabilityGap, Experience, GapKind } from "../types";

// FailureAnalyzer and CapabilityGapDetector.
//
// A failure says what went wrong; a gap says what was missing. The analyzer
// reads the structured trajectory (stage order, tool actions, the judge's
// detail) of failed experience and names the missing piece: knowledge, a
// tool, execution, planning, context, memory, the model, or verification.
// Provider outages are recorded but never become strategy work: no strategy
// fixes an empty account balance.

export type FailureAnalysis = {
  kind: GapKind;
  summary: string;
  signal: string;
};

const count = (
  actions: Array<{ action: string; toolId?: string }> | undefined,
  pattern: RegExp,
) =>
  (actions ?? []).filter((action) =>
    pattern.test(action.toolId ?? action.action),
  ).length;

export function analyzeExperience(row: Experience): FailureAnalysis | null {
  if (row.outcome === "verified_success") return null;
  const failure = row.failureClass ?? "unknown";
  const actions = row.trajectory.actions;

  if (failure.startsWith("provider:"))
    return {
      kind: "model",
      summary: `Model provider unavailable (${failure.slice(9)})`,
      signal: failure,
    };
  if (failure === "no_workspace_check" || failure.startsWith("stage:"))
    return {
      kind: "execution",
      summary: "Run did not reach its checks (workspace or stage failure)",
      signal: failure,
    };

  if (row.taskType === "coding") {
    const explored = count(actions, /workspace\.(tree|search|read)/);
    const ran = count(actions, /workspace\.run/);
    const edits = count(actions, /workspace\.(write|replace)/);
    if (edits === 0)
      return {
        kind: "execution",
        summary: "Finished without changing the code",
        signal: `edits=0 explored=${explored}`,
      };
    if (ran === 0)
      return {
        kind: "planning",
        summary: "Edited before reproducing the failure",
        signal: `runs=0 edits=${edits}`,
      };
    if (explored >= 6)
      return {
        kind: "context",
        summary: "Spent most steps locating code in the repository",
        signal: `explored=${explored}`,
      };
    if (failure === "runtime_error")
      return {
        kind: "execution",
        summary: "Fix introduced a runtime error",
        signal: failure,
      };
    if (row.outcome === "false_completion")
      return {
        kind: "verification",
        summary: "Claimed the fix works while hidden tests fail",
        signal: failure,
      };
    return {
      kind: "knowledge",
      summary: "Fix addressed the visible case, not the general defect",
      signal: failure,
    };
  }

  if (row.taskType === "math") {
    const computed = count(actions, /compute/);
    if (failure === "no_answer")
      return {
        kind: "verification",
        summary: "No clearly stated final number",
        signal: failure,
      };
    if (computed === 0)
      return {
        kind: "tool",
        summary: "Answered without using the compute tool",
        signal: `compute=0`,
      };
    return {
      kind: "planning",
      summary: "Computed the wrong quantity",
      signal: failure,
    };
  }

  return {
    kind: row.outcome === "false_completion" ? "verification" : "knowledge",
    summary: "Answer did not meet the task's check",
    signal: failure,
  };
}

/** Aggregate failed experience into gaps for one capability. */
export async function detectGaps(
  store: IntelStore,
  capabilityId: string,
  rows: Experience[],
) {
  const grouped = new Map<
    string,
    { analysis: FailureAnalysis; ids: string[] }
  >();
  for (const row of rows) {
    const analysis = analyzeExperience(row);
    if (!analysis) continue;
    const key = `${analysis.kind}:${analysis.summary}`;
    const entry = grouped.get(key) ?? { analysis, ids: [] };
    entry.ids.push(row.id);
    grouped.set(key, entry);
  }
  const gaps: CapabilityGap[] = [];
  for (const { analysis, ids } of grouped.values()) {
    gaps.push(
      await store.upsertGap({
        capabilityId,
        kind: analysis.kind,
        summary: analysis.summary,
        evidence: { experienceIds: ids.slice(0, 20), signal: analysis.signal },
        support: ids.length,
        status: analysis.kind === "model" ? "dismissed" : "open",
      }),
    );
  }
  return gaps.sort((a, b) => b.support - a.support);
}
