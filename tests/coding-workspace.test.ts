import { afterEach, describe, expect, it } from "vitest";
import { analyzeFailure } from "../src/lib/coding/failure";
import { discoverCommands } from "../src/lib/coding/commands";
import { mapRepository } from "../src/lib/coding/repo-map";
import {
  repositoryInObjective,
  WorkspaceSession,
} from "../src/lib/coding/session";
import { MemoryWorkspaceStore } from "../src/lib/coding/store";
import { commandPermitted, workspaceTools } from "../src/lib/coding/tools";
import {
  commitAll,
  pushBranch,
  validBranchName,
} from "../src/lib/coding/delivery";
import { LocalWorkspaceDriver } from "../src/lib/sandbox/local";

// The engineering loop's machinery, end to end in a real workspace.
//
// LocalWorkspaceDriver runs real processes in a temporary directory, so the
// failing test below really fails, the edit really lands on disk, and the
// second run really passes. What is not exercised here is the model choosing
// the edit -- that is the agent loop's job, tested in agent-loop.test.ts, and
// live in the live-eval workflow.

const FIXTURE = [
  {
    path: "package.json",
    content: JSON.stringify(
      {
        name: "fixture",
        private: true,
        type: "module",
        scripts: { test: "node --test", build: "node --check src/add.js" },
      },
      null,
      2,
    ),
  },
  { path: "src/add.js", content: "export const add = (a, b) => a - b;\n" },
  {
    path: "test/add.test.js",
    content: [
      'import { test } from "node:test";',
      'import assert from "node:assert/strict";',
      'import { add } from "../src/add.js";',
      'test("adds", () => assert.equal(add(2, 3), 5));',
      "",
    ].join("\n"),
  },
];

const sessions: WorkspaceSession[] = [];
afterEach(async () => {
  for (const session of sessions.splice(0)) await session.destroy();
});

async function open(runId = crypto.randomUUID()) {
  const store = new MemoryWorkspaceStore();
  const driver = new LocalWorkspaceDriver();
  const { session } = await WorkspaceSession.open({
    driver,
    store,
    runId,
    fixture: FIXTURE,
    install: false,
  });
  sessions.push(session);
  return { session, store, driver, runId };
}

describe("coding workspace: failing test, repair, green, diff", () => {
  it("maps the repository and discovers only the commands it declares", async () => {
    const { session } = await open();
    expect(session.record.repositoryMap?.languages[0]?.language).toBe(
      "JavaScript",
    );
    expect(session.record.repositoryMap?.packageManager).toBe("npm");
    expect(session.commands.map((command) => command.phase)).toEqual([
      "test",
      "build",
    ]);
    // No lint or typecheck script exists, so none is invented.
    expect(session.commands.some((command) => command.phase === "lint")).toBe(
      false,
    );
  });

  it("runs the failing test, repairs it, and reaches green with a real diff", async () => {
    const { session } = await open();
    const first = await session.runChecks();
    expect(first[0]?.phase).toBe("test");
    expect(first[0]?.exitCode).not.toBe(0);
    expect(first[0]?.analysis?.failureClass).toBe("assertion");
    // Stops at the first failing phase.
    expect(first).toHaveLength(1);

    await session.workspace.replace("src/add.js", "a - b", "a + b");
    const second = await session.runChecks();
    expect(second.map((run) => [run.phase, run.exitCode])).toEqual([
      ["test", 0],
      ["build", 0],
    ]);
    expect(session.record.diff).toContain(
      "-export const add = (a, b) => a - b;",
    );
    expect(session.record.diff).toContain(
      "+export const add = (a, b) => a + b;",
    );
    // Every command and its exit code is on the record.
    expect(
      session.record.commandLog.filter((entry) =>
        entry.command.startsWith("npm"),
      ),
    ).toHaveLength(3);
  });

  it("reattaches to the same workspace by run", async () => {
    const { session, store, driver, runId } = await open();
    await session.workspace.write("NOTES.md", "kept across stages\n");
    await session.finalize();
    const again = await WorkspaceSession.open({ driver, store, runId });
    expect(again.created).toBe(false);
    expect(await again.session.workspace.read("NOTES.md")).toBe(
      "kept across stages\n",
    );
    sessions.push(again.session);
  });

  it("exposes the workspace as tools that refuse escapes", async () => {
    const { session } = await open();
    const tools = workspaceTools(
      async () => session.workspace,
      () => session.commands,
    );
    const byId = new Map(tools.map((tool) => [tool.id, tool]));
    const context = {
      runId: "r",
      stageId: "s",
      armId: "coding" as const,
      organizationId: "o",
      workspaceId: "w",
    };
    await expect(
      byId.get("workspace.read")!.run({ path: "../../etc/passwd" }, context),
    ).rejects.toThrow(/path_outside_repository/);
    await session.workspace.exec("ln", ["-s", "/etc", "escape"]);
    await expect(
      byId.get("workspace.read")!.run({ path: "escape/passwd" }, context),
    ).rejects.toThrow(/path_escapes_repository/);
    await expect(
      byId
        .get("workspace.write")!
        .run({ path: "escape/owned", content: "x" }, context),
    ).rejects.toThrow(/path_escapes_repository/);
    await expect(
      byId
        .get("workspace.run")!
        .run({ cmd: "sh", args: ["-c", "id"] }, context),
    ).rejects.toThrow(/program_not_allowed/);
    const ran = (await byId
      .get("workspace.run")!
      .run({ commandId: "test" }, context)) as { exitCode: number };
    expect(ran.exitCode).not.toBe(0);
  });

  it("never interprets an argument as shell syntax", async () => {
    const { session } = await open();
    const result = await session.workspace.exec("node", [
      "-e",
      "console.log(process.argv[1])",
      "$(touch pwned); `touch pwned2`",
    ]);
    expect(result.stdout.trim()).toBe("$(touch pwned); `touch pwned2`");
    expect(await session.workspace.fileExists("pwned")).toBe(false);
    expect(await session.workspace.fileExists("pwned2")).toBe(false);
  });

  it("redacts credentials from everything it records", async () => {
    const { session } = await open();
    const token = "ghp_" + "a".repeat(36);
    const record = await session.workspace.exec("node", [
      "-e",
      `console.log("${token} https://user:secretpass@github.com/x")`,
    ]);
    expect(record.stdout).not.toContain(token);
    expect(record.stdout).not.toContain("secretpass");
    expect(record.command).not.toContain(token);
  });
});

describe("delivery", () => {
  it("commits to a new branch and pushes it, never to the base", async () => {
    const { session } = await open();
    const ws = session.workspace;
    await ws.exec("git", ["init", "-q", "--bare", "remote.git"], { cwd: "." });
    await ws.exec("git", ["remote", "add", "origin", "../remote.git"]);
    await ws.replace("src/add.js", "a - b", "a + b");
    await expect(
      commitAll(ws, { branch: "main", base: "main", message: "x" }),
    ).rejects.toThrow("branch_is_protected");
    const { sha } = await commitAll(ws, {
      branch: "osirus/fix-add",
      base: "main",
      message: "Fix add",
    });
    expect(sha).toMatch(/^[0-9a-f]{40}$/);
    const token = "ghp_" + "b".repeat(36);
    await pushBranch(ws, { branch: "osirus/fix-add", token });
    const branches = await ws.exec(
      "git",
      ["--git-dir=remote.git", "branch", "--list"],
      { cwd: "." },
    );
    expect(branches.stdout).toContain("osirus/fix-add");
    expect(branches.stdout).not.toContain("main");
    // The token went to git through the environment only.
    const config = await ws.read(".git/config");
    expect(config).not.toContain(token);
    expect(JSON.stringify(ws.log)).not.toContain(token);
  });
});

describe("command discovery, failure analysis, policy", () => {
  it("does not invent commands for a repository that declares none", () => {
    const map = mapRepository(["README.md", "src/a.ts"], {});
    expect(discoverCommands(map, {}, ["README.md", "src/a.ts"])).toEqual([]);
  });

  it("reads Python, Makefile and plain CI commands", () => {
    const files = [
      "pyproject.toml",
      "Makefile",
      ".github/workflows/ci.yml",
      "pkg/a.py",
    ];
    const contents = {
      pyproject: "",
      "pyproject.toml": '[project]\ndependencies=["pytest", "ruff"]\n',
      Makefile: "build:\n\tpython3 -m build\n",
      ".github/workflows/ci.yml":
        "steps:\n  - run: npm ci && npm test\n  - run: python3 -m pytest -q\n",
    };
    const commands = discoverCommands(
      mapRepository(files, contents),
      contents,
      files,
    );
    expect(commands.map((command) => command.phase)).toEqual([
      "install",
      "lint",
      "test",
      "build",
    ]);
    expect(commands.find((command) => command.phase === "build")?.source).toBe(
      "Makefile#build",
    );
  });

  it("classifies failures and refuses to call environment failures code bugs", () => {
    expect(
      analyzeFailure({
        command: "npm run typecheck",
        exitCode: 2,
        stdout: "src/api.ts(41,7): error TS2345: Argument of type 'string'",
        stderr: "",
      })?.failureClass,
    ).toBe("type");
    const env = analyzeFailure({
      command: "cargo test",
      exitCode: 127,
      stdout: "",
      stderr: "sh: cargo: command not found",
    });
    expect(env?.failureClass).toBe("environment");
    expect(env?.repairable).toBe(false);
    expect(
      analyzeFailure({
        command: "npm ci",
        exitCode: 1,
        stdout: "",
        stderr: "npm ERR! getaddrinfo EAI_AGAIN registry.npmjs.org",
      })?.failureClass,
    ).toBe("network");
    expect(
      analyzeFailure({
        command: "node --test",
        exitCode: 0,
        stdout: "",
        stderr: "",
      }),
    ).toBeNull();
  });

  it("keeps git and package managers away from remotes and credentials", () => {
    expect(commandPermitted("git", ["push", "origin", "main"])).toMatch(
      /not_allowed/,
    );
    expect(
      commandPermitted("git", ["-c", "core.sshCommand=evil", "status"]),
    ).toMatch(/not_allowed/);
    expect(commandPermitted("git", ["-C", "/", "status"])).toMatch(
      /not_allowed/,
    );
    expect(commandPermitted("npm", ["publish"])).toMatch(/not_allowed/);
    expect(commandPermitted("curl", ["https://example.com"])).toMatch(
      /not_allowed/,
    );
    expect(commandPermitted("git", ["diff", "--stat"])).toBeNull();
    expect(validBranchName("main", "main")).toBe("branch_is_protected");
    expect(validBranchName("osirus/fix-add", "main")).toBeNull();
    expect(validBranchName("../evil", "main")).toBe("branch_name_invalid");
  });

  it("finds a repository URL in an objective", () => {
    expect(
      repositoryInObjective(
        "Fix the failing test in https://github.com/acme/widgets please",
      ),
    ).toBe("https://github.com/acme/widgets");
    expect(repositoryInObjective("No repository here")).toBeNull();
  });
});
