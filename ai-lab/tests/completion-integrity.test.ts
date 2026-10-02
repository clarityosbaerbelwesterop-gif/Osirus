import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { selectArms } from "../programs/contract";
import { darusProgram } from "../programs/darus";
import { evalIntegerExpr, readHorizon } from "../programs/domains";
import { quasnirProgram } from "../programs/quasnir";
import { runReasoningPolicy } from "../programs/reasoning";
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

const MATCHA =
  "Write one short HTML page for a Matcha Latte store. Include an h1 that names the store and a short menu. Do not write any files.";

const CRM =
  "Code a small CRM design as one self-contained HTML page with contacts, a pipeline, and notes. Do not write files and do not claim a benchmark score.";

const CLOSED = [
  "<!DOCTYPE html><html><body>",
  "<h1>Matcha Latte</h1><p>menu</p>",
  "</body></html>",
].join("");

const CUT_OFF = "<html><head><style>body { background";

const CHIP =
  "I will generate the page.\n\nhttp://googleusercontent.com/immersive_entry_chip/0";

const SINK = [
  "<!DOCTYPE html><html><body><h1>Simple CRM</h1>",
  "<script>li.innerHTML = name</script>",
  "</body></html>",
].join("");

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

describe("completion integrity", () => {
  it("shows a closed page and does not show a cut-off or a chip as the page", async () => {
    const pages = [CLOSED, CUT_OFF, CHIP];
    let index = 0;
    const fetchImpl = vi.fn(async () => jsonResponse(pages[index++] ?? ""));
    const answer = await answerWithProgram({
      program: quasnirProgram,
      native: offline,
      messages: [{ role: "user", content: MATCHA }],
      apiKey: "test-key",
      env: { NODE_ENV: "test" },
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(answer.completion).toBe("page");
    expect(answer.text).toContain("<h1>Matcha Latte</h1>");
    expect(answer.text).toContain("</html>");
    expect(answer.measuredEqual).toBe(false);
    expect(answer.trained).toBe(false);

    const cut = await answerWithProgram({
      program: quasnirProgram,
      native: offline,
      messages: [{ role: "user", content: CRM }],
      apiKey: "test-key",
      env: { NODE_ENV: "test" },
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(cut.completion).toBe("incomplete");
    expect(cut.text).toMatch(/not shown as the model's page/);
    expect(cut.text).not.toContain("background");
    expect(cut.text).not.toContain("<style");

    const chip = await answerWithProgram({
      program: darusProgram,
      native: offline,
      messages: [{ role: "user", content: CRM }],
      apiKey: "test-key",
      env: { NODE_ENV: "test" },
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(chip.completion).toBe("incomplete");
    expect(chip.text).not.toContain("immersive_entry_chip");
    expect(chip.text).not.toContain("http://");
    expect(chip.measuredEqual).toBe(false);
  });

  it("reports a security withhold as withheld instead of the model page", async () => {
    const sinks = [
      SINK,
      'password="hunter2"',
      'new Function("return 1")',
      "pickle.loads(blob)",
    ];
    for (const program of programs) {
      for (const sink of sinks) {
        const fetchImpl = vi.fn(async () => jsonResponse(sink));
        const answer = await answerWithProgram({
          program,
          native: offline,
          messages: [{ role: "user", content: CRM }],
          apiKey: "test-key",
          env: { NODE_ENV: "test" },
          fetchImpl: fetchImpl as unknown as typeof fetch,
        });
        expect(answer.completion).toBe("withheld");
        expect(answer.text).toMatch(/withheld/i);
        expect(answer.text).toMatch(/not shown as the model's page/);
        expect(answer.text).not.toContain("innerHTML");
        expect(answer.text).not.toContain("hunter2");
        expect(answer.text).not.toContain("new Function");
        expect(answer.text).not.toContain("pickle.loads");
        expect(answer.text).not.toContain("Simple CRM");
        expect(answer.measuredEqual).toBe(false);
        expect(answer.trained).toBe(false);
        expect(answer.checkpoint).toBeNull();
      }
    }
  });

  it("routes an HTML page through QUASNIR coding and keeps a poem outside", () => {
    const page = runReasoningPolicy(quasnirProgram, MATCHA);
    expect(page.outsideProgram).toBe(false);
    expect(page.phases).toEqual(["code_analysis"]);
    expect(page.note).toMatch(/in-program coding/);
    expect(selectArms(quasnirProgram, MATCHA).map((arm) => arm.id)).toEqual([
      "QUASNIR_CODING",
    ]);

    const poem = runReasoningPolicy(
      quasnirProgram,
      "write a poem about the sea",
    );
    expect(poem.outsideProgram).toBe(true);
    expect(poem.phases).toEqual(["code_analysis"]);
    expect(poem.phases).not.toContain("thinking");
  });

  it("records thinking only after classification ran", () => {
    const thought = runReasoningPolicy(quasnirProgram, "think about the patch");
    expect(thought.outsideProgram).toBe(false);
    expect(thought.phases).toEqual([
      "code_analysis",
      "thinking",
      "patch_verification",
    ]);
    const darusThink = runReasoningPolicy(darusProgram, "think");
    expect(darusThink.phases).toEqual(["deep_reasoning", "thinking"]);
    const darusOther = runReasoningPolicy(darusProgram, "hello");
    expect(darusOther.phases).toEqual(["deep_reasoning"]);
    expect(darusOther.phases).not.toContain("thinking");
    const rouge = runReasoningPolicy(rougeProgram, "hello");
    expect(rouge.phases).toEqual(["thinking", "reasoning"]);
    expect(rouge.phases).not.toContain("research");
    expect(rouge.phases).not.toContain("verification");
  });

  it("grades deeper math and a later horizon failure without a score", () => {
    expect(evalIntegerExpr("(2+3)^2")).toEqual({ ok: true, value: 25 });
    expect(evalIntegerExpr("2^3*2")).toEqual({ ok: true, value: 16 });
    expect(evalIntegerExpr("2+3^2")).toEqual({ ok: true, value: 11 });
    expect(evalIntegerExpr("(10%4)+1")).toEqual({ ok: true, value: 3 });
    expect(evalIntegerExpr("2^9").ok).toBe(false);
    expect(evalIntegerExpr("0^0").ok).toBe(false);
    expect(evalIntegerExpr("2^-1").ok).toBe(false);
    const failed = readHorizon("ok:hold;ok:review;fail:ship");
    expect(failed).toMatchObject({
      count: 3,
      executed: 0,
      scored: false,
      failedAt: 3,
      malformed: false,
    });
    expect(readHorizon("hold. review. stop.")).toMatchObject({
      count: 3,
      failedAt: null,
      executed: 0,
      scored: false,
    });
    const malformed = readHorizon("ok:hold; review");
    expect(malformed.malformed).toBe(true);
    expect(malformed.scored).toBe(false);
  });

  it("does not call the Osirus agent loop from the program answer path", () => {
    const serve = readFileSync(
      new URL("../programs/serve.ts", import.meta.url),
      "utf8",
    );
    const reasoning = readFileSync(
      new URL("../programs/reasoning.ts", import.meta.url),
      "utf8",
    );
    expect(serve).not.toMatch(/agent\/loop|from ".*\/agent\/decision"/);
    expect(reasoning).not.toMatch(/agent\/loop/);
    expect(serve).not.toMatch(/\bdecide\s*\(/);
  });
});
