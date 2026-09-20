import { describe, it, expect } from "vitest";
import { routeCapabilities } from "../src/lib/runtime/router";
import { EventJournal } from "../src/lib/runtime/events";
import { CheckpointStore } from "../src/lib/runtime/checkpoints";
import { selectSkills, type Skill } from "../src/lib/skills";
describe("foundation", () => {
  it("routes compound work", () =>
    expect(routeCapabilities("research sources then implement code")).toEqual([
      "coding",
      "research",
    ]));
  it("reconstructs events", () => {
    const j = new EventJournal();
    j.append({
      id: "1",
      runId: "r",
      type: "planning",
      at: "now",
      data: { status: "running" },
    });
    expect(j.reconstruct("r").status).toBe("running");
  });
  it("restores checkpoints", () => {
    const s = new CheckpointStore();
    s.save({
      runId: "r",
      stage: "plan",
      sequence: 1,
      state: { x: 1 },
      createdAt: "now",
    });
    expect(s.restore("r")).toEqual({ x: 1 });
  });
  it("bounds skills", () => {
    const skills = Array.from({ length: 20 }, (_, i): Skill => ({
      id: String(i),
      slug: String(i),
      version: "1",
      category: "x",
      description: "x",
      capabilities: ["coding"],
      activation: ["code"],
      risk: "low",
      requiredTools: [],
      contextCost: i,
      state: "enabled",
    }));
    expect(selectSkills("code", skills, ["coding"]).length).toBe(8);
  });
});
