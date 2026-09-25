import { runArenaTask } from "../../arena/harness";
import type { ArenaTask } from "../../arena/suites";
import type { ModelProvider } from "../../models/provider";
import type { SandboxDriver } from "../../sandbox/driver";
import { trialResultFrom } from "./judge";
import {
  trialPolicy,
  trialStageInput,
  type ExecuteInput,
  type ExecuteOutcome,
  type TrialExecutor,
} from "./executor";

// Runs a trial through the real arms in this process: routing, composition,
// every stage, the agent loop, the tools, the sandbox. Used where there is no
// database (the GitHub Actions cycle runner) and by the tests, with a
// scripted provider.

const SUITE_OF: Record<string, ArenaTask["suite"]> = {
  coding: "coding",
  math: "math",
  research: "research",
  general: "thinking",
};

export class InProcessExecutor implements TrialExecutor {
  readonly kind = "in_process" as const;

  constructor(
    private readonly options: {
      provider: (model: string) => ModelProvider;
      sandbox: () => Promise<SandboxDriver>;
      /** Hard stop per trial: a trial that spends more is cut off. */
      maxTokensPerTrial?: number;
    },
  ) {}

  async execute(input: ExecuteInput): Promise<ExecuteOutcome> {
    const { task } = input;
    const arenaTask: ArenaTask = {
      id: task.id,
      suite: SUITE_OF[task.spec.kind] ?? "thinking",
      objective: task.spec.objective,
      composition: task.spec.composition,
      fixture: task.spec.fixture,
      memory: task.spec.memory,
      expect: {},
    };
    const startedAt = Date.now();
    const run = await runArenaTask(arenaTask, {
      provider: this.options.provider(input.model),
      sandbox: this.options.sandbox,
      signal: input.signal,
      policy: trialPolicy(input.version, input.model),
      stageInput: trialStageInput(task),
      budget: this.options.maxTokensPerTrial
        ? { maxTokens: this.options.maxTokensPerTrial }
        : undefined,
    });
    const result = trialResultFrom({
      verify: task.spec.verify,
      run: {
        status: run.status === "completed" ? "completed" : "failed",
        answer: run.answer,
        verdicts: run.verdicts,
        hiddenCheck: run.hiddenCheck,
        notes: run.notes,
      },
      costUsd: run.costUsd,
      tokens: run.inputTokens + run.outputTokens,
      latencyMs: Date.now() - startedAt,
      modelCalls: run.modelCalls,
      toolCalls: run.toolCalls,
      repairs: run.repairs,
    });
    return {
      status: "completed",
      result: {
        ...result,
        trajectory: {
          stages: run.stages,
          actions: run.actions.slice(0, 60),
          output: (task.spec.kind === "coding" ? run.diff : run.answer).slice(
            0,
            6_000,
          ),
          ...(run.mission
            ? {
                cognition: {
                  hypotheses: run.mission.hypotheses,
                  switches: run.mission.switches,
                  planRevisions: run.mission.planRevisions,
                },
              }
            : {}),
        },
      },
    };
  }
}
