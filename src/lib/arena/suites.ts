import type { ArmId } from "../arms/types";
import type { Suite } from "./metrics";

// The arena's tasks.
//
// Small enough to run on a budget, real enough that a mock cannot pass them:
// the research tasks need retrieval, the math tasks need computation that is
// independently checked, the coding task starts from a failing test in a real
// repository, the building task is judged by a browser. Expectations are what
// the task counts as success; verification is still the arm's own verifier.

export type ArenaTask = {
  id: string;
  suite: Suite;
  objective: string;
  /** Force a composition; otherwise the router decides. */
  composition?: ArmId[];
  /** Files for the workspace a coding or building task starts from. */
  fixture?: Array<{ path: string; content: string }>;
  /** Memory items retrievable during the run (memory suite). */
  memory?: string[];
  /** Fault injected into the run (recovery suite). */
  fault?: "first_tool_call_fails";
  expect: {
    /** Substrings the answer must contain (case-insensitive). */
    answerIncludes?: string[];
    /** A verdict in this set counts as success. */
    verdicts?: string[];
  };
};

const FAILING_REPO = [
  {
    path: "package.json",
    content: JSON.stringify(
      {
        name: "arena-fixture",
        private: true,
        type: "module",
        scripts: { test: "node --test", build: "node --check src/stats.js" },
      },
      null,
      2,
    ),
  },
  {
    path: "src/stats.js",
    content: [
      "export function median(values) {",
      "  const sorted = [...values].sort();",
      "  const middle = Math.floor(sorted.length / 2);",
      "  return sorted[middle];",
      "}",
      "",
    ].join("\n"),
  },
  {
    path: "test/stats.test.js",
    content: [
      'import { test } from "node:test";',
      'import assert from "node:assert/strict";',
      'import { median } from "../src/stats.js";',
      'test("odd length", () => assert.equal(median([3, 1, 2]), 2));',
      'test("numeric sort", () => assert.equal(median([10, 9, 100]), 10));',
      'test("even length averages", () => assert.equal(median([1, 2, 3, 4]), 2.5));',
      "",
    ].join("\n"),
  },
];

export const ARENA_TASKS: ArenaTask[] = [
  {
    id: "thinking-migration-plan",
    suite: "thinking",
    objective:
      "Plan how to migrate a production Postgres job queue from polling to LISTEN/NOTIFY without losing jobs. The plan must be reversible at every step. Analyse the risks and decide the rollout order.",
    expect: { answerIncludes: ["rollback"], verdicts: ["verified"] },
  },
  {
    id: "research-mcp-registry",
    suite: "research",
    objective:
      "Research what the official Model Context Protocol registry is, who operates it, and how a server gets listed. Cite the sources you retrieved.",
    expect: {
      answerIncludes: ["registry"],
      verdicts: ["verified", "unverified"],
    },
  },
  {
    id: "math-projectile",
    suite: "math",
    objective:
      "A ball is thrown straight up at 20 m/s from ground level. Using g = 9.81 m/s^2, compute the maximum height in metres and the total time in the air in seconds. Check the units.",
    expect: { answerIncludes: ["20.39", "4.08"], verdicts: ["verified"] },
  },
  {
    id: "math-integral",
    suite: "math",
    objective:
      "Compute the definite integral of x^2 * e^x from 0 to 1 exactly and numerically.",
    expect: { answerIncludes: ["0.718"], verdicts: ["verified"] },
  },
  {
    id: "coding-fix-median",
    suite: "coding",
    objective:
      "The repository's median function fails its tests. Fix src/stats.js so every test passes, run the tests and the build, and show the diff.",
    fixture: FAILING_REPO,
    expect: { verdicts: ["verified"] },
  },
  {
    id: "building-signup-page",
    suite: "building",
    objective:
      "Build a landing page for a small coffee subscription with a hero headline and an email signup form that shows a confirmation message after submit.",
    fixture: [{ path: "README.md", content: "# Coffee landing page\n" }],
    expect: { verdicts: ["verified"] },
  },
  {
    id: "compound-research-then-compute",
    suite: "compound",
    objective:
      "Research the standard acceleration of gravity as defined by the CGPM, then compute how far an object falls from rest in 3 seconds using that value.",
    composition: ["research", "math_science"],
    expect: { answerIncludes: ["44.1"], verdicts: ["verified", "unverified"] },
  },
  {
    id: "memory-uses-prior-decision",
    suite: "memory",
    objective:
      "Which package manager does our billing service use, according to what we decided before?",
    memory: [
      "Decision (verified): the billing service uses pnpm; npm lockfiles are not accepted in that repository.",
    ],
    expect: { answerIncludes: ["pnpm"] },
  },
  {
    id: "recovery-tool-fails-once",
    suite: "recovery",
    objective: "Compute 17 factorial exactly.",
    fault: "first_tool_call_fails",
    expect: { answerIncludes: ["355687428096000"], verdicts: ["verified"] },
  },
];
