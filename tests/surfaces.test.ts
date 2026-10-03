import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { EffortMotion } from "../src/components/coding/effort-motion";
import {
  codingGrantFromRunInput,
  effortScale,
} from "../src/lib/product/surfaces";

describe("product surfaces", () => {
  it("reads the GitHub grant only from a coding run selection", () => {
    expect(
      codingGrantFromRunInput({
        surface: "coding",
        coding: {
          repository: "https://github.com/acme/widgets",
          branch: "main",
          effort: "hoch",
          model: "darus",
        },
      }),
    ).toMatchObject({ branch: "main", effort: "hoch" });
    expect(
      codingGrantFromRunInput({
        surface: "agent",
        coding: {
          repository: "https://github.com/acme/widgets",
          branch: "main",
          effort: "hoch",
          model: "darus",
        },
      }),
    ).toBeNull();
    expect(
      codingGrantFromRunInput({
        surface: "ai",
        mode: "coding",
      }),
    ).toBeNull();
    expect(codingGrantFromRunInput(null)).toBeNull();
  });

  it("grows effort motion only while a run is active", () => {
    expect(effortScale("leicht")).toBe(1);
    expect(effortScale("ultra")).toBe(5);
    const idle = renderToStaticMarkup(
      createElement(EffortMotion, { effort: "ultra", active: false }),
    );
    expect(idle).toBe("");
    const live = renderToStaticMarkup(
      createElement(EffortMotion, { effort: "hoch", active: true }),
    );
    expect(live.match(/effort-orb/g)?.length).toBe(3);
    expect(live).not.toMatch(/Leicht|Mittel|Hoch|Super|Ultra|%|of /);
  });

  it("names appearance Hell, Dunkel, and System", () => {
    const html = readFileSync(
      join(process.cwd(), "src/components/settings/appearance.tsx"),
      "utf8",
    );
    expect(html).toContain('label: "Hell"');
    expect(html).toContain('label: "Dunkel"');
    expect(html).toContain('label: "System"');
  });

  it("keeps Chat, Agent, and Bot off the GitHub grant", () => {
    const files = [
      "src/components/chat/chat-hub.tsx",
      "src/components/bot/bot-surface.tsx",
      "src/app/api/chat/turns/route.ts",
      "src/app/api/bots/route.ts",
      "src/app/app/page.tsx",
      "src/app/app/agent/page.tsx",
    ];
    for (const file of files) {
      const source = readFileSync(join(process.cwd(), file), "utf8");
      expect(source, file).not.toContain("githubCredential");
      expect(source, file).not.toContain("/api/connectors/github");
      expect(source, file).not.toContain("listGrantedRepositories");
    }
    const coding = readFileSync(
      join(process.cwd(), "src/components/coding/coding-surface.tsx"),
      "utf8",
    );
    expect(coding).toContain("/api/connectors/github/repos");
    expect(coding).toContain('surface: "coding"');
  });
});
