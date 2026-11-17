import { describe, expect, it } from "vitest";
import {
  capOutput,
  commandFor,
  runnableLanguage,
  runSnippet,
} from "@/lib/chat/run-code";
import type {
  CommandResult,
  SandboxDriver,
  SandboxHandle,
} from "@/lib/sandbox/driver";

// Grok review 2026-11-15: code in a chat answer was never run, so a test
// that failed against its own list went unnoticed.

function fakeDriver(result: Partial<CommandResult> | Error) {
  const calls: {
    created: Array<Record<string, unknown>>;
    files: Array<{ path: string; content: string }>;
    commands: Array<{ cmd: string; args?: string[] }>;
    stopped: number;
  } = { created: [], files: [], commands: [], stopped: 0 };
  const handle: SandboxHandle = {
    sandboxId: "sbx_test",
    writeFiles: async (files) => {
      calls.files.push(...files);
    },
    readFile: async () => null,
    listFiles: async () => [],
    runCommand: async (input) => {
      calls.commands.push(input);
      if (result instanceof Error) throw result;
      return {
        command: input.cmd,
        exitCode: 0,
        stdout: "",
        stderr: "",
        durationMs: 120,
        ...result,
      };
    },
    previewUrl: () => null,
    stop: async () => {
      calls.stopped += 1;
    },
  };
  const driver: SandboxDriver = {
    id: "fake",
    availability: () => ({ configured: true, driver: "fake", reason: "" }),
    create: async (input) => {
      calls.created.push(input as Record<string, unknown>);
      return handle;
    },
  };
  return { driver, calls };
}

describe("running a chat code block", () => {
  it("knows which fenced blocks it can run", () => {
    expect(runnableLanguage("py")).toBe("python");
    expect(runnableLanguage("Python")).toBe("python");
    expect(runnableLanguage("ts")).toBe("typescript");
    expect(runnableLanguage("js")).toBe("javascript");
    expect(runnableLanguage("bash")).toBeNull();
    expect(runnableLanguage(null)).toBeNull();
  });

  it("never puts the code into the command line", () => {
    for (const language of ["python", "javascript", "typescript"] as const) {
      const command = commandFor(language);
      expect(command.cmd).toBe("bash");
      expect(command.args[1]).toMatch(/^set -o pipefail; timeout -k 2 15 /);
      expect(command.args[1]).toContain(`${command.file} 2> >(head -c 65536`);
    }
  });

  it("writes one file, runs it without network and always stops the sandbox", async () => {
    const { driver, calls } = fakeDriver({ stdout: "5050\n" });
    const outcome = await runSnippet({
      driver,
      language: "python",
      code: "print(sum(range(1, 101)))",
    });
    expect(outcome).toMatchObject({
      exitCode: 0,
      stdout: "5050\n",
      timedOut: false,
    });
    expect(calls.files).toEqual([
      { path: "main.py", content: "print(sum(range(1, 101)))" },
    ]);
    // No allowedDomains: the driver's default is deny-all.
    expect(calls.created[0]).not.toHaveProperty("allowedDomains");
    expect(calls.stopped).toBe(1);
  });

  it("reports the time limit and a failing command, and still stops", async () => {
    const slow = fakeDriver({ exitCode: 124, durationMs: 15_000 });
    expect(
      (await runSnippet({ driver: slow.driver, language: "python", code: "x" }))
        .timedOut,
    ).toBe(true);
    const broken = fakeDriver(new Error("socket hang up"));
    const outcome = await runSnippet({
      driver: broken.driver,
      language: "javascript",
      code: "x",
    });
    expect(outcome.exitCode).toBeNull();
    expect(broken.calls.stopped).toBe(1);
  });

  it("keeps the end of long output, where the error is", () => {
    const text = `${"a".repeat(9000)}Traceback: boom`;
    const capped = capOutput(text, 100);
    expect(capped.endsWith("Traceback: boom")).toBe(true);
    expect(capped).toMatch(/^… \(\d+ Zeichen gekürzt\)/);
    expect(capOutput("kurz")).toBe("kurz");
  });
});

describe("POST /api/chat/run", () => {
  it("refuses other languages and an unavailable sandbox with a reason", async () => {
    const { vi } = await import("vitest");
    vi.resetModules();
    vi.doMock("@/lib/product/api", () => ({
      json: (body: unknown, status = 200) => Response.json(body, { status }),
      guardWrite: async (request: Request) => ({
        ok: true,
        identity: { userId: "u" },
        body: await request.json(),
      }),
    }));
    let configured = false;
    vi.doMock("@/lib/sandbox", () => ({
      resolveSandbox: async () => ({
        id: "x",
        availability: () => ({ configured, driver: null, reason: "" }),
      }),
    }));
    const { POST } = await import("../src/app/api/chat/run/route");
    const call = (body: unknown) =>
      POST(
        new Request("https://osirus.test/api/chat/run", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
      );
    const bash = await call({ language: "bash", code: "rm -rf /" });
    expect(bash.status).toBe(400);
    expect((await bash.json()).error).toBe("unsupported_language");
    const off = await call({ language: "python", code: "print(1)" });
    expect(off.status).toBe(503);
    configured = true;
    vi.doUnmock("@/lib/product/api");
    vi.doUnmock("@/lib/sandbox");
  });
});
