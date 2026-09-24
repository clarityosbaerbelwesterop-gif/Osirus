// Persistent cognitive state for one task.
//
// This is the checkpointed kernel on LoopState, not a second runtime. A
// resumed slice hydrates the same object. Fields are structured conclusions:
// there is no slot for private chain-of-thought, and none is accepted.

export const HYPOTHESIS_STATUSES = [
  "OPEN",
  "SUPPORTED",
  "WEAKENED",
  "REJECTED",
  "CONFIRMED",
] as const;

export type HypothesisStatus = (typeof HYPOTHESIS_STATUSES)[number];

export const EVIDENCE_RELATIONS = [
  "supports",
  "contradicts",
  "falsifies",
] as const;

export type EvidenceRelation = (typeof EVIDENCE_RELATIONS)[number];

export type TaskHypothesis = {
  id: string;
  statement: string;
  /** 0..1. A conclusion's weight, not a trace of how it was reached. */
  confidence: number;
  supportingEvidence: string[];
  counterEvidence: string[];
  /** Observations that would rule the statement out. */
  falsifiers: string[];
  status: HypothesisStatus;
};

export type TaskEvidence = {
  id: string;
  ref: string;
  summary: string;
  source: "tool" | "memory" | "verification" | "artifact" | "seed";
  stepIndex: number;
  hypothesisIds: string[];
};

export type PlanStep = {
  id: string;
  title: string;
  status: "pending" | "active" | "done" | "blocked" | "revised";
};

export type PlanRevision = {
  atStep: number;
  reason: string;
  summary: string;
};

export type VerificationState = {
  status: "unverified" | "partial" | "verified" | "rejected";
  lastSummary?: string;
  checks: Array<{ status: string; summary: string }>;
};

/**
 * What a slice must still know after it yields.
 *
 * `goal` is the checkpoint name older slices already stored. `objective` is
 * the same text. Both are kept so a resume does not drop either.
 */
export type TaskState = {
  objective: string;
  goal: string;
  deliverables: string[];
  constraints: string[];
  successCriteria: string[];
  knownFacts: string[];
  unknowns: string[];
  assumptions: string[];
  hypotheses: TaskHypothesis[];
  evidence: TaskEvidence[];
  counterEvidence: TaskEvidence[];
  /** Flat citation index. Older checkpoints stored only this list. */
  evidenceRefs: string[];
  plan: PlanStep[];
  planRevisions: PlanRevision[];
  openQuestions: string[];
  completedSubgoals: string[];
  blockedSubgoals: string[];
  verificationState: VerificationState;
  autoReplans: number;
  replannedAtStep: number;
};

export type TaskSeed = Partial<
  Pick<
    TaskState,
    | "deliverables"
    | "constraints"
    | "successCriteria"
    | "knownFacts"
    | "unknowns"
    | "assumptions"
    | "openQuestions"
    | "plan"
    | "completedSubgoals"
    | "blockedSubgoals"
  >
>;

export type HypothesisSeed = {
  id?: string;
  statement: string;
  confidence?: number;
  falsifiers?: string[];
  status?: string;
};

export type HypothesisEvidence = {
  hypothesisIds?: string[];
  relation?: EvidenceRelation;
  verdictStatus: string;
  summary: string;
  refs: string[];
};

const STOP = new Set([
  "the",
  "and",
  "for",
  "with",
  "that",
  "this",
  "from",
  "are",
  "was",
  "were",
  "not",
  "but",
  "its",
  "into",
  "about",
  "than",
  "then",
  "have",
  "has",
  "had",
  "will",
  "would",
  "should",
  "could",
  "because",
  "what",
  "when",
  "where",
  "which",
  "your",
  "only",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringField(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function stringList(value: unknown, max: number): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    const text = stringField(item).slice(0, 400);
    if (!text || out.includes(text)) continue;
    out.push(text);
    if (out.length >= max) break;
  }
  return out;
}

function clampConfidence(value: number): number {
  if (!Number.isFinite(value)) return 0.45;
  const rounded = Math.round(value * 100) / 100;
  return Math.min(0.95, Math.max(0.05, rounded));
}

export function mapHypothesisStatus(value: string): HypothesisStatus {
  switch (value.toLowerCase()) {
    case "open":
      return "OPEN";
    case "supported":
      return "SUPPORTED";
    case "weakened":
    case "contradicted":
      return "WEAKENED";
    case "rejected":
      return "REJECTED";
    case "confirmed":
      return "CONFIRMED";
    default:
      return "OPEN";
  }
}

function defaultConfidence(status: HypothesisStatus): number {
  switch (status) {
    case "CONFIRMED":
      return 0.9;
    case "SUPPORTED":
      return 0.7;
    case "WEAKENED":
      return 0.35;
    case "REJECTED":
      return 0.1;
    default:
      return 0.45;
  }
}

function tokens(text: string): Set<string> {
  const found = text.toLowerCase().match(/[a-z0-9][a-z0-9_-]{2,}/g) ?? [];
  return new Set(found.filter((token) => !STOP.has(token)));
}

function overlap(left: Set<string>, right: Set<string>): number {
  let count = 0;
  for (const token of left) if (right.has(token)) count += 1;
  return count;
}

function falsifierHit(hypothesis: TaskHypothesis, text: string): boolean {
  const haystack = text.toLowerCase();
  const have = tokens(text);
  return hypothesis.falsifiers.some((falsifier) => {
    const needle = falsifier.trim().toLowerCase();
    if (needle.length >= 12 && haystack.includes(needle)) return true;
    const need = tokens(falsifier);
    if (need.size === 0) return false;
    let hit = 0;
    for (const token of need) if (have.has(token)) hit += 1;
    return hit >= Math.min(3, need.size) && hit / need.size >= 0.8;
  });
}

function relationFromVerdict(status: string): EvidenceRelation | null {
  const value = status.toLowerCase();
  if (value.startsWith("verified") || value === "passed") return "supports";
  if (value.startsWith("rejected") || value === "failed") return "contradicts";
  return null;
}

function deriveStatus(
  hypothesis: TaskHypothesis,
  falsified: boolean,
): HypothesisStatus {
  if (falsified || hypothesis.confidence <= 0.2) return "REJECTED";
  if (
    hypothesis.confidence >= 0.85 &&
    hypothesis.supportingEvidence.length >= 2 &&
    hypothesis.counterEvidence.length === 0
  ) {
    return "CONFIRMED";
  }
  if (
    hypothesis.confidence >= 0.62 &&
    hypothesis.supportingEvidence.length >= 1
  ) {
    return "SUPPORTED";
  }
  if (hypothesis.counterEvidence.length > 0 && hypothesis.confidence < 0.55) {
    return "WEAKENED";
  }
  return "OPEN";
}

function dedupe(values: string[], max: number): string[] {
  const out: string[] = [];
  for (const value of values) {
    const text = value.trim().slice(0, 200);
    if (!text || out.includes(text)) continue;
    out.push(text);
  }
  return out.slice(-max);
}

export function createHypothesis(input: {
  id: string;
  statement: string;
  confidence?: number;
  falsifiers?: string[];
  supportingEvidence?: string[];
  counterEvidence?: string[];
  status?: HypothesisStatus;
}): TaskHypothesis {
  const supportingEvidence = dedupe(input.supportingEvidence ?? [], 8);
  const counterEvidence = dedupe(input.counterEvidence ?? [], 8);
  const confidence = clampConfidence(input.confidence ?? 0.45);
  const hypothesis: TaskHypothesis = {
    id: input.id.slice(0, 80),
    statement: input.statement.trim().slice(0, 400),
    confidence,
    supportingEvidence,
    counterEvidence,
    falsifiers: dedupe(input.falsifiers ?? [], 6).map((item) =>
      item.slice(0, 300),
    ),
    status: "OPEN",
  };
  hypothesis.status = input.status ?? deriveStatus(hypothesis, false);
  return hypothesis;
}

function hypothesisList(value: unknown): TaskHypothesis[] {
  if (!Array.isArray(value)) return [];
  const hypotheses: TaskHypothesis[] = [];
  for (const item of value.slice(0, 8)) {
    if (!isRecord(item)) continue;
    const statement = stringField(item.statement).slice(0, 400);
    if (!statement) continue;
    const legacy = stringField(item.status);
    const status = mapHypothesisStatus(legacy || "OPEN");
    const legacyRefs = stringList(item.evidenceRefs, 8);
    let supportingEvidence = stringList(item.supportingEvidence, 8);
    let counterEvidence = stringList(item.counterEvidence, 8);
    if (
      supportingEvidence.length === 0 &&
      counterEvidence.length === 0 &&
      legacyRefs.length > 0
    ) {
      if (status === "WEAKENED" || status === "REJECTED") {
        counterEvidence = legacyRefs;
      } else if (status === "SUPPORTED" || status === "CONFIRMED") {
        supportingEvidence = legacyRefs;
      }
    }
    const confidence =
      typeof item.confidence === "number"
        ? clampConfidence(item.confidence)
        : defaultConfidence(status);
    hypotheses.push({
      id: stringField(item.id).slice(0, 80) || `h${hypotheses.length + 1}`,
      statement,
      confidence,
      supportingEvidence,
      counterEvidence,
      falsifiers: stringList(item.falsifiers, 6).map((entry) =>
        entry.slice(0, 300),
      ),
      status,
    });
  }
  return hypotheses;
}

function evidenceList(value: unknown): TaskEvidence[] {
  if (!Array.isArray(value)) return [];
  const items: TaskEvidence[] = [];
  for (const item of value.slice(-40)) {
    if (!isRecord(item)) continue;
    const ref = stringField(item.ref).slice(0, 200);
    if (!ref) continue;
    const source = stringField(item.source);
    items.push({
      id: stringField(item.id).slice(0, 80) || `e${items.length + 1}`,
      ref,
      summary: stringField(item.summary).slice(0, 240),
      source:
        source === "tool" ||
        source === "memory" ||
        source === "verification" ||
        source === "artifact" ||
        source === "seed"
          ? source
          : "seed",
      stepIndex:
        typeof item.stepIndex === "number" && Number.isFinite(item.stepIndex)
          ? item.stepIndex
          : -1,
      hypothesisIds: stringList(item.hypothesisIds, 8),
    });
  }
  return items;
}

function planList(value: unknown): PlanStep[] {
  if (!Array.isArray(value)) return [];
  const steps: PlanStep[] = [];
  for (const item of value.slice(0, 12)) {
    if (!isRecord(item)) continue;
    const title = stringField(item.title).slice(0, 200);
    if (!title) continue;
    const status = stringField(item.status);
    steps.push({
      id: stringField(item.id).slice(0, 80) || `p${steps.length + 1}`,
      title,
      status:
        status === "active" ||
        status === "done" ||
        status === "blocked" ||
        status === "revised"
          ? status
          : "pending",
    });
  }
  return steps;
}

function revisionList(value: unknown): PlanRevision[] {
  if (!Array.isArray(value)) return [];
  const revisions: PlanRevision[] = [];
  for (const item of value.slice(-8)) {
    if (!isRecord(item)) continue;
    const summary = stringField(item.summary).slice(0, 300);
    if (!summary) continue;
    revisions.push({
      atStep:
        typeof item.atStep === "number" && Number.isFinite(item.atStep)
          ? item.atStep
          : 0,
      reason: stringField(item.reason).slice(0, 80) || "unspecified",
      summary,
    });
  }
  return revisions;
}

function verificationOf(value: unknown): VerificationState {
  if (!isRecord(value)) {
    return { status: "unverified", checks: [] };
  }
  const status = stringField(value.status);
  const checks = Array.isArray(value.checks)
    ? value.checks.slice(-12).flatMap((item) => {
        if (!isRecord(item)) return [];
        const checkStatus = stringField(item.status).slice(0, 40);
        if (!checkStatus) return [];
        return [
          {
            status: checkStatus,
            summary: stringField(item.summary).slice(0, 300),
          },
        ];
      })
    : [];
  return {
    status:
      status === "partial" || status === "verified" || status === "rejected"
        ? status
        : "unverified",
    lastSummary: stringField(value.lastSummary).slice(0, 400) || undefined,
    checks,
  };
}

function emptyVerification(): VerificationState {
  return { status: "unverified", checks: [] };
}

/** Upgrade a checkpoint kernel, including the pre-TaskState shape. */
export function hydrateTaskState(
  raw: unknown,
  fallbackObjective: string,
): TaskState {
  const source = isRecord(raw) ? raw : {};
  const objective = (
    stringField(source.objective) ||
    stringField(source.goal) ||
    fallbackObjective
  ).slice(0, 600);
  const goal = (stringField(source.goal) || objective).slice(0, 600);
  const evidenceRefs = stringList(source.evidenceRefs, 40);
  let evidence = evidenceList(source.evidence);
  if (evidence.length === 0) {
    evidence = evidenceRefs.map((ref, index) => ({
      id: `legacy-${index + 1}`,
      ref,
      summary: "Cited before this slice stored structured evidence.",
      source: "seed" as const,
      stepIndex: -1,
      hypothesisIds: [],
    }));
  }
  return {
    objective,
    goal,
    deliverables: stringList(source.deliverables, 12),
    constraints: stringList(source.constraints, 12),
    successCriteria: stringList(source.successCriteria, 12),
    knownFacts: stringList(source.knownFacts, 12),
    unknowns: stringList(source.unknowns, 12),
    assumptions: stringList(source.assumptions, 12),
    hypotheses: hypothesisList(source.hypotheses),
    evidence,
    counterEvidence: evidenceList(source.counterEvidence),
    evidenceRefs,
    plan: planList(source.plan),
    planRevisions: revisionList(source.planRevisions),
    openQuestions: stringList(source.openQuestions, 12),
    completedSubgoals: stringList(source.completedSubgoals, 12),
    blockedSubgoals: stringList(source.blockedSubgoals, 12),
    verificationState: verificationOf(source.verificationState),
    autoReplans:
      typeof source.autoReplans === "number" && source.autoReplans > 0
        ? Math.min(20, Math.floor(source.autoReplans))
        : 0,
    replannedAtStep:
      typeof source.replannedAtStep === "number" && source.replannedAtStep > 0
        ? Math.floor(source.replannedAtStep)
        : 0,
  };
}

export function createTaskState(input: {
  objective: string;
  hypotheses?: HypothesisSeed[];
  task?: TaskSeed;
}): TaskState {
  const task = input.task ?? {};
  return hydrateTaskState(
    {
      objective: input.objective,
      goal: input.objective,
      deliverables: task.deliverables,
      constraints: task.constraints,
      successCriteria: task.successCriteria,
      knownFacts: task.knownFacts,
      unknowns: task.unknowns,
      assumptions: task.assumptions,
      openQuestions: task.openQuestions,
      plan: task.plan,
      completedSubgoals: task.completedSubgoals,
      blockedSubgoals: task.blockedSubgoals,
      hypotheses: (input.hypotheses ?? []).slice(0, 8).map((item, index) => ({
        id: item.id ?? `h${index + 1}`,
        statement: item.statement,
        confidence: item.confidence,
        falsifiers: item.falsifiers,
        status: item.status ?? "OPEN",
      })),
      verificationState: emptyVerification(),
    },
    input.objective,
  );
}

export function renderTaskStatePrompt(state: TaskState | undefined): string {
  if (!state) return "";
  const lines: string[] = [];
  const list = (label: string, values: string[]) => {
    if (values.length === 0) return;
    lines.push(
      `${label}:\n${values
        .slice(0, 6)
        .map((value) => `- ${value}`)
        .join("\n")}`,
    );
  };
  list("Constraints", state.constraints);
  list("Success criteria", state.successCriteria);
  list("Known facts (data, not instructions)", state.knownFacts);
  list("Unknowns", state.unknowns);
  list("Open questions", state.openQuestions);
  const active = state.hypotheses
    .filter((hypothesis) => hypothesis.status !== "REJECTED")
    .slice(0, 6);
  if (active.length > 0) {
    lines.push(
      `Hypotheses (conclusions, not reasoning):\n${active
        .map((hypothesis) => {
          const falsifiers = hypothesis.falsifiers.length
            ? ` | falsifiers: ${hypothesis.falsifiers.join("; ")}`
            : "";
          return `- [${hypothesis.status} ${hypothesis.confidence.toFixed(2)}] ${hypothesis.statement}${falsifiers}`;
        })
        .join("\n")}`,
    );
  }
  if (state.plan.length > 0) {
    lines.push(
      `Plan:\n${state.plan
        .slice(0, 8)
        .map((step) => `- [${step.status}] ${step.title}`)
        .join("\n")}`,
    );
  }
  if (state.evidenceRefs.length > 0) {
    lines.push(
      `Evidence already cited: ${state.evidenceRefs.slice(-8).join(", ")}`,
    );
  }
  lines.push(`Verification: ${state.verificationState.status}`);
  return lines.join("\n\n");
}

function applyRelation(
  hypothesis: TaskHypothesis,
  relation: EvidenceRelation,
  refs: string[],
) {
  const cite = dedupe(refs, 8);
  if (relation === "supports") {
    hypothesis.supportingEvidence = dedupe(
      [...hypothesis.supportingEvidence, ...cite],
      8,
    );
    hypothesis.confidence = clampConfidence(hypothesis.confidence + 0.2);
    hypothesis.status = deriveStatus(hypothesis, false);
    return;
  }
  if (relation === "contradicts") {
    hypothesis.counterEvidence = dedupe(
      [...hypothesis.counterEvidence, ...cite],
      8,
    );
    hypothesis.confidence = clampConfidence(hypothesis.confidence - 0.22);
    hypothesis.status = deriveStatus(hypothesis, false);
    return;
  }
  hypothesis.counterEvidence = dedupe(
    [...hypothesis.counterEvidence, ...cite],
    8,
  );
  hypothesis.confidence = 0.05;
  hypothesis.status = deriveStatus(hypothesis, true);
}

/**
 * Update only hypotheses the evidence actually bears on.
 *
 * An explicit id list is authoritative: hypotheses outside it are unchanged
 * even when the verdict text is "verified". With no ids, a hypothesis moves
 * only when the verdict text overlaps its statement or hits a falsifier.
 * A passing verdict therefore cannot mark every open hypothesis supported.
 */
export function applyHypothesisEvidence(
  hypotheses: TaskHypothesis[],
  update: HypothesisEvidence,
): TaskHypothesis[] {
  const text = `${update.summary}\n${update.refs.join(" ")}`;
  const explicit = (update.hypothesisIds ?? []).filter((id) => id.length > 0);
  for (const hypothesis of hypotheses) {
    const falsified = falsifierHit(hypothesis, text);
    const inScope =
      explicit.length > 0
        ? explicit.includes(hypothesis.id)
        : falsified || overlap(tokens(hypothesis.statement), tokens(text)) >= 2;
    if (!inScope) continue;
    const relation = falsified
      ? "falsifies"
      : (update.relation ?? relationFromVerdict(update.verdictStatus));
    if (!relation) continue;
    applyRelation(hypothesis, relation, update.refs);
  }
  return hypotheses;
}

export type RecordedStep = {
  index: number;
  action: string;
  summary: string;
  outcome: string;
  detail?: string;
  evidenceRefs?: string[];
  hypothesisIds?: string[];
  evidenceRelation?: EvidenceRelation;
};

function sourceFor(action: string): TaskEvidence["source"] {
  if (action === "VERIFY") return "verification";
  if (action === "RETRIEVE_MEMORY") return "memory";
  if (action === "CREATE_ARTIFACT") return "artifact";
  return "tool";
}

export function recordStepEvidence(state: TaskState, step: RecordedStep) {
  const refs = step.evidenceRefs ?? [];
  for (const ref of refs) {
    if (!state.evidenceRefs.includes(ref)) state.evidenceRefs.push(ref);
    const item: TaskEvidence = {
      id: `e${state.evidence.length + 1}`,
      ref,
      summary: step.summary.slice(0, 240),
      source: sourceFor(step.action),
      stepIndex: step.index,
      hypothesisIds: step.hypothesisIds ?? [],
    };
    state.evidence.push(item);
    if (
      step.evidenceRelation === "contradicts" ||
      step.evidenceRelation === "falsifies"
    ) {
      state.counterEvidence.push(item);
    }
  }
  state.evidence = state.evidence.slice(-40);
  state.counterEvidence = state.counterEvidence.slice(-40);
  state.evidenceRefs = state.evidenceRefs.slice(-40);
}

function parseVerdict(detail: string, summary: string) {
  const split = detail.indexOf(":");
  if (split === -1) {
    return { status: detail.trim() || "unverified", summary };
  }
  return {
    status: detail.slice(0, split).trim() || "unverified",
    summary: detail.slice(split + 1).trim() || summary,
  };
}

function mapVerificationStatus(status: string): VerificationState["status"] {
  const value = status.toLowerCase();
  if (value.startsWith("verified") || value === "passed") return "verified";
  if (value.startsWith("rejected") || value === "failed") return "rejected";
  if (value.startsWith("partial")) return "partial";
  return "unverified";
}

/** A VERIFY step updates verification state and only the hypotheses it bears on. */
export function applyVerificationStep(state: TaskState, step: RecordedStep) {
  if (step.action !== "VERIFY" || step.outcome !== "ok") return;
  const verdict = parseVerdict(step.detail ?? "", step.summary);
  const status = mapVerificationStatus(verdict.status);
  state.verificationState = {
    status,
    lastSummary: verdict.summary.slice(0, 400),
    checks: [
      ...state.verificationState.checks,
      {
        status: verdict.status.slice(0, 40),
        summary: verdict.summary.slice(0, 300),
      },
    ].slice(-12),
  };
  applyHypothesisEvidence(state.hypotheses, {
    hypothesisIds: step.hypothesisIds,
    relation: step.evidenceRelation,
    verdictStatus: verdict.status,
    summary: verdict.summary,
    refs: step.evidenceRefs?.length
      ? step.evidenceRefs
      : [`verify:${step.index}`],
  });
}

export function recordPlanRevision(state: TaskState, revision: PlanRevision) {
  state.planRevisions.push({
    atStep: revision.atStep,
    reason: revision.reason.slice(0, 80) || "unspecified",
    summary: revision.summary.slice(0, 300),
  });
  state.planRevisions = state.planRevisions.slice(-8);
}

export function rememberFacts(state: TaskState, facts: string[]) {
  for (const fact of facts) {
    const text = fact.trim().slice(0, 400);
    if (!text || state.knownFacts.includes(text)) continue;
    state.knownFacts.push(text);
  }
  state.knownFacts = state.knownFacts.slice(-12);
}

export function addOpenQuestion(state: TaskState, question: string) {
  const text = question.trim().slice(0, 400);
  if (!text || state.openQuestions.includes(text)) return;
  state.openQuestions.push(text);
  state.openQuestions = state.openQuestions.slice(-12);
}
