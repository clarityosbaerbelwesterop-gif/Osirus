import type { LoopResult, LoopState } from "../loop";
import {
  allPulseBaselines,
  loadPulseBaselines,
  pulseBaselineFor,
} from "../pulse/state";
import type { CapabilityLane, CapabilityLevel } from "../pulse/lanes";
import { laneKey } from "../pulse/lanes";
import type { PulseBaselineCell } from "../pulse/types";

// In-loop RSI watchdog: compare live loop outcomes to the latest pulse
// baseline for a lane and feed regressions into experience. This does not
// replace the agent loop; it observes it.

export type RsiRegression = {
  lane: CapabilityLane;
  level: CapabilityLevel;
  kind: "verified_drop" | "success_drop" | "false_completion";
  baselineRate: number;
  observed: boolean;
  summary: string;
};

const MIN_BASELINE_SAMPLES = 1;

export function detectRegression(input: {
  lane: CapabilityLane;
  level: CapabilityLevel;
  verifiedSuccess: boolean;
  success: boolean;
  falseCompletion?: boolean;
}): RsiRegression | null {
  const baseline = pulseBaselineFor(input.lane, input.level);
  if (!baseline || baseline.sampleCount < MIN_BASELINE_SAMPLES) return null;
  if (input.falseCompletion && baseline.verifiedSuccessRate >= 0.75) {
    return {
      lane: input.lane,
      level: input.level,
      kind: "false_completion",
      baselineRate: baseline.verifiedSuccessRate,
      observed: true,
      summary: `${input.lane} L${input.level} finished with a false completion while pulse baseline verified rate is ${baseline.verifiedSuccessRate}.`,
    };
  }
  if (baseline.verifiedSuccessRate >= 0.5 && !input.verifiedSuccess) {
    return {
      lane: input.lane,
      level: input.level,
      kind: "verified_drop",
      baselineRate: baseline.verifiedSuccessRate,
      observed: false,
      summary: `${input.lane} L${input.level} missed verified success; pulse baseline verified rate is ${baseline.verifiedSuccessRate}.`,
    };
  }
  if (baseline.verifiedSuccessRate >= 0.75 && !input.success) {
    return {
      lane: input.lane,
      level: input.level,
      kind: "success_drop",
      baselineRate: baseline.verifiedSuccessRate,
      observed: false,
      summary: `${input.lane} L${input.level} failed while pulse baseline verified rate is ${baseline.verifiedSuccessRate}.`,
    };
  }
  return null;
}

export function gradeLoopOutcome(result: LoopResult) {
  const finished = result.status === "finished";
  const answer = result.answer ?? "";
  const verified =
    finished &&
    answer.length > 0 &&
    !/i don't know|cannot determine|unable to/i.test(answer);
  return {
    success: finished,
    verifiedSuccess: verified,
    falseCompletion:
      finished &&
      result.state.steps.some(
        (step) =>
          step.action === "FINISH" &&
          step.outcome === "ok" &&
          !verified,
      ),
  };
}

export async function feedRegressionExperience(input: {
  regression: RsiRegression;
  runId?: string;
}) {
  try {
    const { PgIntelStore } = await import("../../intelligence/store/pg-store");
    const { fingerprint } = await import("../../intelligence/evals/random");
    const store = new PgIntelStore();
    const settings = await store.settings();
    if (!settings.flags.intelligencePlane) return;
    await store.insertExperience({
      source: "benchmark",
      taskRef: input.runId ?? null,
      taskType: "general",
      capabilityIds: [`pulse.${input.regression.lane.toLowerCase()}`],
      difficulty: input.regression.level,
      strategyVersionId: null,
      model: null,
      skills: [],
      tools: [],
      trajectory: {
        arm: input.regression.lane,
        output: input.regression.summary,
      },
      verification: {
        verdicts: ["regression"],
        check: { passed: false, detail: input.regression.summary },
      },
      outcome: "failure",
      failureClass: `rsi:${input.regression.kind}`,
      repairs: 0,
      costUsd: 0,
      tokens: 0,
      latencyMs: 0,
      confidence: null,
      qualityScore: 0.8,
      fingerprint: fingerprint(
        "rsi",
        input.regression.lane,
        input.regression.level,
        input.regression.kind,
        input.runId ?? "anonymous",
      ),
      partition: null,
      provenance: { kind: "rsi_watchdog", runId: input.runId ?? null },
    });
    await store.upsertArtifact({
      cycleId: null,
      kind: "failure_pattern",
      capabilityId: `pulse.${input.regression.lane.toLowerCase()}`,
      taskPattern: laneKey(input.regression.lane, input.regression.level),
      content: {
        lane: input.regression.lane,
        level: input.regression.level,
        kind: input.regression.kind,
        baselineRate: input.regression.baselineRate,
        summary: input.regression.summary,
      },
      evidence: { runId: input.runId ?? null },
      support: 1,
      status: "proposed",
      fingerprint: fingerprint(
        "rsi-pattern",
        input.regression.lane,
        input.regression.level,
        input.regression.kind,
      ),
    });
  } catch {
    // Best effort: watchdog must never break the loop.
  }
}

export async function finalizeRsiWatchdog(input: {
  lane: CapabilityLane;
  level?: CapabilityLevel;
  result: LoopResult;
  runId: string;
}) {
  const level = input.level ?? 3;
  const graded = gradeLoopOutcome(input.result);
  const regression = detectRegression({
    lane: input.lane,
    level,
    ...graded,
  });
  if (!regression) return null;
  await feedRegressionExperience({ regression, runId: input.runId });
  return regression;
}

export function exportPulseBaselines(): PulseBaselineCell[] {
  return allPulseBaselines();
}

export function importPulseBaselines(cells: PulseBaselineCell[]) {
  loadPulseBaselines(cells);
}

/** Track in-loop step pressure without mutating the loop. */
export function trackLoopStep(_state: LoopState) {
  return null;
}
