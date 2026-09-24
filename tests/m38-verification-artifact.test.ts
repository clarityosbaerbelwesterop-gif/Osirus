import { describe, expect, it } from "vitest";
import { buildContractSchema } from "../src/lib/building/contract";
import { verificationArtifactFromQa } from "../src/lib/building/verification-artifact";

describe("verification artifact", () => {
  it("builds a markdown report from QA and contract coverage", () => {
    const contract = buildContractSchema.parse({
      product: "Export screen",
      stack: "static-html",
      screens: [
        {
          id: "home",
          name: "Home",
          path: "/",
          purpose: "Export",
          acceptance: { texts: ["Export ready"], selectors: ["#save"] },
        },
      ],
    });
    const artifact = verificationArtifactFromQa(contract, {
      mode: "browser",
      url: "http://127.0.0.1:4173/",
      status: 200,
      title: "Export",
      consoleErrors: [],
      failedRequests: [],
      viewports: [
        { name: "desktop", horizontalOverflow: false, screenshotBytes: 1024 },
      ],
      checks: [
        { id: "text:Export ready", passed: true, detail: "found" },
        { id: "selector:#save", passed: true, detail: "1 element" },
        { id: "no-overflow:desktop", passed: true, detail: "ok" },
      ],
    });
    expect(artifact.kind).toBe("verification-report");
    expect(artifact.content).toContain("Export screen");
    expect(artifact.content).toContain("Contract coverage");
    expect(artifact.evidenceRefs).toContain(
      "qa:browser:http://127.0.0.1:4173/",
    );
    expect(artifact.evidenceRefs).toContain("screenshot:desktop");
  });
});
