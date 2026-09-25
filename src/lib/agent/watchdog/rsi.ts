import type { VerdictStatus } from "../../verification/engine";
import {
  deriveOutcome,
  type CapabilityOutcome,
  type DerivedOutcome,
} from "../../verification/outcome";
import type { LoopResult } from "../loop";
import { laneKey, type CapabilityLane } from "../pulse/lanes";
import type { PulseStore } from "../pulse/store";
import type { PulseRegression } from "../pulse/types";
import {
  assessCell,
  confirmedRegression,
  nextStreak,
  WINDOW,
  windowStats,
} from "./window";

// The RSI watchdog.
//
// It no longer draws a conclusion from one run. A loop's outcome is derived
// from evidence and recorded (on the stage and in the product experience);
// regressions are decided over windows of outcomes, when a pulse cycle
// completes: the pulse's own cells, and product runs per family. A
// confirmed regression becomes experience and a failure pattern the
// Foundry's gap detector picks up. The watchdog never changes a policy.

const RESOLUTION_CLAIM =
  /\b(all (tests|constraints|criteria) (pass|are met|are satisfied)|fully (fixed|done)|is fixed|completed successfully|shipped)\b/i;

/** The canonical outcome of one loop, from what the loop itself recorded. */
export function gradeLoopOutcome(result: LoopResult): DerivedOutcome {
  const kernel = result.state.kernel;
  const status = kernel?.verificationState.status;
  const verdicts: VerdictStatus[] =
    status === "verified"
      ? ["verified"]
      : status === "rejected"
        ? ["rejected"]
        : [];
  const verifySteps = result.state.steps.filter(
    (step) => step.action === "VERIFY",
  );
  const refusedFinish = result.state.observations.some((entry) =>
    entry.includes("loop.finish_gate"),
  );
  const answer = result.answer ?? "";
  return deriveOutcome({
    infrastructureError: result.refusal
      ? `provider:${result.refusal.code}`
      : null,
    finished: result.status === "finished" && answer.trim().length > 0,
    claimedSuccess: RESOLUTION_CLAIM.test(answer),
    verdicts,
    finishGateRefused: refusedFinish && result.status !== "finished",
    verifiedWithoutVerifier:
      verifySteps.length > 0 &&
      verifySteps.every((step) => /no verifier/i.test(step.detail ?? "")),
    hypotheses: kernel
      ? {
          confirmed: kernel.hypotheses.filter((h) =>
            ["SUPPORTED", "CONFIRMED"].includes(h.status),
          ).length,
          rejected: kernel.hypotheses.filter((h) => h.status === "REJECTED")
            .length,
          open: kernel.hypotheses.filter((h) => h.status === "OPEN").length,
        }
      : undefined,
  });
}

/** Product outcomes of a family, oldest first, from the experience rows. */
export function productOutcomeOf(row: {
  outcome: string;
  verification: { capabilityOutcome?: CapabilityOutcome };
}): CapabilityOutcome {
  if (row.verification.capabilityOutcome)
    return row.verification.capabilityOutcome;
  switch (row.outcome) {
    case "verified_success":
      return "VERIFIED_SUCCESS";
    case "success":
      return "SUCCESS_UNVERIFIED";
    case "false_completion":
      return "FALSE_COMPLETION";
    case "error":
      return "INFRASTRUCTURE_FAILURE";
    default:
      return "REJECTED";
  }
}

/** Product runs are not levelled; their windows live in this cell. */
export const PRODUCT_SUITE = "product";
const PRODUCT_LEVEL = 3 as const;

const ARM_FAMILIES: Array<[string, CapabilityLane]> = [
  ["arm.thinking", "THINKING"],
  ["arm.general", "REASONING"],
  ["arm.coding", "CODING"],
  ["arm.research", "RESEARCH"],
  ["arm.math_science", "MATH_SCIENCE"],
  ["arm.building", "BUILDING"],
];

/** Windowed regressions over product runs, one cell per arm family. */
export async function productRegressions(input: {
  pulse: PulseStore;
  listExperience: (filter: {
    capabilityId: string;
    source: "product";
    since: string;
    limit: number;
  }) => Promise<
    Array<{
      outcome: string;
      verification: { capabilityOutcome?: CapabilityOutcome };
      createdAt: string;
    }>
  >;
  now?: number;
}): Promise<PulseRegression[]> {
  const since = new Date(
    (input.now ?? Date.now()) - 14 * 24 * 60 * 60 * 1000,
  ).toISOString();
  const regressions: PulseRegression[] = [];
  for (const [capabilityId, family] of ARM_FAMILIES) {
    const rows = await input.listExperience({
      capabilityId,
      source: "product",
      since,
      limit: WINDOW.reference + WINDOW.recent,
    });
    if (!rows.length) continue;
    const observations = [...rows]
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map((row) => ({ outcome: productOutcomeOf(row) }));
    const assessment = assessCell(observations);
    const previous = await input.pulse.baseline(
      PRODUCT_SUITE,
      family,
      PRODUCT_LEVEL,
    );
    const streak = nextStreak(previous?.regressionStreak ?? 0, assessment);
    const whole = windowStats(observations);
    await input.pulse.saveBaseline({
      suiteVersion: PRODUCT_SUITE,
      family,
      level: PRODUCT_LEVEL,
      samples: whole.samples,
      verified: whole.verified,
      falseCompletions: whole.falseCompletions,
      excluded: whole.excluded,
      rate: whole.rate,
      lower: whole.lower,
      upper: whole.upper,
      regressionStreak: streak,
    });
    if (assessment.signal && confirmedRegression(streak))
      regressions.push({
        family,
        level: PRODUCT_LEVEL,
        kind: assessment.signal,
        referenceRate: assessment.reference.rate,
        recentRate: assessment.recent.rate,
        probabilityWorse: assessment.probabilityWorse,
        streak,
        source: "product",
      });
  }
  return regressions;
}

/**
 * A confirmed regression, as experience and a failure pattern for the
 * Foundry. Only when the Intelligence Plane is on; best effort.
 */
export async function feedRegressionExperience(
  regression: PulseRegression,
  cycleId: string | null,
) {
  try {
    const { PgIntelStore } = await import("../../intelligence/store/pg-store");
    const { fingerprint } = await import("../../intelligence/evals/random");
    const store = new PgIntelStore();
    const settings = await store.settings();
    if (!settings.flags.intelligencePlane) return;
    const capabilityId = `pulse.${regression.family.toLowerCase()}`;
    const summary = `${regression.source} ${laneKey(regression.family, regression.level)}: verified rate ${regression.referenceRate} → ${regression.recentRate} (P(worse) ${regression.probabilityWorse}, confirmed ${regression.streak}×).`;
    await store.insertExperience({
      source: "benchmark",
      taskRef: cycleId,
      taskType: "general",
      capabilityIds: [capabilityId],
      difficulty: regression.level,
      strategyVersionId: null,
      model: null,
      skills: [],
      tools: [],
      trajectory: { arm: regression.family, output: summary },
      verification: {
        verdicts: ["regression"],
        check: { passed: false, detail: summary },
        capabilityOutcome: "REJECTED",
        reason: regression.kind,
      },
      outcome: "failure",
      failureClass: `rsi:${regression.kind}`,
      repairs: 0,
      costUsd: 0,
      tokens: 0,
      latencyMs: 0,
      confidence: regression.probabilityWorse,
      qualityScore: 0.8,
      fingerprint: fingerprint(
        "rsi",
        regression.source,
        regression.family,
        regression.level,
        regression.kind,
        cycleId ?? "none",
      ),
      partition: null,
      provenance: { kind: "rsi_watchdog", source: regression.source },
    });
    await store.upsertArtifact({
      cycleId: null,
      kind: "failure_pattern",
      capabilityId,
      taskPattern: laneKey(regression.family, regression.level),
      content: { ...regression, summary },
      evidence: { cycleId },
      support: regression.streak,
      status: "proposed",
      fingerprint: fingerprint(
        "rsi-pattern",
        regression.source,
        regression.family,
        regression.level,
        regression.kind,
      ),
    });
  } catch {
    // The watchdog must never break the tick.
  }
}
