import { derivedCapabilities } from "../capabilities/taxonomy";
import { cognitiveTelemetry, configurationVector } from "../meta/telemetry";
import { fingerprint, simhash } from "../evals/random";
import type { IntelStore } from "../store/store";
import type {
  EvalTask,
  Experience,
  ExperienceOutcome,
  ExperienceSource,
  StrategyVersion,
  TrialResult,
} from "../types";

// The Experience Engine: every judged trial becomes a structured experience
// row. What is stored is operational: the task, the strategy and model, the
// stages and tool actions, the independent check, cost and time. Private
// reasoning is never stored, because none is produced for storage.

const SOURCE_RELIABILITY: Record<ExperienceSource, number> = {
  trial: 1,
  benchmark: 1,
  golden: 1,
  arena: 0.9,
  synthetic: 0.8,
  self_play: 0.7,
  red: 0.8,
  replay: 0.9,
  human_feedback: 0.9,
  product: 0.4,
};

export function outcomeOf(result: TrialResult): ExperienceOutcome {
  if (result.failureClass?.startsWith("provider:")) return "error";
  if (result.verified) return "verified_success";
  if (result.falseCompletion) return "false_completion";
  return result.success ? "success" : "failure";
}

/**
 * Learning value of one experience, 0..1: how strongly it was verified, how
 * new it is, how hard, how reliable its source, and how certain the outcome.
 * Low-value rows stay in the store but do not feed datasets or curricula.
 */
export function qualityScore(input: {
  source: ExperienceSource;
  outcome: ExperienceOutcome;
  independentlyChecked: boolean;
  novel: boolean;
  difficultyScore: number;
}) {
  if (input.outcome === "error") return 0;
  const verification = input.independentlyChecked ? 1 : 0.4;
  const novelty = input.novel ? 1 : 0.2;
  const difficulty = Math.min(1, input.difficultyScore / 10);
  const reliability = SOURCE_RELIABILITY[input.source];
  const certainty = input.outcome === "success" ? 0.6 : 1;
  const score =
    0.3 * verification +
    0.2 * novelty +
    0.15 * difficulty +
    0.2 * reliability +
    0.15 * certainty;
  return Number(score.toFixed(4));
}

export async function recordTrialExperience(
  store: IntelStore,
  input: {
    task: EvalTask;
    version: StrategyVersion;
    model: string;
    result: TrialResult;
    source?: ExperienceSource;
  },
): Promise<Experience> {
  const { task, result } = input;
  const outcome = outcomeOf(result);
  const actions = result.trajectory?.actions ?? [];
  const shape = actions
    .map((action) => action.toolId ?? action.action)
    .join(" ");
  const print = fingerprint(
    "experience",
    task.fingerprint,
    input.version.id,
    outcome,
    result.failureClass ?? "",
    simhash(shape),
  );
  const novel = !(await store.experienceFingerprintExists(print));
  const source = input.source ?? "trial";
  return store.insertExperience({
    source,
    taskRef: task.id,
    taskType: task.spec.kind,
    capabilityIds: derivedCapabilities(task.capabilityId, task.spec),
    difficulty: task.difficultyScore,
    strategyVersionId: input.version.id,
    model: input.model,
    skills: [],
    tools: [
      ...new Set(
        actions.map((action) => action.toolId).filter(Boolean) as string[],
      ),
    ],
    trajectory: {
      arm: task.spec.composition?.join("+"),
      stages: result.trajectory?.stages,
      actions: actions.slice(0, 60),
      output: result.trajectory?.output?.slice(0, 6_000),
      // M42: how the run reasoned, and the configuration it ran under, so
      // credit can be assigned to one dimension at a time.
      telemetry: cognitiveTelemetry({
        actions,
        verified: result.verified,
        falseCompletion: result.falseCompletion,
        tokens: result.tokens,
        hypotheses: result.trajectory?.cognition?.hypotheses,
        switches: result.trajectory?.cognition?.switches,
      }),
      configuration: configurationVector({
        genome: input.version.genome,
        model: input.model,
        skills: [],
      }),
    },
    verification: { verdicts: result.verdicts, check: result.check },
    outcome,
    failureClass: result.failureClass,
    repairs: result.repairs,
    costUsd: result.costUsd,
    tokens: result.tokens,
    latencyMs: result.latencyMs,
    confidence: null,
    qualityScore: qualityScore({
      source,
      outcome,
      independentlyChecked: true,
      novel,
      difficultyScore: task.difficultyScore,
    }),
    fingerprint: print,
    partition: task.partition,
    provenance: {
      evalTaskId: task.id,
      generator: task.generator,
      strategy: `${input.version.strategyId} v${input.version.version}`,
    },
  });
}

/** Failed and successful experience worth replaying, best learning value first. */
export async function replayBuffer(
  store: IntelStore,
  input: { capabilityId: string; kind: "failure" | "success"; limit: number },
) {
  const rows = await store.listExperience({
    capabilityId: input.capabilityId,
    limit: 1000,
  });
  return rows
    .filter((row) =>
      input.kind === "success"
        ? row.outcome === "verified_success"
        : row.outcome === "failure" || row.outcome === "false_completion",
    )
    .sort((a, b) => b.qualityScore - a.qualityScore)
    .slice(0, input.limit);
}
