import { afterEach, describe, expect, it } from "vitest";
import { NAV_OPERATIONS, runNavigation } from "../src/lib/coding/navigation";
import {
  buildSoftwareWorldModel,
  renderSoftwareWorldModel,
  selectWorldModelFiles,
} from "../src/lib/coding/software-world-model";
import { mapRepository } from "../src/lib/coding/repo-map";
import {
  createReproductionArtifact,
  evaluateReproductionGate,
  isBugClassTask,
  mergeReproductionArtifacts,
  parseReproductionArtifact,
} from "../src/lib/coding/reproduction";
import {
  PULSE_CODING_REGISTRATION,
  PULSE_CODING_TASKS,
  pulseTasksByLane,
} from "../src/lib/intelligence/pulse/coding-suite";
import { WorkspaceSession } from "../src/lib/coding/session";
import { MemoryWorkspaceStore } from "../src/lib/coding/store";
import { LocalWorkspaceDriver } from "../src/lib/sandbox/local";

const FIXTURE = [
  {
    path: "package.json",
    content: JSON.stringify(
      {
        name: "m35-fixture",
        private: true,
        type: "module",
        scripts: { test: "node --test" },
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
      "  return sorted[0];",
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
      'test("median", () => assert.equal(median([3, 1, 2]), 2));',
      "",
    ].join("\n"),
  },
  {
    path: "src/app/api/health/route.js",
    content: 'export function GET() { return new Response("ok"); }\n',
  },
];

const sessions: WorkspaceSession[] = [];
afterEach(async () => {
  for (const session of sessions.splice(0)) await session.destroy();
});

async function openFixture() {
  const store = new MemoryWorkspaceStore();
  const driver = new LocalWorkspaceDriver();
  const { session } = await WorkspaceSession.open({
    driver,
    store,
    runId: crypto.randomUUID(),
    fixture: FIXTURE,
    install: false,
  });
  sessions.push(session);
  return session;
}

describe("M35 software world model", () => {
  it("builds modules, symbols, imports and routes from fixture files", () => {
    const files = FIXTURE.map((file) => file.path);
    const contents = Object.fromEntries(
      FIXTURE.map((file) => [file.path, file.content]),
    );
    const map = mapRepository(files, contents);
    const model = buildSoftwareWorldModel({ files, contents, map });
    expect(model.version).toBe(1);
    expect(model.symbols.some((symbol) => symbol.name === "median")).toBe(true);
    expect(model.modules.some((module) => module.path === "src/stats.js")).toBe(
      true,
    );
    expect(model.routes.some((route) => route.method === "GET")).toBe(true);
    expect(
      model.testMappings.some((mapping) => mapping.testFile.includes("test")),
    ).toBe(true);
    const summary = renderSoftwareWorldModel(model, "summary");
    expect(summary).toContain("[software model]");
    expect(summary).toContain("median");
  });

  it("selects bounded source files for incremental reads", () => {
    const files = [
      "src/a.ts",
      "node_modules/x/index.js",
      ".git/config",
      "README.md",
      "src/b.py",
    ];
    expect(selectWorldModelFiles(files)).toEqual(["src/a.ts", "src/b.py"]);
  });

  it("persists on workspace open", async () => {
    const session = await openFixture();
    expect(session.record.softwareWorldModel).not.toBeNull();
    expect(session.record.softwareWorldModel?.symbols.length).toBeGreaterThan(
      0,
    );
  });
});

describe("M35 semantic navigation", () => {
  it("finds definition and references for median", async () => {
    const session = await openFixture();
    const model = session.record.softwareWorldModel!;
    const definition = await runNavigation(model, session.workspace, {
      op: "find_definition",
      symbol: "median",
    });
    expect(definition.matches.length).toBeGreaterThan(0);
    expect(definition.matches[0]?.file).toBe("src/stats.js");

    const refs = await runNavigation(model, session.workspace, {
      op: "find_references",
      symbol: "median",
      limit: 10,
    });
    expect(refs.matches.length).toBeGreaterThan(0);

    const tests = await runNavigation(model, session.workspace, {
      op: "test_mapping",
      symbol: "stats",
    });
    expect(tests.matches.length).toBeGreaterThan(0);
    expect(NAV_OPERATIONS).toContain("git_blame");
  });
});

describe("M35 reproduction artifact", () => {
  it("detects bug-class objectives", () => {
    expect(isBugClassTask("Fix the failing median test")).toBe(true);
    expect(isBugClassTask("Explain what median means")).toBe(false);
  });

  it("parses and merges artifacts", () => {
    const raw = JSON.stringify({
      command: "npm test",
      expected: "tests pass",
      actual: "assertion failure",
      status: "reproduced",
    });
    const parsed = parseReproductionArtifact(raw);
    expect(parsed?.status).toBe("reproduced");
    const merged = mergeReproductionArtifacts([], parsed!);
    expect(merged).toHaveLength(1);
    expect(
      mergeReproductionArtifacts(
        merged,
        createReproductionArtifact({
          id: parsed!.id,
          command: "npm test",
          expected: "tests pass",
          actual: "still failing",
          status: "reproduced",
        }),
      ),
    ).toHaveLength(1);
  });

  it("gates bug tasks when reproduction is required", () => {
    const fail = evaluateReproductionGate({
      objective: "Fix the bug in median",
      requireReproduction: true,
      workspaceAvailable: true,
      artifacts: [],
    });
    expect(fail.ok).toBe(false);

    const pass = evaluateReproductionGate({
      objective: "Fix the bug in median",
      requireReproduction: true,
      workspaceAvailable: true,
      artifacts: [
        createReproductionArtifact({
          command: "npm test",
          expected: "green",
          actual: "red",
          status: "reproduced",
        }),
      ],
    });
    expect(pass.ok).toBe(true);
  });
});

describe("M35 capability pulse registration", () => {
  it("registers L1-L4 coding tasks for M34 hook", () => {
    expect(PULSE_CODING_REGISTRATION.version).toBe(1);
    expect(PULSE_CODING_REGISTRATION.suiteId).toBe("coding");
    expect(PULSE_CODING_TASKS.length).toBeGreaterThanOrEqual(5);
    expect(pulseTasksByLane("L1").length).toBeGreaterThanOrEqual(1);
    expect(pulseTasksByLane("L4").length).toBeGreaterThanOrEqual(1);
    expect(PULSE_CODING_REGISTRATION.hook).toContain("pulse/coding-suite");
  });
});
