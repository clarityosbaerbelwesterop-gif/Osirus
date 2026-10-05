/**
 * GitOps control plane CLI, run by the workflows via `npx vite-node`:
 *
 *   validate                         structural + cross-file validation (exit 1 on error)
 *   plan [--json <file>]             reconcile manifests against state, print the plan
 *   dispatch <job> [--execute]       dry run by default: gate + payload preview;
 *                                    --execute sends a cleared job to its provider
 *   synth <pipeline> --out <file>    run the agent swarm (gate must be clear)
 *   record <file>                    validate a worker run record into state/runs/
 *   record-synth <pipeline> --uri <hf://datasets/o/r> --revision <sha> --accepted <n>
 *                --tasks <n> --started <iso> --out <file>
 *                                    build the run record of a published swarm dataset
 *
 * Exit codes: 0 ok, 1 invalid input, 2 blocked by the gate.
 */

import {
  appendFileSync,
  existsSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  dispatchModal,
  dispatchRunpod,
  fetchDatasetTexts,
  type FetchLike,
  httpProcessRewardModel,
  openAiCompatibleChat,
} from "./lib/clients";
import { jobBlockers } from "./lib/gate";
import { loadBundle } from "./lib/load";
import { buildPlan, renderPlanMarkdown } from "./lib/plan";
import { renderPayload, runIdFor } from "./lib/render";
import { runInSandbox } from "./lib/sandbox";
import {
  runSwarm,
  TEACHER_SYSTEM_PROMPT,
  teacherUserPrompt,
} from "./lib/swarm";
import {
  JOB_ID_PATTERN,
  type Bundle,
  type RunRecord,
  validateBundleReferences,
  validateRunRecord,
} from "./lib/schema";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const env = process.env;
const fetchImpl = globalThis.fetch as unknown as FetchLike;

function summary(markdown: string): void {
  console.log(markdown);
  if (env.GITHUB_STEP_SUMMARY)
    appendFileSync(env.GITHUB_STEP_SUMMARY, `${markdown}\n\n`);
}

function output(values: Record<string, string>): void {
  if (!env.GITHUB_OUTPUT) return;
  appendFileSync(
    env.GITHUB_OUTPUT,
    Object.entries(values)
      .map(([k, v]) => `${k}=${v}\n`)
      .join(""),
  );
}

function fail(code: number, message: string): never {
  console.error(message);
  process.exit(code);
}

function load(): Bundle {
  const { bundle, errors } = loadBundle(ROOT);
  if (!bundle) fail(1, `Manifest validation failed:\n- ${errors.join("\n- ")}`);
  return bundle;
}

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

async function main(argv: string[]): Promise<void> {
  const [command, ...args] = argv;
  const now = new Date();

  if (command === "validate") {
    const b = load();
    summary(
      `### GitOps manifests valid\n${b.adapters.length} adapters · ${b.merges.length} merges · ` +
        `${b.pipelines.length} pipelines · ${b.runs.length} run records · trainingReady=${b.controlPlane.trainingReady}`,
    );
    return;
  }

  if (command === "plan") {
    const plan = buildPlan(load(), { now });
    summary(
      `### GitOps plan (${now.toISOString()})\n\n${renderPlanMarkdown(plan)}`,
    );
    const out = flag(args, "--json");
    if (out) writeFileSync(out, JSON.stringify(plan, null, 2));
    return;
  }

  if (command === "dispatch") {
    const jobId = args[0] ?? "";
    if (!JOB_ID_PATTERN.test(jobId))
      fail(1, `invalid job id ${JSON.stringify(jobId)}`);
    const execute = args.includes("--execute");
    const bundle = load();
    const plan = buildPlan(bundle, execute ? { now, env } : { now });
    const job =
      plan.jobs.find((j) => j.id === jobId) ?? fail(1, `unknown job ${jobId}`);
    output({ stage: job.stage, status: job.status });
    const reasons = [...job.blockers, ...job.notes]
      .map((r) => `- ${r}`)
      .join("\n");
    summary(
      `### ${execute ? "Dispatch" : "Dry run"}: \`${jobId}\` is **${job.status}**\n${reasons}`,
    );
    if (job.stage === "synth") {
      if (execute && job.status !== "ready")
        fail(2, `${jobId} is ${job.status}`);
      return;
    }
    if (!execute) {
      if (job.inputHash) {
        const payload = renderPayload(bundle, job, {
          commitSha: env.GITHUB_SHA ?? "0".repeat(40),
          now,
          preview: true,
        });
        summary(
          `<details><summary>Payload preview</summary>\n\n\`\`\`json\n${JSON.stringify(payload, null, 2)}\n\`\`\`\n</details>`,
        );
      }
      return;
    }
    if (job.status !== "ready")
      fail(2, `${jobId} is ${job.status}; nothing was sent`);
    const commitSha =
      env.GITHUB_SHA ?? fail(1, "GITHUB_SHA is required to execute");
    const payload = renderPayload(bundle, job, { commitSha, now });
    const provider = bundle.compute.providers.find(
      (p) => p.id === job.compute!.provider,
    )!;
    const endpoint = env[provider.endpointRef]!;
    const key = env[provider.apiKeyRef]!;
    const receipt =
      provider.kind === "runpod-serverless"
        ? await dispatchRunpod(fetchImpl, endpoint, key, payload)
        : await dispatchModal(fetchImpl, endpoint, key, payload);
    output({ run_id: payload.runId, provider_job_id: receipt.providerJobId });
    summary(
      `Dispatched \`${payload.runId}\` to ${provider.id} as \`${receipt.providerJobId}\` (${receipt.status}).`,
    );
    return;
  }

  if (command === "synth") {
    const pipelineId = args[0];
    const out =
      flag(args, "--out") ?? fail(1, "--out <file.jsonl> is required");
    const bundle = load();
    const pipeline =
      bundle.pipelines.find((p) => p.id === pipelineId) ??
      fail(1, `unknown pipeline ${pipelineId}`);
    const node = buildPlan(bundle, { now, env }).jobs.find(
      (j) => j.id === `synth:${pipeline.id}`,
    )!;
    const blockers = jobBlockers(bundle, node, { now, env });
    if (blockers.length > 0)
      fail(2, `synth:${pipeline.id} is blocked:\n- ${blockers.join("\n- ")}`);
    const teacher = pipeline.teachers.find(
      (t) =>
        t.outputsMayTrainModels.review === "approved" &&
        env[t.endpointRef] &&
        env[t.apiKeyRef],
    )!;
    const chat = openAiCompatibleChat(fetchImpl, {
      baseUrl: env[teacher.endpointRef]!,
      apiKey: env[teacher.apiKeyRef]!,
      model: teacher.model,
      temperature: 0.8,
      maxTokens: 4096,
    });
    const prm = pipeline.verification.prm;
    const prmClient =
      env[prm.endpointRef] && env[prm.apiKeyRef]
        ? httpProcessRewardModel(fetchImpl, {
            url: env[prm.endpointRef]!,
            apiKey: env[prm.apiKeyRef]!,
          })
        : undefined;
    const evalTexts = (
      await Promise.all(
        pipeline.decontamination.evalSources.map((s) =>
          fetchDatasetTexts(fetchImpl, s),
        ),
      )
    ).flat();
    const report = await runSwarm({
      pipeline,
      teacherId: `${teacher.id}:${teacher.model}`,
      evalTexts,
      deps: {
        generate: (task) =>
          chat(TEACHER_SYSTEM_PROMPT, teacherUserPrompt(task)),
        verify: async (c) => {
          const run = (solution: string) =>
            runInSandbox(
              pipeline.verification.sandbox,
              { "solution.py": solution, "test_solution.py": c.tests },
              ["python", "-B", "-m", "unittest", "-q", "test_solution"],
            );
          const real = await run(c.solution);
          if (real.exitCode !== 0 || real.timedOut)
            return { passed: false, detail: real.stderr.slice(-500) };
          // Tests that also pass against an empty module verify nothing.
          const empty = await run("");
          if (empty.exitCode === 0)
            return {
              passed: false,
              reason: "vacuous-tests",
              detail: "tests pass without a solution",
            };
          return { passed: true, detail: "" };
        },
        scoreSteps: prmClient
          ? (c) =>
              prmClient({
                prompt: c.prompt,
                steps: c.steps,
                solution: c.solution,
              })
          : undefined,
      },
    });
    writeFileSync(
      out,
      report.records.map((r) => JSON.stringify(r)).join("\n") +
        (report.records.length ? "\n" : ""),
    );
    output({ accepted: String(report.accepted), tasks: String(report.tasks) });
    summary(
      `### Swarm \`${pipeline.id}\`\n${report.accepted}/${report.tasks} accepted · ${report.teacherRequests} teacher requests · ` +
        `rejected ${JSON.stringify(report.rejected)} · ${evalTexts.length} eval items decontaminated against`,
    );
    if (report.accepted === 0)
      fail(1, "no candidate passed verification; nothing to publish");
    return;
  }

  if (command === "record-synth") {
    const pipelineId = args[0];
    const need = (name: string) =>
      flag(args, name) ?? fail(1, `${name} is required`);
    const bundle = load();
    const job =
      buildPlan(bundle, { now }).jobs.find(
        (j) => j.id === `synth:${pipelineId}`,
      ) ?? fail(1, `unknown pipeline ${pipelineId}`);
    const record: RunRecord = {
      runId: runIdFor(job, now),
      jobId: job.id,
      inputHash: job.inputHash!,
      status: "succeeded",
      provider: "github-actions",
      providerJobId: `${env.GITHUB_RUN_ID ?? "local"}-${env.GITHUB_RUN_ATTEMPT ?? "1"}`,
      commitSha: env.GITHUB_SHA ?? fail(1, "GITHUB_SHA is required"),
      startedAt: need("--started"),
      finishedAt: now.toISOString(),
      outputs: { uri: need("--uri"), revision: need("--revision") },
      metrics: [
        {
          suite: "swarm",
          metric: "accepted",
          value: Number(need("--accepted")),
        },
        { suite: "swarm", metric: "tasks", value: Number(need("--tasks")) },
      ],
      // Teacher API spend is billed by the provider; it is not estimated here.
      costUsd: null,
      error: null,
    };
    const errors = validateRunRecord(record, "synth record");
    if (errors.length > 0)
      fail(1, `Rejected run record:\n- ${errors.join("\n- ")}`);
    writeFileSync(need("--out"), JSON.stringify(record));
    output({ record: JSON.stringify(record) });
    return;
  }

  if (command === "record") {
    const file = args[0] ?? fail(1, "record <file> is required");
    const raw = JSON.parse(readFileSync(file, "utf8")) as { record?: unknown };
    const record = (raw.record ?? raw) as RunRecord;
    const errors = validateRunRecord(record, "callback record");
    if (errors.length > 0)
      fail(1, `Rejected run record:\n- ${errors.join("\n- ")}`);
    const bundle = load();
    const refs = validateBundleReferences({
      ...bundle,
      runs: [...bundle.runs, record],
    });
    if (refs.length > 0)
      fail(1, `Rejected run record:\n- ${refs.join("\n- ")}`);
    const target = path.join(ROOT, "state/runs", `${record.runId}.json`);
    if (existsSync(target))
      fail(
        1,
        `state/runs/${record.runId}.json already exists; records are append-only`,
      );
    writeFileSync(target, `${JSON.stringify(record, null, 2)}\n`);
    output({
      run_id: record.runId,
      job_id: record.jobId,
      status: record.status,
    });
    summary(
      `Recorded \`${record.runId}\` (${record.jobId}: ${record.status}).`,
    );
    return;
  }

  fail(
    1,
    "usage: cli.ts validate | plan [--json f] | dispatch <job> [--execute] | synth <pipeline> --out f | record <file> | record-synth <pipeline> ...",
  );
}

main(process.argv.slice(2)).catch((error: unknown) =>
  fail(1, (error as Error).message),
);
