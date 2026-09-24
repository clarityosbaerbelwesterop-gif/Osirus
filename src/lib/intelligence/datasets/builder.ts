import { fingerprint } from "../evals/random";
import type { DatasetExample, IntelStore } from "../store/store";
import type { EvalTask, Experience } from "../types";
import {
  exampleText,
  verifyExamples,
  type ContaminationReport,
} from "./verify";

// The DatasetBuilder. Datasets come only from experience an independent
// judge verified, never from product conversations, and each example keeps
// its provenance. Partitions follow the task that produced the example.
// verifyExamples drops duplicate fingerprints and any train/dev/adversarial
// example that matches a holdout example exactly or by near-duplicate
// objective, including holdout rows in this same batch.

export const MIN_QUALITY = 0.6;

type Built = {
  datasetId: string;
  version: number | null;
  versionId: string | null;
  counts: Record<string, number>;
  contamination: ContaminationReport;
};

const PARTITION: Record<string, DatasetExample["partition"]> = {
  dev: "train",
  train: "train",
  holdout: "holdout",
  adversarial: "adversarial",
  fresh: "train",
};

export async function buildDatasets(
  store: IntelStore,
  input: {
    capabilityId: string;
    tasks: Map<string, EvalTask>;
    experience: Experience[];
  },
): Promise<Built[]> {
  const eligible = input.experience.filter(
    (row) =>
      row.source !== "product" &&
      row.outcome === "verified_success" &&
      row.qualityScore >= MIN_QUALITY &&
      row.taskRef &&
      input.tasks.has(row.taskRef),
  );
  const failures = input.experience.filter(
    (row) =>
      row.source !== "product" &&
      (row.outcome === "failure" || row.outcome === "false_completion") &&
      row.taskRef,
  );

  const storedHoldout = await store.datasetHoldoutSignals();
  const policyByExperience = new Map<string, string>();
  const make = (
    task: EvalTask,
    row: Experience,
    kind: string,
    output: Record<string, unknown>,
  ) => {
    const partitionBase = PARTITION[task.partition] ?? "train";
    // 1 in 5 train examples goes to dev, decided by the task, not at random.
    const partition =
      partitionBase === "train" &&
      parseInt(task.fingerprint.slice(0, 2), 16) % 5 === 0
        ? "dev"
        : partitionBase;
    return {
      partition,
      input: {
        taskId: task.id,
        objective: task.spec.objective.slice(0, 4_000),
        kind,
      },
      output,
      experienceId: row.id,
      fingerprint: fingerprint("example", kind, task.spec.objective),
    } satisfies DatasetExample;
  };

  const sets: Record<string, DatasetExample[]> = {
    problem_solution: [],
    trajectory: [],
    failure_repair: [],
  };
  const seen = new Set<string>();
  for (const row of eligible) {
    const task = input.tasks.get(row.taskRef!)!;
    const key = `${task.id}:${row.strategyVersionId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (row.strategyVersionId)
      policyByExperience.set(row.id, row.strategyVersionId);
    sets.problem_solution!.push(
      make(task, row, "problem_solution", {
        solution: row.trajectory.output ?? null,
        check: row.verification.check?.detail ?? null,
      }),
    );
    if (row.trajectory.actions?.length)
      sets.trajectory!.push(
        make(task, row, "trajectory", {
          actions: row.trajectory.actions.map(
            (action) => action.toolId ?? action.action,
          ),
        }),
      );
    const failed = failures.find((entry) => entry.taskRef === row.taskRef);
    if (failed)
      sets.failure_repair!.push(
        make(task, row, "failure_repair", {
          failure: {
            class: failed.failureClass,
            check: failed.verification.check?.detail ?? null,
          },
          repair: row.trajectory.output ?? null,
        }),
      );
  }

  const out: Built[] = [];
  for (const [format, examples] of Object.entries(sets)) {
    const datasetId = `${input.capabilityId}.${format}`;
    const verified = verifyExamples(
      examples.map((example) => ({
        ...example,
        text: exampleText(example.input),
      })),
      storedHoldout,
    );
    const clean = verified.kept.map((example) => ({
      partition: example.partition,
      input: example.input,
      output: example.output,
      experienceId: example.experienceId,
      fingerprint: example.fingerprint,
    }));
    const counts: Record<string, number> = {};
    for (const example of clean)
      counts[example.partition] = (counts[example.partition] ?? 0) + 1;
    const policyVersionIds = [
      ...new Set(
        clean
          .map((example) =>
            example.experienceId
              ? policyByExperience.get(example.experienceId)
              : undefined,
          )
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    if (!clean.length) {
      out.push({
        datasetId,
        version: null,
        versionId: null,
        counts,
        contamination: verified.report,
      });
      continue;
    }
    await store.ensureDataset(
      datasetId,
      format,
      `Verified ${format.replace("_", " ")} examples for ${input.capabilityId}.`,
    );
    const version = await store.insertDatasetVersion({
      datasetId,
      counts,
      provenance: {
        sources: [...new Set(clean.map((example) => example.experienceId))]
          .length,
        rule: `verified experience, quality >= ${MIN_QUALITY}, no product data, duplicate and holdout overlap removed`,
        strategyVersionIds: policyVersionIds,
      },
      contamination: verified.report,
      examples: clean,
    });
    out.push({
      datasetId,
      version: version.version,
      versionId: version.id,
      counts,
      contamination: verified.report,
    });
  }
  return out;
}
