import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LabRoutingPanel } from "../src/components/settings/lab-routing";

describe("lab routing surface", () => {
  it("shows a blocked UnoRouter fallback and does not claim training", () => {
    const html = renderToStaticMarkup(
      createElement(LabRoutingPanel, {
        initial: {
          observedAt: "2026-10-02T12:00:00.000Z",
          trainingStarted: false,
          production: false,
          tracks: [
            {
              trackId: "rouge",
              displayName: "Rouge",
              nativeModelId: "osirus/rouge-1",
              nativeSummary:
                "Native model is not trained and no validated checkpoint is online.",
              routeProvider: "unorouter",
              routeLabel: "UnoRouter API fallback — not Rouge",
              routeModelId: "qwen3:free",
              routeReason: "native_checkpoint_missing",
              live: false,
              blocked: true,
              evaluationState: "unverified",
              fallbackNote: "UnoRouter API fallback — not Rouge",
            },
          ],
        },
      }),
    );
    expect(html).toContain("is a training animation");
    expect(html).toContain("API key missing");
    expect(html).not.toContain("qwen");
    expect(html).not.toContain("UnoRouter");
    expect(html).toContain("Not a native checkpoint.");
    expect(html).toContain("API key missing");
    expect(html).toContain('data-live="false"');
    expect(html).toContain('data-blocked="true"');
  });
});
