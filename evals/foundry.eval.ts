import { mkdir, writeFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { describeGenome } from "../src/lib/intelligence/strategies/genomes";
import { InProcessExecutor } from "../src/lib/intelligence/executors/in-process";
import { foundryStep } from "../src/lib/intelligence/loop/research-loop";
import { MemoryIntelStore } from "../src/lib/intelligence/store/memory-store";
import { DEFAULT_SETTINGS } from "../src/lib/intelligence/types";
import { UnoRouterProvider } from "../src/lib/models/unorouter";
import { resolveSandbox } from "../src/lib/sandbox";
import { LocalWorkspaceDriver } from "../src/lib/sandbox/local";

// The Foundry cycle runner for CI: real autonomous research cycles on the
// real agent with the free model, before the Foundry runs in production.
//
// Trials run in Vercel Sandbox (isolated from this runner's secrets); label
// verification and self-play mutant checks run only our own fixture code and
// use a local temporary directory. The full store is written out as the
// evidence artifact, with a Markdown report. Nothing here asserts that the
// agent improved: a cycle that finds no improvement is a valid result and is
// reported as such.

const capability = process.env.FOUNDRY_CAPABILITY ?? "coding.debug";
const model = process.env.FOUNDRY_MODEL ?? "deepseek-v4-pro-0813:free";
const maxMinutes = Number(process.env.FOUNDRY_MAX_MINUTES ?? "330");
const cycles = Number(process.env.FOUNDRY_CYCLES ?? "1");
const outDir = process.env.FOUNDRY_OUT_DIR ?? "foundry-results";
const suite = {
  dev: Number(process.env.FOUNDRY_DEV ?? "3"),
  adversarial: Number(process.env.FOUNDRY_ADVERSARIAL ?? "2"),
  holdout: Number(process.env.FOUNDRY_HOLDOUT ?? "3"),
};

describe("intelligence foundry (live)", () => {
  it("runs autonomous research cycles on the real agent", async () => {
    const startedAt = Date.now();
    const deadline = startedAt + maxMinutes * 60_000;
    const store = new MemoryIntelStore();
    await store.saveSettings({
      ...DEFAULT_SETTINGS,
      flags: {
        ...DEFAULT_SETTINGS.flags,
        intelligencePlane: true,
        experiments: true,
        curriculum: true,
        selfPlay: true,
        redIntelligence: true,
        compilation: true,
        strategyEvolution: true,
        skillEvolution: true,
      },
      budgets: {
        ...DEFAULT_SETTINGS.budgets,
        // The provider's own quota is the real limit; the governor pauses on
        // its refusal rather than on an envelope of its own here.
        dailyModelCalls: 5000,
        dailyTokens: 50_000_000,
        dailySandboxMinutes: 2000,
      },
      foundryModel: model,
    });
    const hosted = process.env.OSIRUS_SANDBOX_CREDENTIALS === "ci";
    const trialSandbox = hosted
      ? async () => resolveSandbox()
      : async () => new LocalWorkspaceDriver();
    const executor = new InProcessExecutor({
      provider: (id) =>
        new UnoRouterProvider({ model: id, maxRateLimitWaitSeconds: 90 }),
      sandbox: trialSandbox,
      maxTokensPerTrial: 400_000,
    });

    await mkdir(outDir, { recursive: true });
    const log: string[] = [];
    const say = (line: string) => {
      const stamped = `${new Date().toISOString().slice(11, 19)} ${line}`;
      log.push(stamped);
      console.log(stamped);
    };
    say(
      `Foundry runner: capability ${capability}, model ${model}, suite ${JSON.stringify(suite)}, ${maxMinutes} min`,
    );

    let completed = 0;
    while (Date.now() < deadline - 60_000 && completed < cycles) {
      const report = await foundryStep({
        store,
        executor,
        owner: "ci-runner",
        deadline,
        signal: AbortSignal.timeout(deadline - Date.now()),
        sandbox: async () => new LocalWorkspaceDriver(),
        suite,
        maxChallengers: 2,
        focusCapability: completed === 0 ? capability : undefined,
        log: say,
      });
      if (report.completedCycle) completed += 1;
      // The provider refused: sit it out if it lifts within this job, else
      // stop and report where the cycle stands. Nothing was charged to a
      // strategy either way.
      const paused = report.waiting?.match(/^Provider paused until (\S+)/);
      if (paused) {
        const until = Date.parse(paused[1]!);
        if (until > deadline - 10 * 60_000) {
          say(`Stopping: ${report.waiting}`);
          break;
        }
        say(`Waiting: ${report.waiting}`);
        await new Promise((resolve) =>
          setTimeout(resolve, Math.max(0, until - Date.now()) + 5_000),
        );
        continue;
      }
      if (
        report.waiting === "Foundry disabled" ||
        /envelope spent/.test(report.waiting ?? "")
      ) {
        say(`Stopping: ${report.waiting}`);
        break;
      }
      // Nothing moved (rate limit, busy lease): back off instead of spinning.
      if (report.progressed === 0 && report.waiting)
        await new Promise((resolve) => setTimeout(resolve, 30_000));
    }

    const snapshot = store.snapshot();
    await writeFile(`${outDir}/store.json`, JSON.stringify(snapshot, null, 2));
    await writeFile(`${outDir}/log.txt`, log.join("\n"));

    const lines: string[] = [];
    lines.push(`# Foundry cycle report`, "");
    const pause = snapshot.settings.providerPause;
    lines.push(
      `Model: \`${model}\` · capability focus: \`${capability}\` · ${Math.round((Date.now() - startedAt) / 60_000)} min · completed cycles: ${completed}`,
      "",
      pause
        ? `Provider refusal: \`${pause.code}\` at ${pause.at} after ${pause.observedCalls} model calls today; paused until ${pause.until}.`
        : "No provider refusal.",
      "",
    );
    for (const cycle of snapshot.cycles) {
      lines.push(
        `## Cycle ${cycle.id.slice(0, 8)} — ${cycle.capabilityId ?? "none"} (${cycle.status}, phase ${cycle.phase})`,
        "",
      );
      for (const entry of cycle.state.log ?? [])
        lines.push(`- **${entry.phase}** ${entry.note}`);
      const why = cycle.summary.whyImproved as
        Record<string, unknown> | null | undefined;
      if (why)
        lines.push(
          "",
          "**Why did Osirus improve?**",
          "",
          "```json",
          JSON.stringify(why, null, 2),
          "```",
        );
      lines.push("");
    }
    lines.push(
      "## Strategy versions",
      "",
      "| Strategy | Version | Status | Genome | Mutation |",
      "|---|---|---|---|---|",
    );
    for (const version of snapshot.versions)
      lines.push(
        `| ${version.strategyId} | v${version.version} | ${version.status} | ${describeGenome(version.genome)} | ${version.mutation.rationale.replace(/\|/g, "/").slice(0, 120)} |`,
      );
    lines.push(
      "",
      "## Capabilities",
      "",
      "| Capability | Status | Verified rate | Samples |",
      "|---|---|---|---|",
    );
    for (const entry of snapshot.capabilities)
      lines.push(
        `| ${entry.id} | ${entry.status} | ${entry.verifiedSuccessRate ?? "–"} | ${entry.sampleCount} |`,
      );
    const trials = snapshot.trials;
    lines.push(
      "",
      `Trials: ${trials.length} (${trials.filter((trial) => trial.status === "completed").length} completed, ${trials.filter((trial) => trial.result?.verified).length} verified). Experience rows: ${snapshot.experience.length}. Learning artifacts: ${snapshot.artifacts.length}. Dataset versions: ${snapshot.datasets.length}. Generated tasks: ${snapshot.tasks.length}.`,
      "",
      `Usage: ${JSON.stringify(snapshot.ledger)}`,
    );
    await writeFile(`${outDir}/report.md`, lines.join("\n"));
    if (process.env.GITHUB_STEP_SUMMARY)
      await writeFile(process.env.GITHUB_STEP_SUMMARY, lines.join("\n"), {
        flag: "a",
      });

    expect(snapshot.cycles.length).toBeGreaterThan(0);
  });
});
