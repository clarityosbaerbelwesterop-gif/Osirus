import type { WaitKind, WakeCondition } from "../agent/long-horizon";
import { z } from "zod";
import type { MemoryOS } from "../memory/os";
import type { ModelProvider } from "../models/provider";
import type { ClaimedWork } from "../runtime/dispatch";
import type { WorkflowGraph } from "../runtime/graph";
import type { RuntimeRepository } from "../runtime/repository";
import type { Capability } from "../runtime/types";
import type { SkillRepository } from "../skills/repository";
import type { RankedSkill } from "../skills";
import type { Verdict } from "../verification/engine";

export type ArmId =
  "thinking" | "coding" | "research" | "math_science" | "building" | "general";

export type RuntimeIdentity = {
  userId: string;
  organizationId: string;
  workspaceId: string;
};

/**
 * What the user gets to hold the run to.
 *
 * Written before execution from the routing decision (and, when the thinking
 * arm runs, from its analysis), so the meta verifier grades against a promise
 * made up front rather than one reverse-engineered from whatever came out.
 */
export type AcceptanceContract = {
  objective: string;
  successCriteria: string[];
  requiredEvidence: string[];
  outputFields: string[];
  forbidden: string[];
};

// Structured task analysis.
//
// This is the thinking arm's whole product. It is a schema rather than prose
// precisely so the plan can be executed: proposedStages become the workflow
// graph, verifierRequirements become the checks, successCriteria become the
// contract. It carries conclusions only -- there is no field for reasoning,
// because nothing in it may be private chain-of-thought.
export const taskAnalysisSchema = z.object({
  objective: z.string().min(1).max(2000),
  successCriteria: z.array(z.string().min(1).max(400)).min(1).max(10),
  constraints: z.array(z.string().min(1).max(400)).max(10).default([]),
  unknowns: z.array(z.string().min(1).max(400)).max(10).default([]),
  capabilities: z
    .array(
      z.enum([
        "general",
        "coding",
        "research",
        "math_science",
        "data",
        "multimodal",
        "computer_use",
      ]),
    )
    .min(1)
    .max(4),
  complexity: z.enum(["low", "medium", "high"]),
  risk: z.enum(["low", "medium", "high"]),
  requiredEvidence: z
    .array(
      z.enum([
        "STRUCTURE",
        "MODEL",
        "TOOL",
        "TEST",
        "BUILD",
        "SOURCE",
        "MATH",
        "SECURITY",
      ]),
    )
    .max(8)
    .default([]),
  proposedStages: z
    .array(
      z.object({
        key: z
          .string()
          .min(1)
          .max(48)
          .regex(/^[a-z0-9][a-z0-9_-]*$/),
        name: z.string().min(1).max(120),
        capability: z.enum([
          "general",
          "coding",
          "research",
          "math_science",
          "data",
          "multimodal",
          "computer_use",
        ]),
        dependsOn: z.array(z.string().min(1).max(48)).max(8).default([]),
      }),
    )
    .min(1)
    .max(12),
  parallelGroups: z
    .array(z.array(z.string().min(1).max(48)).max(8))
    .max(4)
    .default([]),
  verifierRequirements: z.array(z.string().min(1).max(300)).max(8).default([]),
});

export type TaskAnalysis = z.infer<typeof taskAnalysisSchema>;

/**
 * The worker contract.
 *
 * A stage says how it ended; the executor translates that into one
 * osirus.finish_attempt call. Nothing else may move a stage, so a worker
 * cannot leave one in a state the claim scan disagrees with.
 */
export type StageOutcome =
  /** Done. The stage will not run again. */
  | { kind: "COMPLETE"; output: Record<string, unknown>; verdict?: Verdict }
  /** More to do. Resume state is checkpointed; the stage is immediately re-claimable. */
  | {
      kind: "PROGRESS";
      output: Record<string, unknown>;
      resume: Record<string, unknown>;
    }
  /** Parked on something outside the engine. */
  | {
      kind: "WAITING";
      /** "external" is the pre-M40 untyped wait; new waits are typed. */
      reason: WaitKind | "external";
      output: Record<string, unknown>;
      approvalId?: string;
      /** How the wait ends. Absent: only a release (approval) wakes it. */
      wake?: WakeCondition;
    }
  /** Temporarily unable to proceed; try again after the delay. */
  | { kind: "BLOCKED"; reason: string; retryAfterSeconds: number }
  /** Went wrong. `retryable` decides whether the stage gets another attempt. */
  | {
      kind: "FAILED";
      failureClass: string;
      error: string;
      retryable: boolean;
    };

export type RepairPlan = {
  /** Stage key to re-run, or null to repair in place. */
  stageKey: string | null;
  instruction: string;
  maxRounds: number;
};

export type ArmActivity = (
  type: string,
  summary: string,
  data?: Record<string, unknown>,
  visibility?: "user" | "internal",
) => Promise<{ id: string }>;

/**
 * Where an arm keeps run-scoped records. Omitted in the app, where every store
 * is the database under row-level security. The arena harness supplies
 * in-memory stores so the same arm code runs end to end where there is no
 * database -- never a different code path for the agent itself.
 */
export type RuntimeStores = {
  sandbox?: () => Promise<import("../sandbox/driver").SandboxDriver>;
  workspace?: () => import("../coding/store").WorkspaceRecordStore;
  plans?: () => import("../agent/plan").PlanRevisionStore;
  evidence?: (
    runId: string,
    stageId: string,
  ) => import("../research/types").EvidenceStore;
  registry?: () => import("../tools/registry").ToolRegistry;
  /** Files a new workspace starts from when the objective names no repository. */
  fixture?: () => Array<{ path: string; content: string }>;
  /** The run's mission state (M39); osirus.run_missions when absent. */
  missions?: () => import("../runtime/missions").MissionStore;
  /** Adds stages to the running graph (M39); osirus.run_stages when absent. */
  graph?: () => GraphAppender;
  /** Model-free probe that ends typed waits (M40); webhook deliveries when absent. */
  waitProbe?: () => import("../agent/long-horizon").WaitProbe;
};

/** A node added to a running graph: depends on `after` or on other new nodes. */
export type AppendedNode = {
  key: string;
  name: string;
  capability: import("../runtime/types").Capability;
  input: Record<string, unknown>;
  dependsOn: string[];
  retryPolicy?: Record<string, unknown>;
  requiresVerification?: boolean;
};

export type GraphAppender = {
  /**
   * Insert `nodes` after the stage `afterStageId`. New roots depend on it;
   * every stage that depended on it also waits for `tailKey`.
   */
  append(input: {
    runId: string;
    afterStageId: string;
    nodes: AppendedNode[];
    tailKey: string;
  }): Promise<string[]>;
};

export type ArmRuntime = {
  stores?: RuntimeStores;
  provider: ModelProvider;
  repository: RuntimeRepository;
  memory: MemoryOS;
  skills: SkillRepository;
  activity: ArmActivity;
  /** Streams assistant text to the browser as it arrives. */
  emitDelta: (text: string) => Promise<void> | void;
  /** Excerpts of files attached to the run, retrieved by relevance. */
  attachments?: {
    retrieve(input: {
      ids: string[];
      query: string;
      maxChars?: number;
    }): Promise<Array<{ label: string; content: string }>>;
  };
};

export type RoutingInput = {
  objective: string;
  capabilities: Capability[];
  /** Present only when the thinking arm has already run. */
  analysis?: TaskAnalysis;
};

export type ArmStageContext = {
  identity: RuntimeIdentity;
  work: ClaimedWork;
  runtime: ArmRuntime;
  signal: AbortSignal;
  /** Accumulated run state, rebuilt from the latest checkpoint on resume. */
  state: Record<string, unknown>;
};

export type PreparedContext = {
  sections: Array<{ kind: string; text: string }>;
  usedTokens: number;
  omitted: string[];
};

export interface AgentArm {
  readonly id: ArmId;
  /** 0..1 confidence that this arm should own the objective. */
  canHandle(input: RoutingInput): number;
  buildContract(input: RoutingInput): AcceptanceContract;
  buildWorkflow(input: RoutingInput): WorkflowGraph;
  prepareContext(context: ArmStageContext): Promise<PreparedContext>;
  selectSkills(context: ArmStageContext): Promise<RankedSkill[]>;
  executeStage(context: ArmStageContext): Promise<StageOutcome>;
  verify(context: ArmStageContext): Promise<Verdict>;
  repairStrategy(failure: {
    verdict: Verdict;
    round: number;
  }): RepairPlan | null;
}
