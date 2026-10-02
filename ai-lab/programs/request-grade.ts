import { gradeArm } from "./behavior";
import type { Activity, CapabilityArm } from "./types";

/**
 * Grades a fixture that is actually in the request. A canned sample that the
 * request did not include is not a completion. This is not a benchmark score.
 */

export interface FixtureCheck {
  readonly armId: string;
  readonly phase: Activity | null;
  readonly passed: boolean;
  readonly detail: string;
}

function phasesForArm(armId: string): readonly Activity[] {
  const name = armId.toUpperCase();
  if (name.includes("RSI"))
    return ["reasoning", "deep_reasoning", "code_analysis"];
  if (name.includes("TERMINAL"))
    return ["code_analysis", "reasoning", "deep_reasoning"];
  if (name.includes("LONG_HORIZON"))
    return ["planning", "reasoning", "deep_reasoning"];
  if (
    name.includes("CYBER") ||
    name.includes("SECURITY") ||
    name.includes("VULN")
  ) {
    return ["security_scan", "code_analysis", "reasoning", "deep_reasoning"];
  }
  if (name.includes("TESTING")) {
    return ["test_execution", "code_analysis", "reasoning", "deep_reasoning"];
  }
  if (name.includes("MATH") || name.includes("LOGIC")) {
    return ["reasoning", "code_analysis", "deep_reasoning"];
  }
  if (
    name.includes("CODING") ||
    name.includes("DEBUG") ||
    name.includes("REPOSITORY") ||
    name.includes("REVIEW") ||
    name.includes("TEST") ||
    name.includes("DATABASE") ||
    name.includes("DEVOPS") ||
    name.includes("INFRASTRUCTURE") ||
    name.includes("ARCHITECTURE")
  ) {
    return [
      "code_analysis",
      "test_execution",
      "patch_verification",
      "reasoning",
      "deep_reasoning",
    ];
  }
  if (name.includes("TOOL")) return ["deep_reasoning", "planning", "reasoning"];
  if (name.includes("WORLD"))
    return ["deep_reasoning", "planning", "reasoning"];
  if (name.includes("MULTIMODAL")) return ["deep_reasoning", "reasoning"];
  if (name.includes("STRATEGY"))
    return ["planning", "deep_reasoning", "reasoning"];
  if (name.includes("THINK")) return ["thinking"];
  if (name.includes("REASON"))
    return ["reasoning", "deep_reasoning", "code_analysis"];
  if (name.includes("RESEARCH"))
    return ["research", "reasoning", "deep_reasoning"];
  if (name.includes("VERIF")) {
    return ["verification", "test_execution", "reasoning", "deep_reasoning"];
  }
  if (name.includes("PLAN")) return ["planning", "reasoning", "deep_reasoning"];
  if (name.includes("MEMORY")) return ["reasoning", "deep_reasoning"];
  if (name.includes("SCIENCE"))
    return ["research", "reasoning", "deep_reasoning"];
  return [];
}

function isBoundary(char: string): boolean {
  return char.length === 0 || !/[A-Za-z0-9_]/.test(char);
}

/** The sample input appears as its own span, not inside a longer token. */
export function containsFixtureSpan(text: string, needle: string): boolean {
  if (!needle) return false;
  let from = 0;
  while (from <= text.length) {
    const at = text.indexOf(needle, from);
    if (at < 0) return false;
    const before = at === 0 ? "" : (text[at - 1] ?? "");
    const afterAt = at + needle.length;
    const after = afterAt >= text.length ? "" : (text[afterAt] ?? "");
    if (isBoundary(before) && isBoundary(after)) return true;
    from = at + 1;
  }
  return false;
}

/** Longest dataset fixture contained in the request. Not a default sample. */
export function sampleInRequest(
  arm: CapabilityArm,
  text: string,
): { input: string; target: string } | null {
  const hits = arm.dataset.samples.filter((sample) =>
    containsFixtureSpan(text, sample.input),
  );
  hits.sort((left, right) => right.input.length - left.input.length);
  const sample = hits[0];
  if (!sample) return null;
  return { input: sample.input, target: sample.target };
}

export function phaseForArm(
  armId: string,
  phases: readonly Activity[],
): Activity | null {
  return phasesForArm(armId).find((phase) => phases.includes(phase)) ?? null;
}

export function gradeRequestFixtures(
  arms: readonly CapabilityArm[],
  text: string,
  phases: readonly Activity[],
): FixtureCheck[] {
  const checks: FixtureCheck[] = [];
  for (const arm of arms) {
    const sample = sampleInRequest(arm, text);
    if (!sample) continue;
    const graded = gradeArm(arm.task.grader, sample);
    checks.push({
      armId: arm.id,
      phase: phaseForArm(arm.id, phases),
      passed: graded.passed,
      detail: graded.detail,
    });
  }
  return checks;
}

const ARM_LABEL = /^(?:ROUGE|QUASNIR|DARUS)_[A-Z0-9_]+$/;

/** The provider named an arm and did not run the fixture. */
export function fallbackLabeledArmOnly(
  modelText: string,
  armIds: readonly string[],
): boolean {
  const trimmed = modelText.trim();
  if (!trimmed || trimmed.includes("\n")) return false;
  if (armIds.includes(trimmed)) return true;
  if (ARM_LABEL.test(trimmed)) return true;
  return /^program arm selected$/i.test(trimmed);
}

export function graderLines(checks: readonly FixtureCheck[]): string {
  return checks
    .map((check) => {
      const verdict = check.passed ? "pass" : "fail";
      return check.phase
        ? `${check.phase} · ${check.armId}: ${verdict}`
        : `${check.armId}: ${verdict}`;
    })
    .join("\n");
}

export function markSkippedFixtures(
  checks: readonly FixtureCheck[],
): FixtureCheck[] {
  return checks.map((check) => ({
    ...check,
    passed: false,
    detail: "fixture skipped",
  }));
}
