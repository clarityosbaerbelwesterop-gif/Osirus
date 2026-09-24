import type { ArmId } from "../../arms/types";

// Coding task suite registered for M34 Capability Pulse integration.
//
// M34 is not scheduled on this branch. These tasks and the registration
// object are the typed hook M34 can import when the hourly pulse lands.

export type PulseLane = "L1" | "L2" | "L3" | "L4" | "L5";

export type PulseCodingTask = {
  id: string;
  lane: PulseLane;
  capability: string;
  objective: string;
  composition?: ArmId[];
  fixture?: Array<{ path: string; content: string }>;
  hiddenChecks?: {
    files: Array<{ path: string; content: string }>;
    command: string[];
  };
  tags: string[];
};

const MEDIAN_FIXTURE = [
  {
    path: "package.json",
    content: JSON.stringify(
      {
        name: "pulse-median",
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
      "  const sorted = [...values].sort((a, b) => a - b);",
      "  const mid = Math.floor(sorted.length / 2);",
      "  return sorted[mid];",
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
      'test("even length", () => assert.equal(median([1, 2, 3, 4]), 2.5));',
      "",
    ].join("\n"),
  },
];

const UTIL_FIXTURE = [
  {
    path: "package.json",
    content: JSON.stringify(
      {
        name: "pulse-util",
        private: true,
        type: "module",
        scripts: { test: "node --test" },
      },
      null,
      2,
    ),
  },
  {
    path: "src/format.js",
    content: 'export function titleCase(text) {\n  return text;\n}\n',
  },
  {
    path: "src/index.js",
    content: 'export { titleCase } from "./format.js";\n',
  },
  {
    path: "test/format.test.js",
    content: [
      'import { test } from "node:test";',
      'import assert from "node:assert/strict";',
      'import { titleCase } from "../src/index.js";',
      'test("title", () => assert.equal(titleCase("hello world"), "Hello World"));',
      "",
    ].join("\n"),
  },
];

const COMPOUND_FIXTURE = [
  ...MEDIAN_FIXTURE,
  {
    path: "src/stats.js",
    content: [
      "export function median(values) {",
      "  if (!values.length) throw new Error('empty');",
      "  const sorted = [...values].sort((a, b) => a - b);",
      "  const mid = Math.floor(sorted.length / 2);",
      "  return sorted[mid];",
      "}",
      "export function mean(values) {",
      "  return values.reduce((a, b) => a + b, 0) / values.length;",
      "}",
      "",
    ].join("\n"),
  },
  {
    path: "test/stats.test.js",
    content: [
      'import { test } from "node:test";',
      'import assert from "node:assert/strict";',
      'import { median, mean } from "../src/stats.js";',
      'test("even median", () => assert.equal(median([1, 2, 3, 4]), 2.5));',
      'test("mean", () => assert.equal(mean([2, 4]), 3));',
      "",
    ].join("\n"),
  },
];

export const PULSE_CODING_TASKS: PulseCodingTask[] = [
  {
    id: "coding-l1-locate-symbol",
    lane: "L1",
    capability: "coding.repo_understanding",
    objective:
      "In this repository, locate where the median function is defined and which test file imports it. Name the file paths only; do not edit code.",
    fixture: MEDIAN_FIXTURE,
    tags: ["navigation", "read-only"],
  },
  {
    id: "coding-l2-repro-median",
    lane: "L2",
    capability: "coding.debug",
    objective:
      "The median() tests fail for even-length arrays. Reproduce the failure, then fix src/stats.js so all tests pass.",
    fixture: MEDIAN_FIXTURE,
    tags: ["reproduction", "single-file"],
  },
  {
    id: "coding-l3-cross-module",
    lane: "L3",
    capability: "coding.multi_file",
    objective:
      "titleCase in src/format.js fails its test but is re-exported from src/index.js. Find the bug through the import chain, fix it, and run tests.",
    fixture: UTIL_FIXTURE,
    tags: ["imports", "multi-file"],
  },
  {
    id: "coding-l4-compound-stats",
    lane: "L4",
    capability: "coding.debug",
    objective:
      "Both median (even inputs) and mean are wrong. Reproduce each failing test, fix src/stats.js with the smallest coherent change, and verify test + build.",
    fixture: COMPOUND_FIXTURE,
    hiddenChecks: {
      files: [
        {
          path: "test/hidden.test.js",
          content: [
            'import { test } from "node:test";',
            'import assert from "node:assert/strict";',
            'import { median } from "../src/stats.js";',
            'test("hidden even", () => assert.equal(median([10, 2, 8, 4]), 6));',
            "",
          ].join("\n"),
        },
      ],
      command: ["node", "--test"],
    },
    tags: ["compound", "reproduction", "hidden-check"],
  },
  {
    id: "coding-l2-import-graph",
    lane: "L2",
    capability: "coding.repo_understanding",
    objective:
      "Map the import graph from test/format.test.js to the implementation file and summarize the chain in one paragraph.",
    fixture: UTIL_FIXTURE,
    tags: ["navigation", "imports"],
  },
  {
    id: "coding-l3-route-read",
    lane: "L3",
    capability: "coding.repo_understanding",
    objective:
      "List the project's npm scripts and test directories from the repository map. Do not run destructive commands.",
    fixture: MEDIAN_FIXTURE,
    tags: ["world-model", "read-only"],
  },
];

/** Typed registration surface for M34 Capability Pulse. */
export const PULSE_CODING_REGISTRATION = {
  suiteId: "coding",
  version: 1 as const,
  lanes: ["L1", "L2", "L3", "L4", "L5"] as PulseLane[],
  tasks: PULSE_CODING_TASKS,
  /** Import path documented for M34 scheduler wiring. */
  hook: "src/lib/intelligence/pulse/coding-suite.ts",
  evaluateWith: "src/lib/arena/gate.ts",
  baselineWith: "src/lib/agent/baseline.ts",
} as const;

export function pulseTasksByLane(lane: PulseLane) {
  return PULSE_CODING_TASKS.filter((task) => task.lane === lane);
}

export function pulseTaskById(id: string) {
  return PULSE_CODING_TASKS.find((task) => task.id === id) ?? null;
}
