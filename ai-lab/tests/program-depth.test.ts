import { describe, expect, it, vi } from "vitest";
import { executeArmPolicy } from "../programs/arm-policy";
import { darusProgram } from "../programs/darus";
import {
  entailQuery,
  evalIntegerExpr,
  readHorizon,
  runMemoryFixture,
  stepWorld,
} from "../programs/domains";
import { quasnirProgram } from "../programs/quasnir";
import { rougeProgram } from "../programs/rouge";
import { answerWithProgram } from "../programs/serve";

const offline = {
  checkpointPresent: false,
  checkpointValidated: false,
  runtimeOnline: false,
};

const CRM =
  "Code a small CRM design as one self-contained HTML page with contacts, a pipeline, and notes.";

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

describe("later-step program depth", () => {
  it("fails a horizon step whose precondition was not recorded and does not score it", () => {
    const missing = readHorizon("ok:hold;need:review");
    expect(missing).toMatchObject({
      count: 2,
      executed: 0,
      scored: false,
      failedAt: 2,
    });
    const held = readHorizon("ok:review;need:review");
    expect(held.failedAt).toBeNull();
    expect(held.scored).toBe(false);
    expect(held.count).toBe(2);
    expect(readHorizon("ok:hold;ok:review;fail:ship").failedAt).toBe(3);
  });

  it("chains entailment and records the verdict only after it ran", () => {
    expect(entailQuery("facts:rain;rules:rain>wet,wet>cold;query:cold")).toBe(
      "yes",
    );
    expect(entailQuery("facts:rain;rules:wet>cold;query:cold")).toBe("no");
    const arm = rougeProgram.arms.find((item) => item.id === "ROUGE_REASONING");
    expect(arm).toBeTruthy();
    const ran = executeArmPolicy(
      arm!,
      "reason facts:rain;rules:rain>wet;query:wet",
    );
    expect(ran.steps.some((step) => step === "reasoning: entailment yes")).toBe(
      true,
    );
    const plain = executeArmPolicy(arm!, "reason this");
    expect(plain.steps.some((step) => step.includes("entailment"))).toBe(false);
    expect(plain.steps.some((step) => step.includes("classified as"))).toBe(
      true,
    );
  });

  it("parses unary integers and blocks a later world step", () => {
    expect(evalIntegerExpr("-(2+3)")).toEqual({ ok: true, value: -5 });
    expect(evalIntegerExpr("-2^2")).toEqual({ ok: true, value: -4 });
    expect(evalIntegerExpr("(-2)^2")).toEqual({ ok: true, value: 4 });
    expect(evalIntegerExpr("-(2+3)*2")).toEqual({ ok: true, value: -10 });
    expect(stepWorld("pos=0,0;action=right;action=up")).toBe("1,1");
    expect(stepWorld("pos=0,0;action=right;action=right")).toBe("blocked-at:2");
    expect(stepWorld("pos=0,0;action=left")).toBe("blocked");
    expect(runMemoryFixture("set:a=1;get:b")).toBe("missing");
  });

  it("does not show an unclosed script as a page and still withholds document.write", async () => {
    const openScript = [
      "<html><body><h1>Store</h1><script>var label = 1</body></html>",
    ].join("");
    const fetchImpl = vi.fn(async () => jsonResponse(openScript));
    const incomplete = await answerWithProgram({
      program: rougeProgram,
      native: offline,
      messages: [{ role: "user", content: CRM }],
      apiKey: "test-key",
      env: { NODE_ENV: "test" },
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(incomplete.completion).toBe("incomplete");
    expect(incomplete.text).toMatch(/script element is not closed/);
    expect(incomplete.text).not.toContain("var label");
    expect(incomplete.measuredEqual).toBe(false);

    const page = [
      "<html><body><h1>Store</h1>",
      "<script>document.write(name)</script>",
      "</body></html>",
    ].join("");
    const withheld = await answerWithProgram({
      program: quasnirProgram,
      native: offline,
      messages: [{ role: "user", content: CRM }],
      apiKey: "test-key",
      env: { NODE_ENV: "test" },
      fetchImpl: vi.fn(async () =>
        jsonResponse(page),
      ) as unknown as typeof fetch,
    });
    expect(withheld.completion).toBe("withheld");
    expect(withheld.text).not.toContain("document.write");
    expect(withheld.text).not.toContain("<h1>Store</h1>");
    expect(withheld.trained).toBe(false);

    const darus = darusProgram.arms.find(
      (item) => item.id === "DARUS_WORLD_MODEL",
    );
    expect(
      darus?.dataset.samples.some((sample) => sample.target === "blocked-at:2"),
    ).toBe(true);
  });
});
