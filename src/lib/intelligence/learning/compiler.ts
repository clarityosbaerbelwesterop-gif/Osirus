import { changedFields } from "../meta/credit";
import { describeGenome } from "../strategies/genomes";
import { fingerprint } from "../evals/random";
import type { IntelStore } from "../store/store";
import type {
  CapabilityGap,
  EvalTask,
  Experience,
  ExperimentDecision,
  LearningArtifact,
  StrategyVersion,
} from "../types";

// The ExperienceCompiler: the second self-feeding loop. It turns a cycle's
// verified experience into artifacts the agent and the Foundry use next:
//
//   strategic memory   task pattern → best strategy, with its evidence
//   procedural memory  how verified runs actually went, step by step
//   causal memory      what an intervention changed, only from paired A/B
//                      evidence on at least MIN_CAUSAL tasks
//   failure patterns   the gaps behind the failures
//   skill candidates   directives that won an experiment, as skill text
//   router stats       verified rate per capability, strategy and model
//
// Correlation is never written as cause: a causal artifact requires an
// experiment in which the intervention was the only difference.

export const MIN_CAUSAL = 3;

type CompileInput = {
  cycleId: string | null;
  capabilityId: string;
  experience: Experience[];
  tasks: Map<string, EvalTask>;
  versions: Map<string, StrategyVersion>;
  champion: StrategyVersion;
  decision: ExperimentDecision | null;
  gaps: CapabilityGap[];
};

function familyKey(task: EvalTask | undefined) {
  if (!task) return "unknown";
  const band =
    task.difficultyScore < 4
      ? "easy"
      : task.difficultyScore < 7
        ? "medium"
        : "hard";
  return `${task.capabilityId}:${task.partition}:${band}`;
}

export async function compileExperience(
  store: IntelStore,
  input: CompileInput,
) {
  const written: LearningArtifact[] = [];
  const add = async (artifact: Omit<LearningArtifact, "id">) =>
    written.push(await store.upsertArtifact(artifact));
  const judged = input.experience.filter((row) => row.outcome !== "error");

  // Strategic memory: per task pattern, the version with the best verified
  // rate (ties to the cheaper one), with the counts that justify it.
  const byPattern = new Map<
    string,
    Map<string, { verified: number; n: number; calls: number }>
  >();
  for (const row of judged) {
    if (!row.strategyVersionId) continue;
    const pattern = familyKey(input.tasks.get(row.taskRef ?? ""));
    const perVersion = byPattern.get(pattern) ?? new Map();
    const entry = perVersion.get(row.strategyVersionId) ?? {
      verified: 0,
      n: 0,
      calls: 0,
    };
    entry.n += 1;
    entry.calls += row.tokens;
    if (row.outcome === "verified_success") entry.verified += 1;
    perVersion.set(row.strategyVersionId, entry);
    byPattern.set(pattern, perVersion);
  }
  for (const [pattern, perVersion] of byPattern) {
    const ranked = [...perVersion.entries()].sort(
      (a, b) =>
        b[1].verified / b[1].n - a[1].verified / a[1].n ||
        a[1].calls - b[1].calls,
    );
    const [bestId, best] = ranked[0]!;
    const version = input.versions.get(bestId);
    await add({
      cycleId: input.cycleId,
      kind: "strategic_memory",
      capabilityId: input.capabilityId,
      taskPattern: pattern,
      content: {
        bestStrategy: version
          ? `${version.strategyId} v${version.version}`
          : bestId,
        strategyVersionId: bestId,
        genome: version ? describeGenome(version.genome) : null,
        verifiedRate: best.n
          ? Number((best.verified / best.n).toFixed(3))
          : null,
        alternatives: ranked.slice(1).map(([id, entry]) => ({
          strategyVersionId: id,
          verified: entry.verified,
          n: entry.n,
        })),
        model: version?.model ?? null,
      },
      evidence: { tasks: best.n, verified: best.verified },
      support: best.n,
      status: best.n >= 3 ? "active" : "proposed",
      fingerprint: fingerprint("strategic", pattern),
    });
  }

  // Procedural memory: the action shape of verified runs, grouped.
  const procedures = new Map<
    string,
    { steps: string[]; support: number; ids: string[] }
  >();
  for (const row of judged) {
    if (row.outcome !== "verified_success") continue;
    const steps = (row.trajectory.actions ?? [])
      .map((action) => action.toolId ?? action.action)
      .filter((step, index, all) => index === 0 || all[index - 1] !== step)
      .slice(0, 16);
    if (!steps.length) continue;
    const key = `${row.taskType}:${steps.join(">")}`;
    const entry = procedures.get(key) ?? { steps, support: 0, ids: [] };
    entry.support += 1;
    entry.ids.push(row.id);
    procedures.set(key, entry);
  }
  for (const [key, entry] of procedures)
    await add({
      cycleId: input.cycleId,
      kind: "procedural_memory",
      capabilityId: input.capabilityId,
      taskPattern: key.split(":")[0]!,
      content: { procedure: entry.steps },
      evidence: { experienceIds: entry.ids.slice(0, 20) },
      support: entry.support,
      status: entry.support >= 2 ? "active" : "proposed",
      fingerprint: fingerprint("procedure", key),
    });

  // Causal memory and skill candidates: from the controlled comparison only.
  if (input.decision)
    for (const comparison of input.decision.comparisons) {
      if (comparison.partition !== "dev" && comparison.partition !== "holdout")
        continue;
      const version = input.versions.get(comparison.versionId);
      if (!version || comparison.tasks < MIN_CAUSAL) continue;
      const delta =
        comparison.challenger.verified - comparison.champion.verified;
      await add({
        cycleId: input.cycleId,
        kind: "causal_memory",
        capabilityId: input.capabilityId,
        taskPattern: `${input.capabilityId}:${comparison.partition}`,
        content: {
          intervention: describeGenome(version.genome),
          effect: `verified ${comparison.champion.verified}/${comparison.tasks} → ${comparison.challenger.verified}/${comparison.tasks}`,
          direction:
            delta > 0 ? "improves" : delta < 0 ? "worsens" : "no_effect",
          probabilityBetter: comparison.probabilityBetter,
          signTestP: comparison.signTestP,
          confounded: changedFields(input.champion.genome, version.genome),
        },
        evidence: {
          design: "paired champion/challenger on identical tasks",
          championVersionId: input.champion.id,
          challengerVersionId: version.id,
          model: version.model,
        },
        support: comparison.tasks,
        // A supported effect is recorded as such only when it is clear; a
        // small difference stays a proposal. M42: a challenger that changed
        // several fields at once is confounded -- no single cause is named
        // until an ablation isolates one (meta/foundry-meta.ts).
        status:
          changedFields(input.champion.genome, version.genome).length < 2 &&
          (comparison.probabilityBetter >= 0.85 ||
            comparison.probabilityBetter <= 0.15)
            ? "active"
            : "proposed",
        fingerprint: fingerprint("causal", version.id, comparison.partition),
      });
    }
  if (
    input.decision?.outcome === "improved" &&
    input.decision.winnerVersionId
  ) {
    const winner = input.versions.get(input.decision.winnerVersionId);
    for (const directive of winner?.genome.directives ?? [])
      await add({
        cycleId: input.cycleId,
        kind: "skill_candidate",
        capabilityId: input.capabilityId,
        taskPattern: input.capabilityId,
        content: {
          instruction: directive,
          lifecycle: "verified",
          source: `${winner!.strategyId} v${winner!.version}`,
        },
        evidence: { decision: input.decision.summary },
        support:
          input.decision.comparisons.find(
            (entry) => entry.versionId === winner!.id,
          )?.tasks ?? 0,
        status: "active",
        fingerprint: fingerprint("skill", directive),
      });
  }

  // Failure patterns: the gaps, as the record the next hypotheses start from.
  for (const gap of input.gaps)
    await add({
      cycleId: input.cycleId,
      kind: "failure_pattern",
      capabilityId: gap.capabilityId,
      taskPattern: gap.kind,
      content: { summary: gap.summary, kind: gap.kind },
      evidence: gap.evidence,
      support: gap.support,
      status: gap.status === "dismissed" ? "rejected" : "active",
      fingerprint: fingerprint(
        "failure",
        gap.capabilityId,
        gap.kind,
        gap.summary,
      ),
    });

  // Router statistics: verified rate per (capability, version, model).
  const router = new Map<
    string,
    { verified: number; n: number; model: string | null; versionId: string }
  >();
  for (const row of judged) {
    if (!row.strategyVersionId) continue;
    const key = `${row.strategyVersionId}:${row.model}`;
    const entry = router.get(key) ?? {
      verified: 0,
      n: 0,
      model: row.model,
      versionId: row.strategyVersionId,
    };
    entry.n += 1;
    if (row.outcome === "verified_success") entry.verified += 1;
    router.set(key, entry);
  }
  for (const [key, entry] of router)
    await add({
      cycleId: input.cycleId,
      kind: "router_stat",
      capabilityId: input.capabilityId,
      taskPattern: input.capabilityId,
      content: {
        strategyVersionId: entry.versionId,
        model: entry.model,
        verifiedRate: Number((entry.verified / entry.n).toFixed(3)),
        n: entry.n,
      },
      evidence: {},
      support: entry.n,
      status: "active",
      fingerprint: fingerprint("router", input.capabilityId, key),
    });

  return written;
}
