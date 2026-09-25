import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { registryCheckRunner } from "../../arms/team-runtime";
import { ComputeEngine } from "../../compute/engine";
import { computeTools } from "../../compute/tools";
import { ToolRegistry } from "../../tools/registry";
import {
  formTeam,
  normalizeClaim,
  type CheckRunner,
  type TeamMembers,
  type WorkerDraft,
} from "../team";

// Team pulse (M41): where one worker's draft is wrong, does the team get to
// a verified answer -- and would counting votes have?
//
// Checks run for real: recomputations through compute.run (the production
// tool, via the same registry check runner the arms use) and candidate
// code through `node --test`. Worker drafts come from a fixed fixture, so
// this measures the settling mechanism, not a model. Each task is paired
// with the single worker and with a majority vote over the same drafts.

const exec = promisify(execFile);

export type TeamRecord = {
  id: string;
  level: 3 | 4 | 5;
  family: "MATH_SCIENCE" | "CODING" | "REASONING";
  topology: "parallel_solvers_judge" | "solver_adversary";
  verifiedSuccess: boolean;
  falseCompletion: boolean;
  resolution: string;
  single: { verified: boolean };
  /** What counting votes would have picked, and whether it was right. */
  majority: { pick: string | null; verified: boolean } | null;
  memberCalls: number;
  testsRun: number;
  modelCalls: number;
  toolCalls: number;
  latencyMs: number;
  notes: string;
};

const CONTEXT = {
  runId: "99999999-9999-4999-8999-999999999991",
  stageId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
  armId: "math_science" as const,
  organizationId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  workspaceId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
};

function computeRunner(): { run: CheckRunner; calls: () => number } {
  const registry = new ToolRegistry();
  for (const tool of computeTools(async () => ComputeEngine.inProcess()))
    registry.register(tool);
  let calls = 0;
  const inner = registryCheckRunner(registry, CONTEXT, "math_science");
  return {
    run: async (check) => {
      calls += 1;
      return inner(check);
    },
    calls: () => calls,
  };
}

function scripted(
  members: Partial<TeamMembers> & { runCheck: CheckRunner },
  counter: { calls: number },
): TeamMembers {
  const count =
    <A extends unknown[], R>(
      fn: ((...args: A) => Promise<R>) | undefined,
      fallback: R,
    ) =>
    async (...args: A) => {
      counter.calls += 1;
      return fn ? fn(...args) : fallback;
    };
  return {
    solve: count(members.solve, {
      answer: "",
      claim: "none",
      owner: "x",
    } as WorkerDraft),
    restate: count(members.restate, { claim: "none" }),
    attack: count(members.attack, { claim: "none", issues: [] }),
    discriminate: count(members.discriminate, null),
    revise: count(members.revise, ""),
    runCheck: members.runCheck,
  };
}

const note =
  "Offline fixture: fixed worker drafts, real checks (compute.run, node --test); it measures the settling mechanism, not a model.";

/**
 * L3 MATH_SCIENCE: two of three solvers slip on the arithmetic and agree
 * on the wrong total. A vote picks it; a recomputation does not.
 */
export async function teamMathL3(): Promise<TeamRecord> {
  const startedAt = Date.now();
  const counter = { calls: 0 };
  const compute = computeRunner();
  const draft = "4 crates of 12 bottles hold 45 bottles.";
  const drafts: WorkerDraft[] = [
    {
      answer: draft,
      claim: "45",
      check: { kind: "compute", expression: "4 * 12" },
      owner: "solver-1",
    },
    { answer: "There are 45 bottles.", claim: "45 bottles", owner: "solver-2" },
    {
      answer: "4 x 12 = 48 bottles.",
      claim: "48",
      check: { kind: "compute", expression: "4 * 12" },
      owner: "solver-3",
    },
  ];
  const outcome = await formTeam({
    topology: "parallel_solvers_judge",
    draft,
    solvers: 3,
    members: scripted(
      {
        restate: async () => ({
          claim: drafts[0]!.claim,
          check: drafts[0]!.check,
        }),
        solve: async (seat) => drafts[seat - 1]!,
        runCheck: compute.run,
      },
      counter,
    ),
  });
  const correct = (text: string) => normalizeClaim(text) === "48";
  const verified = /\b48\b/.test(outcome.answer);
  return {
    id: "m41-team-math-l3",
    level: 3,
    family: "MATH_SCIENCE",
    topology: "parallel_solvers_judge",
    verifiedSuccess: verified,
    falseCompletion: !verified,
    resolution: outcome.resolution,
    single: { verified: /\b48\b/.test(draft) },
    majority: {
      pick: outcome.majority,
      verified: outcome.majority !== null && correct(outcome.majority),
    },
    memberCalls: counter.calls,
    testsRun: outcome.testsRun,
    modelCalls: counter.calls,
    toolCalls: compute.calls(),
    latencyMs: Date.now() - startedAt,
    notes: note,
  };
}

/**
 * L4 CODING: two solvers write different implementations; the task's own
 * tests, run against each, decide. Two drafts cannot be outvoted.
 */
export async function teamCodingL4(): Promise<TeamRecord> {
  const startedAt = Date.now();
  const counter = { calls: 0 };
  const root = await mkdtemp(join(tmpdir(), "osirus-team-"));
  let toolCalls = 0;
  try {
    const candidates = {
      a: "export const median = (xs) => { const s = [...xs].sort((p, q) => p - q); return s[Math.floor(s.length / 2)]; };\n",
      b: "export const median = (xs) => { const s = [...xs].sort((p, q) => p - q); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };\n",
    };
    for (const [name, source] of Object.entries(candidates)) {
      await writeFile(join(root, `${name}.mjs`), source);
      await writeFile(
        join(root, `${name}.test.mjs`),
        `import { test } from "node:test";\nimport assert from "node:assert/strict";\nimport { median } from "./${name}.mjs";\ntest("odd", () => assert.equal(median([3, 1, 2]), 2));\ntest("even", () => assert.equal(median([4, 1, 3, 2]), 2.5));\n`,
      );
    }
    // The fixture's stand-in for sandbox.run: the same command, locally.
    const runCheck: CheckRunner = async (check) => {
      if (check.kind !== "command") return null;
      toolCalls += 1;
      try {
        await exec(process.execPath, check.args, {
          cwd: root,
          timeout: 20_000,
        });
        return {
          ran: true,
          observed: "exit 0",
          passed: true,
          evidenceRef: `test:${check.args.join(" ")}`,
        };
      } catch (error) {
        const code = (error as { code?: number }).code ?? 1;
        return {
          ran: true,
          observed: `exit ${code}`,
          passed: false,
          evidenceRef: `test:${check.args.join(" ")}`,
        };
      }
    };
    const draft = `Implemented median:\n${candidates.a}`;
    const outcome = await formTeam({
      topology: "parallel_solvers_judge",
      draft,
      solvers: 2,
      members: scripted(
        {
          restate: async () => ({
            claim: "median takes the middle element",
            check: {
              kind: "command",
              cmd: "node",
              args: ["--test", "a.test.mjs"],
            },
          }),
          solve: async () => ({
            answer: `Implemented median:\n${candidates.b}`,
            claim: "median averages the two middle elements for even input",
            check: {
              kind: "command",
              cmd: "node",
              args: ["--test", "b.test.mjs"],
            },
            owner: "solver-2",
          }),
          runCheck,
        },
        counter,
      ),
    });
    const verified = outcome.answer.includes("% 2 ?");
    return {
      id: "m41-team-coding-l4",
      level: 4,
      family: "CODING",
      topology: "parallel_solvers_judge",
      verifiedSuccess: verified,
      falseCompletion: !verified,
      resolution: outcome.resolution,
      single: { verified: draft.includes("% 2 ?") },
      majority: { pick: outcome.majority, verified: false },
      memberCalls: counter.calls,
      testsRun: outcome.testsRun,
      modelCalls: counter.calls,
      toolCalls,
      latencyMs: Date.now() - startedAt,
      notes: note,
    };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

/**
 * L5 REASONING: the draft declares all requirements met. The adversary
 * attacks twice; the attack its recomputation confirms forces a revision,
 * the unchecked one is recorded and changes nothing.
 */
export async function teamAdversaryL5(): Promise<TeamRecord> {
  const startedAt = Date.now();
  const counter = { calls: 0 };
  const compute = computeRunner();
  const draft =
    "All requirements are met: the three items cost 96 EUR in total, within the 100 EUR budget.";
  const outcome = await formTeam({
    topology: "solver_adversary",
    draft,
    members: scripted(
      {
        attack: async () => ({
          claim: "96",
          issues: [
            {
              kind: "arithmetic",
              statement: "The item prices 40, 35 and 27 do not sum to 96.",
              check: { kind: "compute", expression: "40 + 35 + 27" },
            },
            {
              kind: "assumption",
              statement: "Shipping may not be included in the budget.",
            },
          ],
        }),
        revise: async (_answer, issues) =>
          `Not all requirements are met: the items cost 102 EUR in total, which exceeds the 100 EUR budget by 2 EUR. (${issues.length} confirmed issue.)`,
        runCheck: compute.run,
      },
      counter,
    ),
  });
  const verified =
    /102 EUR/.test(outcome.answer) && /exceeds/.test(outcome.answer);
  return {
    id: "m41-team-adversary-l5",
    level: 5,
    family: "REASONING",
    topology: "solver_adversary",
    verifiedSuccess: verified && outcome.openIssues.length === 1,
    falseCompletion: !verified,
    resolution: outcome.resolution,
    single: { verified: false },
    majority: null,
    memberCalls: counter.calls,
    testsRun: outcome.testsRun,
    modelCalls: counter.calls,
    toolCalls: compute.calls(),
    latencyMs: Date.now() - startedAt,
    notes: note,
  };
}

export const TEAM_TASKS = [
  {
    level: 3,
    family: "MATH_SCIENCE",
    difficulty: "ADVERSARIAL",
    run: teamMathL3,
  },
  { level: 4, family: "CODING", difficulty: "COMPOSED", run: teamCodingL4 },
  {
    level: 5,
    family: "REASONING",
    difficulty: "FRONTIER",
    run: teamAdversaryL5,
  },
] as const;
