import { describe, expect, it, vi } from "vitest";
import {
  computerMaterial,
  computerName,
  computerWorthwhile,
  parseComputerStep,
  publicStep,
} from "../src/lib/agents/bot-computer-plan";
import {
  runComputer,
  type ComputerPlanner,
} from "../src/lib/agents/bot-computer";
import {
  UnconfiguredSandbox,
  type SandboxDriver,
} from "../src/lib/sandbox/driver";
import { LocalWorkspaceDriver } from "../src/lib/sandbox/local";

// Every bot's own cloud computer (Grok's code runner / Open Terminal):
// files, shell, packages and processes on a persistent machine per bot.

function scripted(commands: string[]): ComputerPlanner {
  const queue = [...commands];
  return async () => {
    const command = queue.shift();
    return command ? { command, reason: "Test" } : null;
  };
}

describe("when a bot uses its computer", () => {
  it("considers it for computing, files and code, not for chat", () => {
    for (const message of [
      "Rechne 17 hoch 23 aus",
      "Erstelle eine CSV-Datei mit den Monaten",
      "Run this python script and tell me the result",
      "Installiere numpy und berechne den Median von 3, 9, 4",
      "Was liegt in deinem Ordner?",
      "Konvertiere dieses JSON in YAML",
    ])
      expect(computerWorthwhile(message), message).toBe(true);
    for (const message of [
      "Hallo!",
      "Danke dir!",
      "In einem Satz: Was ist Photosynthese?",
      "Wie viele Tage hat ein Schaltjahr? Nur die Zahl.",
      "Schreib mir ein kurzes Gedicht über den Herbst.",
    ])
      expect(computerWorthwhile(message), message).toBe(false);
  });

  it("names one machine per bot and workspace, stable and anonymous", () => {
    const name = computerName("ws-1", "bot-1");
    expect(name).toMatch(/^osirus-pc-[0-9a-f]{24}$/);
    expect(computerName("ws-1", "bot-1")).toBe(name);
    expect(computerName("ws-1", "bot-2")).not.toBe(name);
    expect(computerName("ws-2", "bot-1")).not.toBe(name);
  });

  it("reads the planner's next command, and nothing else", () => {
    expect(
      parseComputerStep(
        'Sure: {"command": "python3 -c \\"print(1)\\"", "reason": "Rechnet"}',
      ),
    ).toEqual({ command: 'python3 -c "print(1)"', reason: "Rechnet" });
    expect(
      parseComputerStep('{"command": null, "reason": "fertig"}'),
    ).toBeNull();
    expect(parseComputerStep('{"command": "   "}')).toBeNull();
    expect(parseComputerStep("no json")).toBeNull();
    expect(parseComputerStep(`{"command": "${"x".repeat(9000)}"}`)).toBeNull();
  });

  it("hands the answering model the real output and nothing invented", () => {
    const material = computerMaterial([
      {
        command: "echo 42",
        reason: "",
        exitCode: 0,
        output: "42",
        durationMs: 5,
      },
    ]);
    expect(material).toContain("$ echo 42");
    expect(material).toContain("[exit 0]");
    expect(material).toMatch(/never invent results/);
    expect(computerMaterial([])).toBe("");
    const long = publicStep({
      command: "yes",
      reason: "",
      exitCode: 0,
      output: "y\n".repeat(5000),
      durationMs: 1,
    });
    expect(long.output.length).toBeLessThan(2_100);
  });
});

describe("a bot's cloud computer", () => {
  it("runs commands, keeps files for the next conversation and keeps bots apart", async () => {
    const driver = new LocalWorkspaceDriver();
    const kept = new Map<string, string>();
    const files = (bot: string) => ({
      load: async () => kept.get(bot) ?? null,
      save: async (archive: string) => {
        kept.set(bot, archive);
        return true;
      },
    });
    const steps: string[] = [];
    const first = await runComputer({
      driver,
      workspaceId: "ws-test",
      botId: "bot-a",
      files: files("bot-a"),
      plan: scripted([
        'echo "Hallo aus dem Cloud-Computer" > notiz.txt && python3 -c "print(6 * 7)"',
      ]),
      onStep: (step) => steps.push(step.output),
    });
    expect(first.error).toBeNull();
    expect(first.steps).toHaveLength(1);
    expect(first.steps[0]!.exitCode).toBe(0);
    expect(first.steps[0]!.output).toContain("42");
    expect(steps).toEqual([first.steps[0]!.output]);
    // Releasing packs the folder and deletes the machine (no snapshot).
    await first.release();
    expect(kept.get("bot-a")?.length ?? 0).toBeGreaterThan(0);

    // Next conversation, same bot, a fresh machine: the file is back.
    const second = await runComputer({
      driver,
      workspaceId: "ws-test",
      botId: "bot-a",
      files: files("bot-a"),
      plan: scripted(["cat notiz.txt && ls"]),
    });
    expect(second.steps[0]!.output).toContain("Hallo aus dem Cloud-Computer");
    await second.release();

    // Another bot has its own folder and does not see it.
    const other = await runComputer({
      driver,
      workspaceId: "ws-test",
      botId: "bot-b",
      files: files("bot-b"),
      plan: scripted(["cat notiz.txt"]),
    });
    expect(other.steps[0]!.exitCode).not.toBe(0);
    await other.release();
  });

  it("works through several steps, each seeing the earlier output", async () => {
    const driver = new LocalWorkspaceDriver();
    const seen: number[] = [];
    const plan: ComputerPlanner = async (steps) => {
      seen.push(steps.length);
      if (steps.length === 0)
        return { command: "printf 3 > n.txt", reason: "" };
      if (steps.length === 1)
        return { command: "echo $(( $(cat n.txt) * 14 ))", reason: "" };
      return null;
    };
    const run = await runComputer({
      driver,
      workspaceId: "w",
      botId: "multi",
      plan,
    });
    expect(seen).toEqual([0, 1, 2]);
    expect(run.steps.map((step) => step.output)).toEqual(["", "42"]);
    await run.release();
  });

  it("does not start a machine when the planner needs none", async () => {
    const driver = new LocalWorkspaceDriver();
    const create = vi.spyOn(driver, "create");
    const run = await runComputer({
      driver,
      workspaceId: "w",
      botId: "idle",
      plan: scripted([]),
    });
    expect(run.steps).toEqual([]);
    expect(create).not.toHaveBeenCalled();
  });

  it("reports an unconfigured host instead of running anything", async () => {
    const plan = vi.fn(scripted(["echo hi"]));
    const run = await runComputer({
      driver: new UnconfiguredSandbox("no token") as SandboxDriver,
      workspaceId: "w",
      botId: "b",
      plan,
    });
    expect(run.error).toBe("not_configured");
    expect(plan).not.toHaveBeenCalled();
  });

  it("keeps the command out of the shell line (a file, not an argument)", async () => {
    const driver = new LocalWorkspaceDriver();
    const run = await runComputer({
      driver,
      workspaceId: "w",
      botId: "quote",
      plan: scripted([`echo 'it'"'"'s fine'; echo "$((2 + 2))"`]),
    });
    expect(run.steps[0]!.output).toBe("it's fine\n4");
    await run.release();
  });
});

describe("a bot computer's machine", () => {
  it("is never persistent: Osirus keeps the folder, not a VM snapshot", async () => {
    const { openComputer } = await import("../src/lib/agents/bot-computer");
    const calls: Array<{ name?: string; persistent?: boolean }> = [];
    const driver = {
      id: "test",
      availability: () => ({ configured: true, driver: "test", reason: "" }),
      reattach: async () => null,
      create: async (input: { name?: string; persistent?: boolean }) => {
        calls.push({ name: input.name, persistent: input.persistent });
        return {
          sandboxId: "fresh",
          readFile: async () => null,
          writeFiles: async () => undefined,
          runCommand: async () => ({ exitCode: 0, stdout: "", stderr: "" }),
        };
      },
    } as unknown as SandboxDriver;
    const machine = await openComputer(driver, "osirus-pc-x", undefined, {
      load: async () => null,
      save: async () => true,
    });
    expect(machine.sandboxId).toBe("fresh");
    expect(calls).toEqual([{ name: "osirus-pc-x", persistent: undefined }]);
  });

  it("takes a fresh machine when the one found under its name is gone", async () => {
    const { openComputer, machineGone } =
      await import("../src/lib/agents/bot-computer");
    const gone = Object.assign(
      new Error("Status code 404 is not ok: Vercel Sandbox not found."),
      { response: { status: 404 } },
    );
    expect(machineGone(gone)).toBe(true);
    expect(machineGone(new Error("network down"))).toBe(false);
    const created: string[] = [];
    const driver = {
      id: "test",
      availability: () => ({ configured: true, driver: "test", reason: "" }),
      reattach: async () => ({
        sandboxId: "deleted",
        readFile: async () => {
          throw gone;
        },
      }),
      create: async (input: { name?: string }) => {
        created.push(input.name ?? "");
        return {
          sandboxId: "fresh",
          readFile: async () => null,
          writeFiles: async () => undefined,
          runCommand: async () => ({ exitCode: 0, stdout: "", stderr: "" }),
        };
      },
    } as unknown as SandboxDriver;
    const machine = await openComputer(driver, "osirus-pc-z");
    expect(machine.sandboxId).toBe("fresh");
    expect(created).toEqual(["osirus-pc-z"]);
  });

  it("does not hide failures to start", async () => {
    const { openComputer } = await import("../src/lib/agents/bot-computer");
    const driver = {
      id: "test",
      availability: () => ({ configured: true, driver: "test", reason: "" }),
      create: async () => {
        throw new Error("network down");
      },
    } as unknown as SandboxDriver;
    await expect(openComputer(driver, "osirus-pc-y")).rejects.toThrow(
      "network down",
    );
  });
});
