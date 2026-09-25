import { spawnSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { arenaById } from "../src/lib/intelligence/generation/arenas";
import type { CodeHypothesisContent } from "../src/lib/intelligence/rsi/exchange";
import {
  credentialFreeEnv,
  evidenceTable,
  findSymbol,
  judgePatch,
  parses,
  patchPrompt,
  patchProposalSchema,
  regressions,
  type PatchProposal,
  spliceSymbol,
  tally,
  type MeasuredRow,
} from "../src/lib/intelligence/software-rsi/pipeline";
import {
  checkPatch,
  onAllowlist,
  parseUnifiedDiff,
  trustRootArea,
  validBranch,
} from "../src/lib/intelligence/software-rsi/policy";
import type { Usage } from "../src/lib/models/provider";
import { UnoRouterProvider } from "../src/lib/models/unorouter";

// The software-RSI pipeline (M45), run by .github/workflows/software-rsi.yml:
//
//   failure → code hypothesis → subsystem → patch (free model) → policy
//   → typecheck, lint, the whole test suite → capability comparison on
//   unseen seeds → regression check on every other arena → draft PR
//
// Nothing here merges. A patch that is not strictly better on seeds the
// model never saw, or that makes any other arena worse, or breaks any test,
// is reported as "no verified improvement" and leaves no branch behind.

const model = process.env.RSI_MODEL ?? "deepseek-v4-pro-0813:free";
const reportPath = process.env.RSI_REPORT ?? "software-rsi-report.json";
const runId = process.env.GITHUB_RUN_ID ?? `local${Date.now()}`;

// Everything the pipeline runs on the patched tree -- tests, typecheck,
// lint, measurements -- executes model-written code, so it runs without a
// single credential (credentialFreeEnv). The model call happens in this
// process, before any patched module could load; publishing happens in a
// later workflow step that runs no project code at all.
function run(cmd: string, args: string[], env: Record<string, string> = {}) {
  const result = spawnSync(cmd, args, {
    encoding: "utf8",
    env: credentialFreeEnv(env),
    maxBuffer: 64 * 1024 * 1024,
    timeout: 45 * 60 * 1000,
  });
  return {
    ok: result.status === 0,
    out: `${result.stdout ?? ""}${result.stderr ?? ""}`.slice(-4000),
  };
}

async function measure(input: {
  arenas: string;
  levels: string;
  seeds: string[];
  count: number;
}): Promise<MeasuredRow[]> {
  const out = join(
    process.env.RUNNER_TEMP ?? tmpdir(),
    `rsi-measure-${Math.random().toString(36).slice(2)}.json`,
  );
  const result = run(
    "npx",
    ["vitest", "run", "--config", "vitest.rsi.config.ts"],
    {
      RSI_EVAL: "evals/rsi-measure.eval.ts",
      RSI_ARENAS: input.arenas,
      RSI_LEVELS: input.levels,
      RSI_SEEDS: input.seeds.join(","),
      RSI_COUNT: String(input.count),
      RSI_OUT: out,
    },
  );
  if (!result.ok) throw new Error(`measurement failed: ${result.out}`);
  return JSON.parse(await readFile(out, "utf8")) as MeasuredRow[];
}

it("attempts one bounded code improvement", async () => {
  const taken = JSON.parse(
    process.env.RSI_HYPOTHESIS ??
      (await readFile(
        process.env.RSI_HYPOTHESIS_FILE ?? "hypothesis.json",
        "utf8",
      )),
  ) as { id: string; calls: number; hypothesis: CodeHypothesisContent };
  const { hypothesis } = taken;
  const report = {
    id: taken.id,
    outcome: "no_improvement" as
      "ready" | "pr_opened" | "no_improvement" | "refused" | "failed",
    prUrl: null as string | null,
    branch: null as string | null,
    summary: "",
    measurements: null as null | {
      baseline: { held: number; instances: number };
      patched: { held: number; instances: number };
      regressions: string[];
      testsPassed: boolean;
    },
    spent: { modelCalls: 0, tokens: 0 },
  };
  const finish = async () => {
    await writeFile(reportPath, JSON.stringify(report));
    if (process.env.GITHUB_STEP_SUMMARY)
      await writeFile(
        process.env.GITHUB_STEP_SUMMARY,
        `## Software RSI\n\n${hypothesis.statement}\n\n**${report.outcome}**: ${report.summary}\n`,
        { flag: "a" },
      );
  };

  // The trust root is never touched; the allowlist is enforced first.
  const area = trustRootArea(hypothesis.file);
  if (hypothesis.trustRoot || area || !onAllowlist(hypothesis.file)) {
    report.outcome = "refused";
    report.summary = `target ${hypothesis.file} is ${area ? `in the trust root (${area})` : "not on the allowlist"}; recorded for the operator`;
    await finish();
    return;
  }
  const arena = arenaById(hypothesis.arena);
  if (!arena) {
    report.outcome = "failed";
    report.summary = `unknown arena ${hypothesis.arena}`;
    await finish();
    return;
  }

  const levels = [...new Set(hypothesis.levels)].filter(
    (level) => level >= 1 && level <= arena.maxLevel,
  );
  const devSeeds = ["dev-1", "dev-2", "dev-3"];
  // Seeds the model never sees: fresh per run.
  const holdoutSeeds = Array.from(
    { length: 6 },
    (_, i) => `holdout-${runId}-${i}`,
  );
  const regressionSeeds = [`regress-${runId}`];
  const baselineDev = await measure({
    arenas: arena.id,
    levels: levels.join(","),
    seeds: devSeeds,
    count: 4,
  });
  const baselineHoldout = await measure({
    arenas: arena.id,
    levels: levels.join(","),
    seeds: holdoutSeeds,
    count: 4,
  });
  const baselineAll = await measure({
    arenas: "all",
    levels: "all",
    seeds: regressionSeeds,
    count: 3,
  });
  const before = tally(baselineHoldout);
  if (before.held === before.instances) {
    report.summary = "the failure no longer reproduces on unseen seeds";
    await finish();
    return;
  }

  const original = await readFile(hypothesis.file, "utf8");
  const span = findSymbol(original, hypothesis.symbol);
  if (!span) {
    report.outcome = "failed";
    report.summary = `symbol ${hypothesis.symbol} not found in ${hypothesis.file}`;
    await finish();
    return;
  }
  const provider = new UnoRouterProvider({
    model,
    maxRateLimitWaitSeconds: 90,
  });
  // Local mechanics check only: a proposal from a file instead of the model,
  // and no branch, push or pull request. The workflow sets neither.
  const scripted = process.env.RSI_PROPOSAL_FILE
    ? patchProposalSchema.parse(
        JSON.parse(await readFile(process.env.RSI_PROPOSAL_FILE, "utf8")),
      )
    : null;
  const dryRun = process.env.RSI_DRY_RUN === "1";
  let previous: { reasons: string[]; replacement: string } | null = null;
  let accepted = false;
  for (let attempt = 0; attempt < Math.max(1, taken.calls); attempt += 1) {
    // Always start from the original file: attempts do not stack.
    await writeFile(hypothesis.file, original);
    const failures = baselineDev.flatMap((row) => row.failures);
    let proposal: PatchProposal;
    if (scripted) proposal = scripted;
    else
      try {
        const response: { value: PatchProposal; usage: Usage } =
          await provider.structured({
            requestId: `software-rsi:${runId}:${attempt}`,
            role: "CODING",
            messages: [
              {
                role: "user",
                content: patchPrompt({
                  file: hypothesis.file,
                  symbol: hypothesis.symbol,
                  statement: hypothesis.statement,
                  expected: hypothesis.expected,
                  verifier: arena.verifier,
                  code: span.text,
                  context:
                    original.length < 40_000
                      ? original
                      : original.slice(0, 40_000),
                  failures,
                  previous,
                }),
              },
            ],
            validate: (value) => patchProposalSchema.parse(value),
          });
        report.spent.modelCalls += 1;
        report.spent.tokens +=
          (response.usage.inputTokens ?? 0) +
          (response.usage.outputTokens ?? 0);
        proposal = response.value;
      } catch (error) {
        report.spent.modelCalls += 1;
        previous = {
          reasons: [
            `no valid proposal: ${error instanceof Error ? error.message.slice(0, 200) : "error"}`,
          ],
          replacement: "",
        };
        continue;
      }
    const patched = spliceSymbol(original, span, proposal.replacement);
    if (!parses(patched)) {
      previous = {
        reasons: ["the replacement does not parse"],
        replacement: proposal.replacement,
      };
      continue;
    }
    await writeFile(hypothesis.file, patched);
    run("npx", ["prettier", "--write", hypothesis.file]);
    // git runs no project code: it keeps the job's environment.
    const diff = spawnSync(
      "git",
      ["diff", "--unified=0", "--", hypothesis.file],
      { encoding: "utf8" },
    ).stdout;
    const policy = checkPatch(parseUnifiedDiff(diff));
    if (!policy.allowed) {
      previous = {
        reasons: [
          ...policy.violations,
          ...policy.trustRoot.map((entry) => `trust root: ${entry}`),
        ],
        replacement: proposal.replacement,
      };
      continue;
    }
    const typecheck = run("npx", ["tsc", "--noEmit", "-p", "."]);
    const lint = run("npx", ["eslint", hypothesis.file]);
    const devAfter = typecheck.ok
      ? await measure({
          arenas: arena.id,
          levels: levels.join(","),
          seeds: devSeeds,
          count: 4,
        }).catch(() => [])
      : [];
    const devTally = tally(devAfter);
    if (!typecheck.ok || !lint.ok || devTally.held <= tally(baselineDev).held) {
      previous = {
        reasons: [
          ...(typecheck.ok ? [] : [`typecheck: ${typecheck.out.slice(-600)}`]),
          ...(lint.ok ? [] : [`lint: ${lint.out.slice(-400)}`]),
          ...(devAfter.length
            ? devAfter
                .flatMap((row) =>
                  row.failures.map(
                    (failure) => `still fails: ${failure.detail}`,
                  ),
                )
                .slice(0, 4)
            : []),
        ],
        replacement: proposal.replacement,
      };
      continue;
    }
    const tests = run("npx", ["vitest", "run"]);
    const holdoutAfter = await measure({
      arenas: arena.id,
      levels: levels.join(","),
      seeds: holdoutSeeds,
      count: 4,
    });
    const allAfter = await measure({
      arenas: "all",
      levels: "all",
      seeds: regressionSeeds,
      count: 3,
    });
    const regressed = regressions(baselineAll, allAfter);
    const after = tally(holdoutAfter);
    const judgement = judgePatch({
      testsPassed: tests.ok,
      typecheckPassed: typecheck.ok,
      lintPassed: lint.ok,
      baseline: before,
      patched: after,
      regressions: regressed,
    });
    report.measurements = {
      baseline: before,
      patched: after,
      regressions: regressed,
      testsPassed: tests.ok,
    };
    if (!judgement.improved) {
      previous = {
        reasons: judgement.reasons,
        replacement: proposal.replacement,
      };
      report.summary = judgement.reasons.join("; ");
      continue;
    }
    accepted = true;
    if (dryRun) {
      report.outcome = "no_improvement";
      report.summary = `dry run: would open a draft PR (${before.held}/${before.instances} → ${after.held}/${after.instances} unseen)`;
      await writeFile(hypothesis.file, original);
      break;
    }
    const branch = `rsi/${arena.id.replace(/_/g, "-")}-${runId}`.toLowerCase();
    if (!validBranch(branch)) throw new Error(`invalid branch ${branch}`);
    const body = [
      `Automated, bounded improvement proposed by Osirus's software-RSI pipeline (M45). **Draft: a human decides; nothing merges automatically.**`,
      ``,
      `**Hypothesis:** ${hypothesis.statement}`,
      ``,
      `**Rationale (model):** ${proposal.rationale}`,
      ``,
      evidenceTable({
        arena: arena.id,
        levels,
        baseline: before,
        patched: after,
        dev: devTally,
        regressionCells: baselineAll.length,
        regressions: regressed,
        checks: {
          "Path policy (allowlist, trust root, static rules)": true,
          Typecheck: typecheck.ok,
          Lint: lint.ok,
          "Full test suite": tests.ok,
        },
        modelCalls: report.spent.modelCalls,
        model,
      }),
      ``,
      `Unseen seeds: \`${holdoutSeeds.join("`, `")}\` (never shown to the model). Oracle: ${arena.verifier}. Every command on the patched tree ran without credentials.`,
    ].join("\n");
    // Hand the patch to the publish step: only the target file's diff,
    // never whatever else the tree might hold after running patched code.
    const patch = spawnSync("git", ["diff", "--", hypothesis.file], {
      encoding: "utf8",
    }).stdout;
    const out = process.env.RUNNER_TEMP ?? tmpdir();
    await writeFile(join(out, "patch.diff"), patch);
    await writeFile(join(out, "pr-body.md"), body);
    await writeFile(
      join(out, "pr-title.txt"),
      `rsi: ${hypothesis.symbol} holds more of ${arena.id} (${before.held}/${before.instances} → ${after.held}/${after.instances} unseen)`,
    );
    await writeFile(hypothesis.file, original);
    report.outcome = "ready";
    report.branch = branch;
    report.summary = `${before.held}/${before.instances} → ${after.held}/${after.instances} on unseen seeds; no regressions; all tests pass`;
    break;
  }
  if (!accepted) {
    await writeFile(hypothesis.file, original);
    if (!report.summary)
      report.summary = previous
        ? `no attempt passed: ${previous.reasons.slice(0, 3).join("; ")}`
        : "no attempt was made";
  }
  await finish();
  expect(["pr_opened", "no_improvement", "refused", "failed"]).toContain(
    report.outcome,
  );
});
