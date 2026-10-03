import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ModelSelectors } from "../src/components/lab/model-selectors";
import {
  activityCaption,
  honestRouteLabel,
  labAnswers,
  modelRouteDescription,
} from "../src/lib/lab/honesty";

describe("honest AI mode labels", () => {
  it("names the API fallback and never a native checkpoint", () => {
    expect(honestRouteLabel("rouge")).toBe("ROUGE 1 · API fallback");
    expect(honestRouteLabel("quasnir")).toBe("QUASNIR · API fallback");
    expect(honestRouteLabel("darus")).toBe("DARUS · API fallback");
    expect(honestRouteLabel("external")).toBe("External API");
    for (const model of ["rouge", "quasnir", "darus"] as const) {
      expect(modelRouteDescription(model, "ai")).toMatch(/API fallback/);
      expect(modelRouteDescription(model, "ai")).toMatch(/not a native/i);
    }
  });

  it("does not turn a policy phase into the live caption", () => {
    expect(
      activityCaption({
        activity: "api_fallback",
        model: "darus",
        interaction: "ai",
      }),
    ).toBe("DARUS · API fallback");
    expect(
      activityCaption({
        activity: "thinking",
        model: "rouge",
        interaction: "ai",
      }),
    ).toBe("Idle");
    expect(
      activityCaption({
        activity: "api_fallback",
        model: "darus",
        interaction: "agent",
      }),
    ).toBe("Idle");
  });

  it("routes DARUS only in AI mode", () => {
    expect(labAnswers({ interaction: "ai", model: "darus" })).toBe(true);
    expect(labAnswers({ interaction: "agent", model: "darus" })).toBe(false);
    expect(labAnswers({ interaction: "ai", model: "external" })).toBe(false);
  });

  it("keeps the short option text and describes the fallback route", () => {
    const html = renderToStaticMarkup(
      createElement(ModelSelectors, {
        model: "darus",
        interaction: "ai",
        activity: "api_fallback",
        phases: ["thinking", "deep_reasoning", "native_inference"],
        onModelChange: () => undefined,
        onInteractionChange: () => undefined,
      }),
    );
    expect(html).toContain("DARUS · API fallback");
    expect(html).not.toContain("deep reasoning · API fallback");
    expect(html).not.toContain("Native inference");
    expect(html).toContain(">DARUS<");
    expect(html).toContain("Not a native checkpoint");
    expect(html).toContain('aria-label="Model"');
  });

  it("does not call the agent a model", () => {
    const html = renderToStaticMarkup(
      createElement(ModelSelectors, {
        model: "rouge",
        interaction: "agent",
        activity: null,
        onModelChange: () => undefined,
        onInteractionChange: () => undefined,
      }),
    );
    expect(html).toContain(">Idle<");
    expect(html).toContain("not the agent");
    expect(html).toContain(">ROUGE 1<");
  });
});
