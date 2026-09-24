export type MemoryTier = "working" | "second" | "third";
export type MemoryDecision =
  | "DROP"
  | "WORKING_ONLY"
  | "PROMOTE_SECOND_BRAIN"
  | "DISTILL_THIRD_BRAIN"
  | "UPDATE_EXISTING"
  | "MARK_CONFLICT";

export type MemoryItem = {
  id: string;
  workspaceId?: string | null;
  tier: MemoryTier;
  kind: string;
  content: string;
  source: Record<string, unknown> | string;
  verifiedAt?: string;
  updatedAt: string;
  confidence?: number;
  importance?: number;
  subjectKey?: string | null;
  canonicalValue?: string | null;
  verificationStatus?: "unverified" | "verified" | "conflicted" | "rejected";
  contradictionStatus?: "none" | "suspected" | "resolved";
};

export type MemoryCompileInput = {
  content: string;
  kind: MemoryItem["kind"] | "transient";
  scope?: "user" | "workspace" | "organization" | "session";
  source: Record<string, unknown> | string;
  confidence?: number;
  importance?: number;
  verified?: boolean;
  authoritative?: boolean;
  recurring?: boolean;
  novel?: boolean;
  private?: boolean;
  subjectKey?: string | null;
  canonicalValue?: string | null;
  /**
   * Memory Compiler V2 policy: an outcome that was not verified is kept for
   * the run and never promoted. Set for everything derived from a run.
   */
  requireVerified?: boolean;
};

export type MemoryCompileResult = {
  decision: MemoryDecision;
  reason: string;
  existingMemoryId?: string;
};

/**
 * Promotion is conservative: a run does not become a transcript-shaped
 * database. Conflicting canonical facts remain explicitly marked until an
 * authoritative update resolves them.
 */
export function compileMemoryCandidate(
  candidate: MemoryCompileInput,
  existing: MemoryItem[] = [],
): MemoryCompileResult {
  const content = candidate.content.trim();
  const importance = candidate.importance ?? 0.5;
  const confidence = candidate.confidence ?? 0.5;
  if (!content || candidate.private) {
    return { decision: "DROP", reason: "empty_or_private" };
  }
  if (
    candidate.kind === "transient" ||
    (importance < 0.2 && !candidate.recurring)
  ) {
    return { decision: "WORKING_ONLY", reason: "low_future_utility" };
  }
  if (candidate.requireVerified && !candidate.verified) {
    return {
      decision: "WORKING_ONLY",
      reason: "unverified_outcome_not_promoted",
    };
  }

  const sameSubject = candidate.subjectKey
    ? existing.filter((item) => item.subjectKey === candidate.subjectKey)
    : [];
  const conflict = sameSubject.find(
    (item) =>
      item.canonicalValue &&
      candidate.canonicalValue &&
      item.canonicalValue !== candidate.canonicalValue &&
      item.verificationStatus !== "rejected",
  );
  if (conflict) {
    return {
      decision: "MARK_CONFLICT",
      reason: "canonical_value_disagrees_with_existing_memory",
      existingMemoryId: conflict.id,
    };
  }

  const duplicate = sameSubject.find(
    (item) => item.canonicalValue === candidate.canonicalValue,
  );
  if (duplicate) {
    return {
      decision: "UPDATE_EXISTING",
      reason: "candidate_confirms_existing_memory",
      existingMemoryId: duplicate.id,
    };
  }

  if (
    candidate.authoritative &&
    candidate.verified &&
    confidence >= 0.75 &&
    importance >= 0.75 &&
    (candidate.recurring ||
      candidate.scope === "workspace" ||
      candidate.scope === "organization")
  ) {
    return {
      decision: "DISTILL_THIRD_BRAIN",
      reason: "verified_reusable_knowledge",
    };
  }

  if (candidate.novel === false && importance < 0.45) {
    return { decision: "WORKING_ONLY", reason: "low_novelty" };
  }
  return {
    decision: "PROMOTE_SECOND_BRAIN",
    reason: "useful_structured_knowledge",
  };
}

/** Backwards-compatible one-item compiler entry point. */
export function compileMemory(
  item: MemoryItem,
  existing?: MemoryItem,
): MemoryDecision {
  return compileMemoryCandidate(
    {
      content: item.content,
      kind: item.kind,
      source: item.source,
      confidence: item.confidence,
      importance: item.importance,
      verified: Boolean(item.verifiedAt),
      subjectKey: item.subjectKey,
      canonicalValue: item.canonicalValue,
    },
    existing ? [existing] : [],
  ).decision;
}

export {
  temporalDecay,
  temporalScore,
  rankByTemporal,
  DEFAULT_HALF_LIFE_MS,
} from "./temporal";
export {
  extractCausalGraph,
  renderCausalNarrative,
  type CausalEvent,
  type CausalLink,
  type CausalEventKind,
  type CausalLinkType,
} from "./causal";
export {
  buildCausalWorldModelFromOutcome,
  assembleCausalWorldModel,
  formatCausalContext,
  type CausalWorldModel,
} from "./causal-world-model";

export function lexicalRetrieve(query: string, items: MemoryItem[], limit = 8) {
  const terms = query.toLowerCase().split(/\W+/).filter(Boolean);
  return items
    .map((item) => ({
      item,
      score: terms.reduce(
        (score, term) =>
          score + (item.content.toLowerCase().includes(term) ? 1 : 0),
        0,
      ),
    }))
    .filter((candidate) => candidate.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, limit)
    .map((candidate) => candidate.item);
}
