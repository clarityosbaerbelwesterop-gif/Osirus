import { describe, expect, it } from "vitest";
import {
  runComputer,
  type ComputerPlanner,
} from "../src/lib/agents/bot-computer";
import { computerName } from "../src/lib/agents/bot-computer-plan";
import { resolveSandbox } from "../src/lib/sandbox";

// Every bot's own cloud computer in the real Vercel Sandbox. No model is
// involved: a scripted planner issues the commands, so this checks the
// machine itself: shell, python, pip, network policy, and that files
// survive a stop and the next conversation's resume.

function scripted(commands: string[]): ComputerPlanner {
  const queue = [...commands];
  return async () => {
    const command = queue.shift();
    return command ? { command, reason: "live check" } : null;
  };
}

describe("bots' cloud computer in Vercel Sandbox (live)", () => {
  it("runs commands, installs packages, blocks other hosts and keeps files", async () => {
    const driver = await resolveSandbox();
    expect(driver.availability()).toMatchObject({
      configured: true,
      driver: "vercel",
    });
    const workspaceId = "live-eval";
    const botId = `bot-${process.env.GITHUB_RUN_ID ?? Date.now()}`;
    const started = Date.now();

    const first = await runComputer({
      driver,
      workspaceId,
      botId,
      plan: scripted([
        'python3 -c "print(6 * 7)" && echo "Osirus war hier" > notiz.txt && uname -s && pwd',
        "python3 -m pip install --quiet --user tabulate && python3 -c \"import tabulate; print('pip ok')\"",
        "curl -sS -m 8 https://example.com > /dev/null 2>&1 && echo ONLINE || echo BLOCKED",
        "node -e \"console.log('node', process.version)\"",
      ]),
    });
    for (const step of first.steps)
      console.log(
        `$ ${step.command}\n[exit ${step.exitCode}, ${step.durationMs} ms]\n${step.output}\n`,
      );
    expect(first.error).toBeNull();
    expect(first.steps).toHaveLength(4);
    expect(first.steps[0]!.output).toContain("42");
    expect(first.steps[0]!.output).toContain("Linux");
    expect(first.steps[1]!.output).toContain("pip ok");
    expect(first.steps[2]!.output).toContain("BLOCKED");
    expect(first.steps[3]!.output).toMatch(/node v\d+/);
    const firstMs = Date.now() - started;
    await first.release();

    // The next conversation with the same bot finds its files again.
    const resumed = Date.now();
    const second = await runComputer({
      driver,
      workspaceId,
      botId,
      plan: scripted([
        "cat notiz.txt && (python3 -c \"import tabulate; print('package kept')\" || echo 'package not kept')",
      ]),
    });
    console.log(`$ ${second.steps[0]?.command}\n${second.steps[0]?.output}`);
    expect(second.error).toBeNull();
    expect(second.steps[0]!.output).toContain("Osirus war hier");
    console.log(
      `Timing: first conversation ${firstMs} ms (create + 4 steps), resume + 1 step ${Date.now() - resumed} ms`,
    );
    await second.release();

    // Clean up the test machine and its snapshots.
    const handle = await driver.reattach?.(computerName(workspaceId, botId));
    await handle?.destroy?.();
  });
});
