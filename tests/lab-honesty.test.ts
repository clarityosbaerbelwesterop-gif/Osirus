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
    expect(honestRouteLabel("rouge")).toBe("Bald verfügbar");
    expect(honestRouteLabel("quasnir")).toBe("Bald verfügbar");
    expect(honestRouteLabel("darus")).toBe("Bald verfügbar");
    expect(honestRouteLabel("external")).toBe("UNOROUTER");
    for (const model of ["rouge", "quasnir", "darus"] as const) {
      expect(modelRouteDescription(model, "ai")).not.toMatch(
        /ROUGE|QUASNIR|DARUS/,
      );
    }
  });

  it("does not turn a policy phase into the live caption", () => {
    expect(
      activityCaption({
        activity: "api_fallback",
        model: "darus",
        interaction: "ai",
      }),
    ).toBe("Not a native checkpoint.");
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
    expect(html).toContain("Bald verfügbar");
    expect(html).not.toContain("DARUS");
    expect(html).not.toContain("ROUGE");
    expect(html).not.toContain("QUASNIR");
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
    expect(html).toContain("Bald verfügbar");
    expect(html).not.toContain("ROUGE");
  });
});
