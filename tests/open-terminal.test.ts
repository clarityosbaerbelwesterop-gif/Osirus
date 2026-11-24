import { spawn } from "node:child_process";
import { describe, expect, it } from "vitest";
import {
  callOpenTerminal,
  ensureOpenTerminal,
  parseTerminalResponse,
  terminalCurl,
  terminalPath,
} from "../src/lib/agents/open-terminal";
import { LocalWorkspaceDriver } from "../src/lib/sandbox/local";
import type { SandboxHandle } from "../src/lib/sandbox/driver";

// Open Terminal on a bot's computer: reached from inside the machine over
// loopback, with the key read from a file on the machine.

describe("calls to the machine's Open Terminal", () => {
  it("builds paths from validated parts only", () => {
    expect(
      terminalPath({
        method: "GET",
        path: "/files/list",
        query: { directory: "a b/c", wait: undefined },
      }),
    ).toBe("/files/list?directory=a+b%2Fc");
    expect(() =>
      terminalPath({ method: "GET", path: "/x; rm -rf /" }),
    ).toThrow();
    expect(() =>
      terminalPath({ method: "GET", path: "http://evil/" }),
    ).toThrow();
  });

  it("keeps the key and the body out of the shell line", () => {
    const line = terminalCurl({
      method: "POST",
      path: "/execute",
      query: { wait: 20 },
      body: { command: "echo 'x' && cat /etc/passwd" },
    });
    expect(line).toContain("$(cat .osirus/open-terminal.key)");
    expect(line).toContain("--data-binary @.osirus/open-terminal.request.json");
    expect(line).not.toContain("passwd");
    expect(line).toContain("'http://127.0.0.1:8765/execute?wait=20'");
  });

  it("reads curl's body and status", () => {
    expect(parseTerminalResponse('{"ok":true}\n200')).toEqual({
      status: 200,
      body: { ok: true },
    });
    expect(parseTerminalResponse("plain text\n404")).toEqual({
      status: 404,
      body: "plain text",
    });
    expect(parseTerminalResponse("").status).toBe(0);
  });
});

// Installs Open Terminal from PyPI and starts it: only on request.
const live = process.env.OPEN_TERMINAL_LIVE === "1";

// This test machine reaches PyPI through the host's proxy, if it has one.
const PROXY = Object.fromEntries(
  [
    "HTTPS_PROXY",
    "https_proxy",
    "NO_PROXY",
    "no_proxy",
    "SSL_CERT_FILE",
    "PIP_CERT",
    "REQUESTS_CA_BUNDLE",
  ]
    .map((key) => [key, process.env[key]] as const)
    .filter((entry): entry is [string, string] => Boolean(entry[1])),
);

function withBackground(machine: SandboxHandle, root: string): SandboxHandle {
  return Object.assign(Object.create(machine) as SandboxHandle, {
    runCommand: (input: Parameters<SandboxHandle["runCommand"]>[0]) =>
      machine.runCommand({ ...input, env: { ...PROXY, ...input.env } }),
    startBackground: async (input: { cmd: string; args?: string[] }) => {
      const child = spawn(input.cmd, input.args ?? [], {
        cwd: root,
        detached: true,
        stdio: "ignore",
        env: {
          PATH: process.env.PATH ?? "",
          HOME: root,
          LANG: "C.UTF-8",
          ...PROXY,
        } as unknown as NodeJS.ProcessEnv,
      });
      child.unref();
    },
  });
}

describe.skipIf(!live)("Open Terminal on a machine, live", () => {
  it("installs, starts, runs a command, lists files and processes", async () => {
    const driver = new LocalWorkspaceDriver();
    const base = await driver.create({ name: "ot-live", persistent: true });
    const root = (base as unknown as { root: string }).root;
    const machine = withBackground(base, root);
    await ensureOpenTerminal(machine);
    const run = await callOpenTerminal(machine, {
      method: "POST",
      path: "/execute",
      query: { wait: 20 },
      body: { command: "python3 -c 'print(2**64)' && echo hi > notiz.txt" },
    });
    expect(run.status).toBe(200);
    expect(JSON.stringify(run.body)).toContain("18446744073709551616");
    const files = await callOpenTerminal(machine, {
      method: "GET",
      path: "/files/list",
      query: { directory: "." },
    });
    expect(JSON.stringify(files.body)).toContain("notiz.txt");
    const processes = await callOpenTerminal(machine, {
      method: "GET",
      path: "/execute",
    });
    expect(processes.status).toBe(200);
    // A second call finds the running server and starts nothing new.
    await ensureOpenTerminal(machine);
    await machine.runCommand({
      cmd: "bash",
      args: ["-c", "kill $(cat .osirus/open-terminal.pid) || true"],
    });
    await base.destroy?.();
  }, 240_000);
});
