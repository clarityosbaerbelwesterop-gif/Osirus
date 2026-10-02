import { describe, expect, it } from "vitest";
import { LabCostBudget } from "../inference/budget";
import {
  NATIVE_PRICE,
  quoteNative,
  reserveNativeQuote,
} from "../programs/pricing";
import { runReasoningPolicy } from "../programs/reasoning";
import { reviewFixtureStep } from "../programs/loop";
import { rougeProgram } from "../programs/rouge";
import { serveRoute } from "../programs/serve";

const online = {
  checkpointPresent: true,
  checkpointValidated: true,
  runtimeOnline: true,
};

describe("model program policy", () => {
  it("records the native price card and refuses to convert euros into the USD budget", () => {
    expect(NATIVE_PRICE.rouge.input).toEqual({
      amount: 2,
      currency: "EUR",
      perTokens: 1_000_000,
    });
    expect(NATIVE_PRICE.rouge.output).toEqual({
      amount: 4,
      currency: "USD",
      perTokens: 1_000_000,
    });
    expect(NATIVE_PRICE.quasnir.input.amount).toBe(1);
    expect(NATIVE_PRICE.darus.output.amount).toBe(2);
    const rouge = quoteNative("rouge", 1_000_000, 1_000_000);
    expect(rouge.eurInput).toBe(2);
    expect(rouge.usd).toBe(4);
    expect(rouge.billed).toBe(false);
    const budget = new LabCostBudget(10);
    expect(() => reserveNativeQuote(budget, rouge)).toThrow(/EUR/);
    expect(budget.spent).toBe(0);
    const quasnir = quoteNative("quasnir", 1_000_000, 1_000_000);
    reserveNativeQuote(budget, quasnir);
    expect(budget.spent).toBe(3);
  });

  it("keeps an untrained program on API fallback even when a checkpoint is online", () => {
    expect(
      serveRoute({ trained: false, measured: false, native: online }).reason,
    ).toBe("native_not_trained");
    expect(
      serveRoute({ trained: true, measured: false, native: online }).reason,
    ).toBe("native_not_good_enough");
    expect(
      serveRoute({
        trained: true,
        measured: true,
        native: { ...online, runtimeOnline: false },
      }).provider,
    ).toBe("unorouter");
    expect(rougeProgram.training.trainingReady).toBe(false);
  });

  it("runs only the phases each program actually declares", () => {
    const rouge = runReasoningPolicy(rougeProgram, "verify this step");
    expect(rouge.phases).toEqual(["thinking", "verification"]);
    expect(rouge.outsideProgram).toBe(false);
    const quasnir = runReasoningPolicy(
      {
        id: "quasnir",
        ui: {
          ...rougeProgram.ui,
          activities: [
            "code_analysis",
            "security_scan",
            "test_execution",
            "patch_verification",
            "waiting",
            "api_fallback",
            "native_inference",
          ],
        },
      },
      "write a poem about the sea",
    );
    expect(quasnir.outsideProgram).toBe(true);
    expect(quasnir.phases).toEqual(["code_analysis"]);
    expect(quasnir.scope).toBe("code");
    const darus = runReasoningPolicy(
      {
        id: "darus",
        ui: {
          ...rougeProgram.ui,
          activities: [
            "deep_reasoning",
            "cross_domain_synthesis",
            "research",
            "planning",
            "waiting",
            "api_fallback",
            "native_inference",
          ],
        },
      },
      "compare across domains and plan",
    );
    expect(darus.phases).toEqual([
      "deep_reasoning",
      "cross_domain_synthesis",
      "planning",
    ]);
    expect(darus.outsideProgram).toBe(false);
  });

  it("checks a fixture step before it can apply", () => {
    expect(reviewFixtureStep([Number.NaN]).allowed).toBe(false);
    expect(reviewFixtureStep([0.1, -0.2]).allowed).toBe(true);
  });
});
