import type { ArmId, TaskAnalysis } from "../arms/types";
import { routableArms } from "../arms/registry";
import type { Capability } from "./types";

// Capability routing.
//
// The old router matched four regexes and returned a winner. Two things were
// wrong with that. It had no notion of how sure it was, so an objective that
// matched nothing and an objective that matched everything produced equally
// confident answers. And it returned a single capability, so "research X, then
// build Y" -- a compound task -- lost half of itself at the door.
//
// Here, heuristics only ever produce *candidates with scores*. Composition is
// derived by segmenting the objective and routing each segment, which handles
// compound tasks without a model call. A structured THINKING classification is
// escalated to only when the scores are genuinely ambiguous, because analysing
// "what time is it" costs a model call and buys nothing.

export type RoutingCandidate = {
  armId: ArmId;
  score: number;
};

export type RoutingDecision = {
  primary: ArmId;
  /** Ordered arms for a compound objective; one entry for a simple one. */
  composition: ArmId[];
  capabilities: Capability[];
  confidence: number;
  /** True when a structured classification was used to resolve ambiguity. */
  escalated: boolean;
  reason: string;
  analysis?: TaskAnalysis;
};

const CAPABILITY_BY_ARM: Record<ArmId, Capability> = {
  thinking: "general",
  coding: "coding",
  research: "research",
  math_science: "math_science",
  building: "general",
  general: "general",
};

const ARM_BY_CAPABILITY: Record<Capability, ArmId> = {
  general: "general",
  coding: "coding",
  research: "research",
  math_science: "math_science",
  data: "research",
  multimodal: "general",
  computer_use: "coding",
};

/** Sequencing connectives that separate one task from the next. */
const SEGMENT_PATTERN =
  /(?:\.\s+|\n+|;\s*|\s+(?:and then|then|afterwards|after that|next,?|followed by|und dann|danach|anschließend)\s+)/i;

export function segmentObjective(objective: string): string[] {
  const parts = objective
    .split(new RegExp(SEGMENT_PATTERN, "gi"))
    .map((part) => part.trim())
    .filter((part) => part.length > 12);
  return parts.length > 0 ? parts : [objective.trim()];
}

export function scoreCandidates(objective: string): RoutingCandidate[] {
  return routableArms()
    .map((arm) => ({
      armId: arm.id,
      score: Number(arm.canHandle({ objective, capabilities: [] }).toFixed(4)),
    }))
    .sort((a, b) => b.score - a.score || a.armId.localeCompare(b.armId));
}

export type AmbiguityReason =
  "low_confidence" | "close_contenders" | "long_objective" | null;

/**
 * Whether the heuristics are too unsure to be trusted on their own. Kept
 * separate and pure so the escalation policy can be tested without a provider.
 */
export function ambiguityOf(
  objective: string,
  candidates: RoutingCandidate[],
): AmbiguityReason {
  const [top, second] = candidates;
  if (!top || top.score < 0.3) return "low_confidence";
  if (second && top.score - second.score < 0.12) return "close_contenders";
  if (objective.length > 1200) return "long_objective";
  return null;
}

function compositionFromSegments(objective: string): {
  composition: ArmId[];
  perSegment: Array<{ segment: string; armId: ArmId; score: number }>;
} {
  const perSegment = segmentObjective(objective).map((segment) => {
    const [best] = scoreCandidates(segment);
    return {
      segment,
      armId: best?.armId ?? "general",
      score: best?.score ?? 0,
    };
  });

  // Keep order, drop consecutive duplicates, and ignore segments that only the
  // fallback claimed -- those are context for a neighbouring task, not a task.
  const composition: ArmId[] = [];
  for (const entry of perSegment) {
    if (entry.score < 0.3) continue;
    if (composition[composition.length - 1] === entry.armId) continue;
    composition.push(entry.armId);
  }
  return { composition, perSegment };
}

export function capabilitiesFor(composition: ArmId[]): Capability[] {
  const capabilities = composition.map((armId) => CAPABILITY_BY_ARM[armId]);
  return capabilities.length > 0 ? [...new Set(capabilities)] : ["general"];
}

export type Classifier = (objective: string) => Promise<TaskAnalysis>;

/**
 * Route an objective.
 *
 * `classify` is injected rather than imported so the composition logic can be
 * tested exhaustively without a network call, and so a caller that has no
 * provider configured degrades to the heuristic path instead of failing.
 */
export async function routeObjective(
  objective: string,
  options: { classify?: Classifier } = {},
): Promise<RoutingDecision> {
  const candidates = scoreCandidates(objective);
  const { composition, perSegment } = compositionFromSegments(objective);
  const heuristicPrimary = candidates[0]?.armId ?? "general";
  const ambiguity = ambiguityOf(objective, candidates);
  const compound = composition.length > 1;

  // A compound objective whose segments routed cleanly does not need a model:
  // the segmentation already produced the answer the classification would.
  if (
    !ambiguity ||
    (compound && perSegment.every((entry) => entry.score >= 0.3))
  ) {
    const ordered = compound ? composition : [heuristicPrimary];
    return {
      primary: ordered[0] ?? "general",
      composition: ordered,
      capabilities: capabilitiesFor(ordered),
      confidence: candidates[0]?.score ?? 0,
      escalated: false,
      reason: compound
        ? `Compound objective split into ${ordered.length} stages by segment routing.`
        : `Heuristic match on ${heuristicPrimary}.`,
    };
  }

  if (!options.classify) {
    const ordered = composition.length > 0 ? composition : [heuristicPrimary];
    return {
      primary: ordered[0] ?? "general",
      composition: ordered,
      capabilities: capabilitiesFor(ordered),
      confidence: candidates[0]?.score ?? 0,
      escalated: false,
      reason: `Ambiguous (${ambiguity}) but no classifier is available; using the heuristic match.`,
    };
  }

  try {
    const analysis = await options.classify(objective);
    const ordered = [
      ...new Set(
        analysis.capabilities.map(
          (capability) => ARM_BY_CAPABILITY[capability],
        ),
      ),
    ];
    const resolved = ordered.length > 0 ? ordered : [heuristicPrimary];
    return {
      primary: resolved[0] ?? "general",
      composition: resolved,
      capabilities: capabilitiesFor(resolved),
      confidence: analysis.complexity === "low" ? 0.8 : 0.65,
      escalated: true,
      reason: `Structured classification resolved ${ambiguity}.`,
      analysis,
    };
  } catch {
    // A classification failure must not fail the run. Fall back to the
    // heuristic answer and record that the escalation did not happen.
    const ordered = composition.length > 0 ? composition : [heuristicPrimary];
    return {
      primary: ordered[0] ?? "general",
      composition: ordered,
      capabilities: capabilitiesFor(ordered),
      confidence: candidates[0]?.score ?? 0,
      escalated: false,
      reason: `Classification failed; using the heuristic match for ${ambiguity}.`,
    };
  }
}
