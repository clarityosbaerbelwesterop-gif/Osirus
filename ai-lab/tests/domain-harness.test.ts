import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { darusProgram } from "../programs/darus";
import { causalPrefixStable, initParams } from "../programs/architecture";
import {
  classifyThinking,
  evalIntegerExpr,
  evalLogic,
  runTerminalFixture,
  uncoveredDomains,
} from "../programs/domains";
import { observeSketch, runProgramHarness } from "../programs/harness";
import { quasnirProgram } from "../programs/quasnir";
import { rougeProgram } from "../programs/rouge";
import { gradeRsiSample } from "../programs/rsi";
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

describe("per-model domain harness", () => {
  it("grades every fixture sample without a benchmark percentage", () => {
    for (const program of programs) {
      expect(uncoveredDomains(program)).toEqual([]);
      expect(program.training.trainingReady).toBe(false);
      expect(program.evalSuite.measured).toBe(false);
      const report = runProgramHarness(program);
      expect(report.measured).toBe(false);
      expect(report.trained).toBe(false);
      const failed = report.rows.filter((item) => !item.passed);
      expect(failed, JSON.stringify(failed)).toEqual([]);
      expect(JSON.stringify(report)).not.toMatch(/\d+(?:\.\d+)?%/);
      expect(JSON.stringify(report)).not.toMatch(/\bAGI\b|\bASI\b/);
      const family =
        program.id === "rouge"
          ? "dense-rope"
          : program.id === "quasnir"
            ? "fim-causal"
            : "routed-dense";
      expect(
        report.rows.some((item) =>
          item.detail.includes(`${family} head step reviewed`),
        ),
      ).toBe(true);
    }
  });

  it("does not apply empty or non-finite gradients and throws on promotion", () => {
    expect(
      gradeRsiSample({ input: "empty", target: "not-applied" }).passed,
    ).toBe(true);
    expect(gradeRsiSample({ input: "nan", target: "not-applied" }).passed).toBe(
      true,
    );
    expect(
      gradeRsiSample({ input: "infinite", target: "not-applied" }).passed,
    ).toBe(true);
    expect(
      gradeRsiSample({ input: "locked:trust_root", target: "threw" }).passed,
    ).toBe(true);
    expect(
      gradeRsiSample({ input: "production", target: "threw" }).passed,
    ).toBe(true);
    expect(gradeRsiSample({ input: "candidate", target: "threw" }).passed).toBe(
      true,
    );
    expect(gradeRsiSample({ input: "finite", target: "applied" }).detail).toBe(
      "head-only fixture step",
    );
  });

  it("keeps terminal coding on the allowlist and off any shell", () => {
    const source = readFileSync(
      new URL("../programs/domains.ts", import.meta.url),
      "utf8",
    );
    expect(source).not.toMatch(/child_process|spawn\(|execFile|execSync/);
    expect(runTerminalFixture("pwd")).toEqual({
      spawned: false,
      output: "/fixture",
    });
    expect(runTerminalFixture("rm notes").spawned).toBe(false);
    expect(runTerminalFixture("rm notes").output).toBe("refused");
    expect(evalIntegerExpr("1/0")).toMatchObject({ ok: false });
    expect(evalLogic("true AND false")).toEqual({ ok: true, value: false });
    expect(classifyThinking("think")).toBe("thinking");
    const params = initParams(rougeProgram.architecture.fixture, 3);
    expect(causalPrefixStable(params, [1, 2, 3])).toBe(true);
  });

  it("keeps each offline answer on that model's fallback path", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            model: "catalog",
            choices: [{ message: { content: "ok" } }],
            usage: { prompt_tokens: 1, completion_tokens: 1 },
          }),
          { status: 200 },
        ),
    );
    for (const program of programs) {
      const answer = await answerWithProgram({
        program,
        native: offline,
        messages: [{ role: "user", content: "code a short note" }],
        apiKey: "test-key",
        env: { NODE_ENV: "test" },
        fetchImpl: fetchImpl as unknown as typeof fetch,
      });
      expect(answer.userLabel).toBe(program.ui.fallbackLabel);
      expect(answer.routingReason).toBe("native_not_trained");
      expect(answer.provenance).toContain("api_fallback / UnoRouter /");
      expect(answer.checkpoint).toBeNull();
      expect(answer.measuredEqual).toBe(false);
      expect(answer.trained).toBe(false);
      expect(answer.armIds.length).toBeGreaterThan(0);
      expect(answer.phases.length).toBeGreaterThan(0);
      expect(answer.armSteps.length).toBeGreaterThan(0);
    }
  });

  it("observes a CRM sketch with the program graders, not a score", () => {
    const page = [
      "<html><body>",
      "<h1>Matcha CRM</h1>",
      "<p>Contacts live in a list.</p>",
      "<p>Pipeline has new and won.</p>",
      "<p>Notes stay on the contact.</p>",
      "</body></html>",
    ].join("");
    for (const program of programs) {
      const rows = observeSketch(program, page);
      expect(rows.every((item) => item.passed)).toBe(true);
      expect(rows.every((item) => item.measured === false)).toBe(true);
    }
    const unsafe = observeSketch(quasnirProgram, "<h1>CRM</h1> eval(input)");
    expect(unsafe.find((item) => item.domain === "cybersecurity")?.passed).toBe(
      false,
    );
  });

  it("withholds a fallback that fails the program security scan", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            model: "catalog",
            choices: [
              {
                message: {
                  content: "li.innerHTML = name",
                },
              },
            ],
            usage: { prompt_tokens: 1, completion_tokens: 1 },
          }),
          { status: 200 },
        ),
    );
    for (const program of programs) {
      const answer = await answerWithProgram({
        program,
        native: offline,
        messages: [{ role: "user", content: "code the page" }],
        apiKey: "test-key",
        env: { NODE_ENV: "test" },
        fetchImpl: fetchImpl as unknown as typeof fetch,
      });
      expect(answer.userLabel).toBe(program.ui.fallbackLabel);
      expect(answer.text).toMatch(/withheld/);
      expect(answer.text).not.toContain("innerHTML");
      expect(answer.checkpoint).toBeNull();
      expect(answer.measuredEqual).toBe(false);
      expect(answer.trained).toBe(false);
    }
  });
});
