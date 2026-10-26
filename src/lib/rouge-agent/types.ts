export type RougeCloneRole =
  | "architect"
  | "solver"
  | "verifier"
  | "security_auditor"
  | "refactorer"
  | "optimizer";

export type RougeDeliberationProfile = "standard" | "deep" | "frontier-max";

export type RougeThinkingEffort =
  "leicht" | "mittel" | "hoch" | "super" | "ultra";

export interface RougeCheckResult {
  name: string;
  kind: "typecheck" | "lint" | "unit_test" | "security" | "contract" | "custom";
  passed: boolean;
  output: string;
  durationMs: number;
}

export interface RougeCodePatch {
  file: string;
  description: string;
  content: string;
  authorCloneId: string;
  authorRole: RougeCloneRole;
}

export interface RougeCloneSpec {
  id: string;
  parentCloneId: string | null;
  generation: number;
  role: RougeCloneRole;
  subObjective: string;
  assignedFiles: string[];
  skillsApplied: string[];
}

export interface RougeCloneOutcome {
  clone: RougeCloneSpec;
  status: "verified" | "needs_repair" | "rejected";
  summary: string;
  patches: RougeCodePatch[];
  findings: string[];
  confidence: number;
  tokensUsed: number;
  cachedHit: boolean;
}

export interface RougeRepairIteration {
  iteration: number;
  clonesSpawned: number;
  patchesApplied: RougeCodePatch[];
  checks: RougeCheckResult[];
  allPassed: boolean;
  failingSummary: string | null;
  skillsSynthesized: string[];
  durationMs: number;
}

export interface RougeLearnedSkill {
  id: string;
  slug: string;
  name: string;
  description: string;
  triggerPattern: string;
  repairStrategy: string[];
  antiPatterns: string[];
  verificationInvariant: string;
  version: number;
  successCount: number;
  failureCount: number;
  tokensSaved: number;
  confidence: number;
  updatedAt: string;
}

export interface RougeAgentCheckpoint {
  runId: string;
  objective: string;
  iteration: number;
  totalIterationsCompleted: number;
  continuationCount: number;
  status:
    "running" | "yielded_for_continuation" | "verified_perfect" | "failed";
  workspaceFiles: Record<string, string>;
  history: RougeRepairIteration[];
  activeSkills: RougeLearnedSkill[];
  lastCheckResults: RougeCheckResult[];
}

export interface RougeAgentConfig {
  /** Dedicated or user-selected executor model ID (defaults to ROUGE_AGENT_DEFAULT_MODEL). */
  executorModelId?: string;
  /** Distinct user-selected or default reviewer model ID (Prüfermodell). */
  reviewerModelId?: string;
  /** User-configurable thinking effort level (leicht, mittel, hoch, super, ultra). */
  thinkingEffort?: RougeThinkingEffort;
  /** User-configurable number of sub-agents / clones for the task (0..50). */
  subAgentCount?: number;
  /** Maximum iterations per slice before yielding for durable continuation. */
  maxIterationsPerSlice?: number;
  /** Maximum total iterations across continuations (Infinity for unbounded until green). */
  maxTotalIterations?: number;
  /** Maximum clone depth for recursive self-cloning. */
  maxCloneDepth?: number;
  /** Maximum parallel clones per iteration. */
  maxParallelClones?: number;
  /** Deliberation intelligence profile (defaults to frontier-max). */
  profile?: RougeDeliberationProfile;
  /** Enable automatic skill extraction and self-improvement after repair rounds. */
  selfImproveSkills?: boolean;
  /** Enable self-healing error recovery so transient clone/verifier errors never abort the run. */
  selfHealingRecovery?: boolean;
}

export interface RougeAgentRunResult {
  runId: string;
  status: "verified_perfect" | "yielded_for_continuation" | "failed";
  objective: string;
  executorModelId: string;
  reviewerModelId: string;
  thinkingEffort: RougeThinkingEffort;
  subAgentCount: number;
  profile: RougeDeliberationProfile;
  iterations: number;
  continuations: number;
  totalClonesSpawned: number;
  selfHealedErrors: number;
  finalPatches: RougeCodePatch[];
  finalChecks: RougeCheckResult[];
  evolvedSkills: RougeLearnedSkill[];
  checkpoint: RougeAgentCheckpoint;
  summary: string;
}
