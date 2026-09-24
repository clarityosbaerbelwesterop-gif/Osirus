import type { HypothesisSeed, TaskSeed } from "./task-state";

// M33: deep thinking / reasoning on the existing loop.
//
// Multi-step deliberation is expressed as structured hypotheses, VERIFY
// steps, and path-specific loop directives — not a second scheduler.

export type ReasoningPath = "direct" | "standard" | "adversarial" | "compound";

export type ReasoningProfile = {
  path: ReasoningPath;
  phases: string[];
  directives: string[];
};

const PHASES: Record<ReasoningPath, string[]> = {
  direct: ["answer"],
  standard: ["hypothesize", "verify", "finish"],
  adversarial: [
    "seed_rival_hypotheses",
    "gather_evidence",
    "verify_each_claim",
    "resolve_or_report_conflict",
    "finish",
  ],
  compound: [
    "decompose_subgoals",
    "evidence_per_segment",
    "cross_check_segments",
    "finish",
  ],
};

/**
 * Choose how much deliberation a gated task receives.
 *
 * Compound objectives and explicit contradictions get adversarial paths.
 * Tasks with structured success criteria get standard multi-step VERIFY.
 * Simple objectives stay direct.
 */
export function chooseReasoningPath(input: {
  objective: string;
  hypotheses?: HypothesisSeed[];
  task?: TaskSeed;
  compound?: boolean;
}): ReasoningPath {
  const text = input.objective.toLowerCase();
  const compound =
    input.compound ??
    /\b(then|and then|after that|first .+ then)\b/i.test(text);
  const adversarial =
    (input.hypotheses?.length ?? 0) >= 2 ||
    /\b(disagree|contradict|conflict|revise|two sources|both run)\b/i.test(
      text,
    ) ||
    ((input.task?.constraints?.length ?? 0) >= 2 &&
      (input.task?.unknowns?.length ?? 0) > 0);
  const gated =
    (input.hypotheses?.length ?? 0) > 0 ||
    (input.task?.successCriteria?.length ?? 0) > 0;

  if (compound && gated) return "compound";
  if (adversarial && gated) return "adversarial";
  if (gated) return "standard";
  return "direct";
}

export function reasoningDirectives(path: ReasoningPath): string[] {
  switch (path) {
    case "direct":
      return [];
    case "standard":
      return [
        "Form or use the seeded hypotheses before claiming a result.",
        "Each VERIFY must name the hypothesis ids the evidence bears on.",
        "Do not FINISH until verification and the hypothesis states agree with the answer.",
      ];
    case "adversarial":
      return [
        "Treat rival hypotheses as live until evidence falsifies or supports each one.",
        "VERIFY each hypothesis separately; never let one verified result move every open hypothesis.",
        "When evidence conflicts, FINISH by reporting the conflict — do not collapse it to one side.",
      ];
    case "compound":
      return [
        "This is a compound objective: gather evidence for each segment before synthesizing.",
        "Cross-check segment conclusions against the seeded hypotheses.",
        "FINISH only when every required segment has a VERIFY or an explicit unresolved note.",
      ];
  }
}

export function buildReasoningProfile(input: {
  objective: string;
  hypotheses?: HypothesisSeed[];
  task?: TaskSeed;
  compound?: boolean;
}): ReasoningProfile {
  const path = chooseReasoningPath(input);
  return {
    path,
    phases: PHASES[path],
    directives: reasoningDirectives(path),
  };
}
