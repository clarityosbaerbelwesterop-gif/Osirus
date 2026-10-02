import type { ArchFamily, FixtureArch } from "./architecture";

export type ModelId = "rouge" | "quasnir" | "darus";

export type Activity =
  | "thinking"
  | "reasoning"
  | "research"
  | "verification"
  | "code_analysis"
  | "security_scan"
  | "test_execution"
  | "patch_verification"
  | "deep_reasoning"
  | "cross_domain_synthesis"
  | "planning"
  | "waiting"
  | "api_fallback"
  | "native_inference"
  | "idle";

export interface ArmSample {
  readonly id: string;
  readonly input: string;
  readonly target: string;
}

export type ArmGrader =
  | "exact"
  | "static-scan"
  | "patch"
  | "unit"
  | "execute"
  | "regression"
  | "nll"
  | "entail"
  | "math-expr"
  | "logic"
  | "formula"
  | "sum"
  | "citation"
  | "context-bound"
  | "memory"
  | "independent"
  | "plan"
  | "horizon"
  | "thinking"
  | "terminal"
  | "rsi"
  | "database"
  | "dry-run"
  | "tool"
  | "world"
  | "multimodal"
  | "repository";

export interface CapabilityArm {
  readonly id: string;
  readonly dataset: {
    readonly id: string;
    readonly version: string;
    readonly samples: readonly ArmSample[];
  };
  readonly task: {
    readonly id: string;
    readonly instruction: string;
    readonly grader: ArmGrader;
  };
  readonly training: { readonly executable: false; readonly note: string };
  readonly metadata: {
    readonly status: "untrained";
    readonly hypothesis: string;
  };
}

export interface ModelProgram {
  readonly id: ModelId;
  readonly displayName: string;
  readonly nativeModelId: string;
  readonly summary: string;
  readonly architecture: {
    readonly id: string;
    readonly version: string;
    readonly family: ArchFamily;
    readonly plannedLayers: number;
    readonly plannedHidden: number;
    readonly plannedHeads: number;
    readonly plannedKvHeads: number;
    readonly plannedContext: number;
    readonly precision: "bf16-planned";
    readonly fixture: FixtureArch;
    readonly notes: string;
  };
  readonly tokenizer: {
    readonly id: string;
    readonly version: string;
    readonly family: string;
    readonly vocabSize: number;
  };
  readonly mixture: {
    readonly id: string;
    readonly version: string;
    readonly parts: readonly {
      readonly source: string;
      readonly fraction: number;
      readonly license: string;
    }[];
  };
  readonly curriculum: readonly {
    readonly id: string;
    readonly order: number;
    readonly objective: string;
    readonly executable: boolean;
  }[];
  readonly training: {
    readonly optimizer: "adamw-planned";
    readonly scheduler: "cosine-planned";
    readonly batch: number;
    readonly gradAccum: number;
    readonly precision: "bf16-planned";
    readonly seqLen: number;
    readonly checkpointIntervalSteps: number;
    readonly evalIntervalSteps: number;
    readonly resume: "parentId-lineage";
    readonly failureRecovery: "restore-last-json-checkpoint";
    readonly artifactUpload: "not-configured";
    readonly experimentId: string;
    readonly seed: number;
    readonly datasetVersion: string;
    readonly architectureVersion: string;
    readonly executable: "tiny-cpu-fixture";
    readonly trainingReady: false;
  };
  readonly objectives: readonly {
    readonly id: string;
    readonly statement: string;
  }[];
  readonly arms: readonly CapabilityArm[];
  readonly evalSuite: {
    readonly id: string;
    readonly measured: false;
    readonly tasks: readonly string[];
  };
  readonly research: {
    readonly loopId: string;
    readonly hypotheses: readonly string[];
  };
  readonly ui: {
    readonly selectorLabel: string;
    readonly fallbackLabel: string;
    readonly activities: readonly Activity[];
  };
  readonly fallback: {
    readonly envVar: string;
    readonly defaultModelId: string;
    readonly catalogRole: string;
  };
}

export const LOCKED_LOOP_SURFACES = [
  "evaluation_integrity",
  "security_boundary",
  "budget_limit",
  "approval_gate",
  "trust_root",
] as const;

export type LockedSurface = (typeof LOCKED_LOOP_SURFACES)[number];
