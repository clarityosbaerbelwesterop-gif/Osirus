import type { EvalTask, StrategyVersion, Trial, TrialResult } from "../types";
import type { RuntimePolicy } from "../../strategy/runtime";

// How a trial is carried out. In-process (GitHub Actions cycles, tests) runs
// the real arms to completion and returns the result; durable (production)
// starts an ordinary run in the Foundry workspace and collects the result
// once the scheduler has driven it to the end.

export type ExecuteInput = {
  trial: Trial;
  task: EvalTask;
  version: StrategyVersion;
  model: string;
  signal: AbortSignal;
};

export type ExecuteOutcome =
  | { status: "completed"; result: TrialResult }
  | { status: "running"; runId: string };

export interface TrialExecutor {
  readonly kind: "in_process" | "durable";
  execute(input: ExecuteInput): Promise<ExecuteOutcome>;
  /** Durable only: the result once the run has settled, else null. */
  collect?(trial: Trial, task: EvalTask): Promise<TrialResult | null>;
}

export function trialPolicy(
  version: StrategyVersion,
  model: string,
): RuntimePolicy {
  return {
    strategyVersionId: version.id,
    label: `${version.strategyId} v${version.version}`,
    genome: version.genome,
    assignment: "trial",
    model,
  };
}

/** Stage input a trial adds: the fixture and, for coding, the hidden tests. */
export function trialStageInput(task: EvalTask): Record<string, unknown> {
  return {
    ...(task.spec.fixture ? { fixture: task.spec.fixture } : {}),
    ...(task.spec.verify.kind === "tests"
      ? {
          hiddenChecks: {
            files: task.spec.verify.files,
            command: task.spec.verify.command,
          },
        }
      : {}),
  };
}
