import { afterEach, describe, expect, it } from "vitest";
import { WorkspaceSession } from "../src/lib/coding/session";
import { MemoryWorkspaceStore } from "../src/lib/coding/store";
import { shellQuote } from "../src/lib/coding/workspace";
import type { SandboxHandle } from "../src/lib/sandbox/driver";
import { LocalWorkspaceDriver } from "../src/lib/sandbox/local";

// The dependency install used to hold every coding answer back by 60-90 s.
// It now runs in the background; commands that may need it wait for it,
// reads of the tree do not.

const sessions: WorkspaceSession[] = [];
afterEach(async () => {
  for (const session of sessions.splice(0)) await session.destroy();
});

async function workspaceWithBackground() {
  const { session } = await WorkspaceSession.open({
    driver: new LocalWorkspaceDriver(),
    store: new MemoryWorkspaceStore(),
    runId: crypto.randomUUID(),
    fixture: [{ path: "README.md", content: "# app\n" }],
    install: false,
  });
  sessions.push(session);
  const handle = session.workspace.handle as SandboxHandle;
  // Like Vercel's detached command: started, not awaited.
  handle.startBackground = async (input) => {
    void handle.runCommand({ ...input, timeoutMs: 60_000 });
  };
  return session.workspace;
}

describe("background dependency install", () => {
  it("returns at once, lets reads through and makes builds wait", async () => {
    const workspace = await workspaceWithBackground();
    const started = Date.now();
    expect(
      await workspace.startInstall("sh", [
        "-c",
        "sleep 1.5; echo installed > ../dep-ready.txt",
      ]),
    ).toBe(true);
    expect(Date.now() - started).toBeLessThan(1_000);

    // A read of the tree does not wait for the install.
    const read = await workspace.exec("ls", ["."]);
    expect(read.exitCode).toBe(0);
    expect(Date.now() - started).toBeLessThan(1_400);

    // A command that may need the dependencies waits, then sees them.
    const build = await workspace.exec("sh", ["-c", "cat ../dep-ready.txt"]);
    expect(build.stdout.trim()).toBe("installed");
    const install = workspace.log.find(
      (entry) => entry.command === "dependency install (background)",
    );
    expect(install?.exitCode).toBe(0);

    // Settled: later commands do not check again.
    const before = workspace.log.length;
    await workspace.exec("sh", ["-c", "true"]);
    expect(workspace.log.length).toBe(before + 1);
  });

  it("records a failed install with its exit code", async () => {
    const workspace = await workspaceWithBackground();
    await workspace.startInstall("sh", ["-c", "echo boom >&2; exit 3"]);
    await workspace.exec("sh", ["-c", "true"]);
    const install = workspace.log.find(
      (entry) => entry.command === "dependency install (background)",
    );
    expect(install?.exitCode).toBe(3);
    expect(install?.stdout).toContain("boom");
  });

  it("does not wait when no install was started", async () => {
    const workspace = await workspaceWithBackground();
    await workspace.exec("sh", ["-c", "true"]);
    expect(
      workspace.log.some((entry) => entry.command.includes("install")),
    ).toBe(false);
  });

  it("quotes every word of the install command for sh", () => {
    expect(shellQuote("it's")).toBe(`'it'\\''s'`);
    expect(shellQuote("a b;rm -rf /")).toBe(`'a b;rm -rf /'`);
  });
});
