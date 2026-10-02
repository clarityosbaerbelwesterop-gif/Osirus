import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ModelSelectors } from "../../src/components/lab/model-selectors";
import { darusProgram } from "../programs/darus";
import { quasnirProgram } from "../programs/quasnir";
import { rougeProgram } from "../programs/rouge";
import { answerWithProgram } from "../programs/serve";

const offline = {
  checkpointPresent: false,
  checkpointValidated: false,
  runtimeOnline: false,
};

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

describe("graders on the completion path", () => {
  it("records a matching math fixture beside the phase that ran", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse("The value is 25."));
    const answer = await answerWithProgram({
      program: rougeProgram,
      native: offline,
      messages: [{ role: "user", content: "math (2+3)^2" }],
      apiKey: "test-key",
      env: { NODE_ENV: "test" },
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(answer.activity).toBe("api_fallback");
    expect(answer.phases).toEqual(["thinking", "reasoning"]);
    expect(answer.phases).not.toContain("research");
    expect(answer.armIds).toContain("ROUGE_MATH");
    expect(answer.fixtureChecks).toContainEqual({
      armId: "ROUGE_MATH",
      phase: "reasoning",
      passed: true,
      detail: "25",
    });
    expect(answer.text).toContain("reasoning · ROUGE_MATH: pass");
    expect(answer.text).toContain("The value is 25.");
    expect(answer.completion).toBe("text");
    expect(answer.measuredEqual).toBe(false);
    expect(answer.trained).toBe(false);
    expect(answer.checkpoint).toBeNull();
  });

  it("is not done when the fallback only labels the arm and skips the fixture", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse("ROUGE_MATH"));
    const answer = await answerWithProgram({
      program: rougeProgram,
      native: offline,
      messages: [{ role: "user", content: "math (2+3)^2" }],
      apiKey: "test-key",
      env: { NODE_ENV: "test" },
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(answer.completion).toBe("incomplete");
    expect(answer.text).toMatch(/not shown as done/);
    expect(answer.text).toContain("reasoning · ROUGE_MATH: fail");
    expect(answer.text).not.toMatch(/^ROUGE_MATH$/);
    expect(answer.fixtureChecks).toContainEqual(
      expect.objectContaining({
        armId: "ROUGE_MATH",
        phase: "reasoning",
        passed: false,
        detail: "fixture skipped",
      }),
    );
    expect(answer.measuredEqual).toBe(false);
    expect(answer.trained).toBe(false);
  });

  it("grades Quasnir and Darus fixtures on fallback without a phase that did not run", async () => {
    const quasnirFetch = vi.fn(async () => jsonResponse("11"));
    const quasnir = await answerWithProgram({
      program: quasnirProgram,
      native: offline,
      messages: [
        {
          role: "user",
          content: "math groups:2;each:5;extra:1;ask:total",
        },
      ],
      apiKey: "test-key",
      env: { NODE_ENV: "test" },
      fetchImpl: quasnirFetch as unknown as typeof fetch,
    });
    expect(quasnir.phases).toEqual(["code_analysis"]);
    expect(quasnir.phases).not.toContain("thinking");
    expect(quasnir.fixtureChecks).toContainEqual({
      armId: "QUASNIR_MATH",
      phase: "code_analysis",
      passed: true,
      detail: "11",
    });
    expect(quasnir.text).toContain("code_analysis · QUASNIR_MATH: pass");
    expect(quasnir.completion).toBe("text");
    expect(quasnir.trained).toBe(false);

    const darusFetch = vi.fn(async () => jsonResponse("hold"));
    const darus = await answerWithProgram({
      program: darusProgram,
      native: offline,
      messages: [{ role: "user", content: "strategy choose:hold;reject:ship" }],
      apiKey: "test-key",
      env: { NODE_ENV: "test" },
      fetchImpl: darusFetch as unknown as typeof fetch,
    });
    expect(darus.phases).toContain("deep_reasoning");
    expect(darus.phases).toContain("planning");
    expect(darus.phases).not.toContain("thinking");
    expect(darus.fixtureChecks).toContainEqual(
      expect.objectContaining({
        armId: "DARUS_STRATEGY",
        phase: "planning",
        passed: true,
      }),
    );
    expect(darus.text).toContain("planning · DARUS_STRATEGY: pass");
    expect(darus.measuredEqual).toBe(false);
    expect(darus.checkpoint).toBeNull();
  });

  it("does not grade a canned sample when the prompt has no fixture", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse("ok"));
    const answer = await answerWithProgram({
      program: rougeProgram,
      native: offline,
      messages: [{ role: "user", content: "hello" }],
      apiKey: "test-key",
      env: { NODE_ENV: "test" },
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(answer.fixtureChecks).toEqual([]);
    expect(answer.completion).toBe("text");
    expect(answer.text).toContain("ok");
    expect(answer.text).not.toMatch(/: pass|: fail/);
    expect(answer.measuredEqual).toBe(false);
  });

  it("still withholds a security completion and still reports an unclosed page", async () => {
    const withheld = await answerWithProgram({
      program: rougeProgram,
      native: offline,
      messages: [{ role: "user", content: "security eval(1)" }],
      apiKey: "test-key",
      env: { NODE_ENV: "test" },
      fetchImpl: vi.fn(async () =>
        jsonResponse("eval(1)"),
      ) as unknown as typeof fetch,
    });
    expect(withheld.completion).toBe("withheld");
    expect(withheld.text).toMatch(/not shown as the model's page/);
    expect(withheld.text).not.toContain("eval(1)");
    expect(withheld.fixtureChecks).toContainEqual(
      expect.objectContaining({
        armId: "ROUGE_CYBERSECURITY",
        passed: true,
      }),
    );
    expect(withheld.phases).not.toContain("security_scan");
    expect(
      withheld.fixtureChecks.find(
        (check) => check.armId === "ROUGE_CYBERSECURITY",
      )?.phase,
    ).toBe("reasoning");

    const cut = await answerWithProgram({
      program: quasnirProgram,
      native: offline,
      messages: [
        {
          role: "user",
          content:
            "Write one short HTML page for a store. Include an h1. Do not write files.",
        },
      ],
      apiKey: "test-key",
      env: { NODE_ENV: "test" },
      fetchImpl: vi.fn(async () =>
        jsonResponse("<html><head><style>body { background"),
      ) as unknown as typeof fetch,
    });
    expect(cut.completion).toBe("incomplete");
    expect(cut.text).toMatch(/not shown as the model's page/);
    expect(cut.text).not.toContain("background");
    expect(cut.trained).toBe(false);
    expect(cut.measuredEqual).toBe(false);
  });

  it("shows a grader only beside a phase that already ran", () => {
    const html = renderToStaticMarkup(
      createElement(ModelSelectors, {
        model: "rouge",
        interaction: "ai",
        activity: "api_fallback",
        phases: ["reasoning"],
        grades: [
          { armId: "ROUGE_MATH", phase: "reasoning", passed: true },
          { armId: "ROUGE_THINKING", phase: "thinking", passed: true },
        ],
        onModelChange: () => undefined,
        onInteractionChange: () => undefined,
      }),
    );
    expect(html).toContain("reasoning");
    expect(html).toContain("ROUGE_MATH: pass");
    expect(html).not.toContain("thinking");
    expect(html).not.toContain("ROUGE_THINKING");
  });
});
