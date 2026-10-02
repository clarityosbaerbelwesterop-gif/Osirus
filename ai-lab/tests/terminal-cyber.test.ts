import { describe, expect, it, vi } from "vitest";
import { executeArmPolicy } from "../programs/arm-policy";
import { GATE_CAUGHT_STRINGS, staticSecurityScan } from "../programs/behavior";
import { darusProgram } from "../programs/darus";
import { runTerminalFixture } from "../programs/domains";
import { quasnirProgram } from "../programs/quasnir";
import { rougeProgram } from "../programs/rouge";
import { answerWithProgram } from "../programs/serve";
import type { ModelProgram } from "../programs/types";

const offline = {
  checkpointPresent: false,
  checkpointValidated: false,
  runtimeOnline: false,
};

const programs: readonly ModelProgram[] = [
  rougeProgram,
  quasnirProgram,
  darusProgram,
];

const OUTSIDE = [
  "cat notes",
  "whoami",
  "echo hi there",
  "rm notes",
  "sudo reboot",
  "bash -c id",
  "node -e 1",
  "sh -c id",
  "wget http://example.test",
  "python -c 1",
] as const;

function jsonResponse(text: string): Response {
  return new Response(
    JSON.stringify({
      model: "catalog",
      choices: [{ message: { content: text } }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

describe("terminal refusals and cybersecurity gate fixtures", () => {
  it("refuses anything outside the terminal allowlist and does not spawn a shell", async () => {
    for (const command of OUTSIDE) {
      expect(runTerminalFixture(command)).toEqual({
        spawned: false,
        output: "refused",
      });
    }
    expect(runTerminalFixture("pwd")).toEqual({
      spawned: false,
      output: "/fixture",
    });
    expect(runTerminalFixture("ls")).toEqual({
      spawned: false,
      output: "README notes.txt",
    });
    expect(runTerminalFixture("echo hi")).toEqual({
      spawned: false,
      output: "hi",
    });

    const terminal = rougeProgram.arms.find(
      (arm) => arm.id === "ROUGE_TERMINAL",
    );
    expect(terminal).toBeTruthy();
    const refused = executeArmPolicy(terminal!, "terminal `cat notes`");
    expect(
      refused.steps.some(
        (step) => step === "terminal: refused, no shell spawned",
      ),
    ).toBe(true);
    const allowed = executeArmPolicy(terminal!, "terminal `echo hi`");
    expect(
      allowed.steps.some((step) =>
        step.includes("terminal allowlist: echo hi -> hi"),
      ),
    ).toBe(true);
    expect(allowed.steps.some((step) => step.includes("refused"))).toBe(false);

    const answer = await answerWithProgram({
      program: rougeProgram,
      native: offline,
      messages: [{ role: "user", content: "terminal `cat notes`" }],
      apiKey: "test-key",
      env: { NODE_ENV: "test" },
      fetchImpl: vi.fn(async () =>
        jsonResponse("not run"),
      ) as unknown as typeof fetch,
    });
    expect(answer.armIds).toContain("ROUGE_TERMINAL");
    expect(
      answer.armSteps.some(
        (step) => step === "terminal: refused, no shell spawned",
      ),
    ).toBe(true);
    expect(answer.fixtureChecks).toContainEqual(
      expect.objectContaining({
        armId: "ROUGE_TERMINAL",
        passed: true,
        detail: "refused",
      }),
    );
    expect(answer.measuredEqual).toBe(false);
    expect(answer.trained).toBe(false);
    expect(answer.checkpoint).toBeNull();
    expect(JSON.stringify(answer)).not.toMatch(/\d+(?:\.\d+)?%/);
  });

  it("uses the withhold gate strings as the cybersecurity bad samples", async () => {
    for (const program of programs) {
      const arm = program.arms.find((item) =>
        item.id.endsWith("_CYBERSECURITY"),
      );
      expect(arm).toBeTruthy();
      const bad = arm!.dataset.samples
        .filter((sample) => sample.target !== "0")
        .map((sample) => sample.input);
      expect(bad).toEqual([...GATE_CAUGHT_STRINGS]);
      const clean = arm!.dataset.samples.find(
        (sample) => sample.target === "0",
      );
      expect(clean?.input).toBe("const label = name");
      expect(staticSecurityScan(clean!.input)).toEqual([]);
    }

    for (const sample of GATE_CAUGHT_STRINGS) {
      expect(staticSecurityScan(sample)).toHaveLength(1);
      const answer = await answerWithProgram({
        program: rougeProgram,
        native: offline,
        messages: [{ role: "user", content: `security ${sample}` }],
        apiKey: "test-key",
        env: { NODE_ENV: "test" },
        fetchImpl: vi.fn(async () =>
          jsonResponse(sample),
        ) as unknown as typeof fetch,
      });
      expect(answer.completion).toBe("withheld");
      expect(answer.text).toMatch(/not shown as the model's page/);
      expect(answer.text).not.toContain(sample);
      expect(answer.fixtureChecks).toContainEqual(
        expect.objectContaining({
          armId: "ROUGE_CYBERSECURITY",
          passed: true,
        }),
      );
      expect(answer.measuredEqual).toBe(false);
      expect(answer.trained).toBe(false);
    }
  });
});
