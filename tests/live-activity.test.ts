import { describe, expect, it } from "vitest";
import type { RunSnapshot } from "../src/lib/runtime/types";
import { liveAgentPills } from "../src/lib/ui/live-activity";

function snapshot(overrides: Partial<RunSnapshot> = {}): RunSnapshot {
  return {
    run: {
      id: "33333333-3333-4333-8333-333333333333",
      sessionId: "11111111-1111-4111-8111-111111111111",
      objective: "fix it",
      status: "running",
      cancelRequested: false,
      armId: "coding",
      acceptanceContract: {},
    },
    stages: [],
    attempts: [],
    dependencies: [],
    artifacts: [],
    approvals: [],
    events: [],
    checkpoints: [],
    messages: [],
    ...overrides,
  };
}

describe("live activity", () => {
  it("shows a tool and a subagent only while a stage is running", () => {
    const pills = liveAgentPills({
      interaction: "agent",
      snapshot: snapshot({
        stages: [{ id: "s1", name: "Change the code", status: "running" }],
        attempts: [{ id: "a1", stage_id: "s1", status: "running" }],
        events: [
          {
            id: "e1",
            runId: "33333333-3333-4333-8333-333333333333",
            sequence: 1,
            type: "agent.step",
            visibility: "user",
            summary: "Read src/median.ts",
            at: "2026-10-03T00:00:00.000Z",
            data: { toolId: "workspace.read" },
          },
        ],
      }),
    });
    expect(pills).toEqual([
      { kind: "tool", id: "e1", label: "Read src/median.ts" },
      { kind: "subagent", id: "a1", label: "Change the code" },
    ]);
  });

  it("does not invent thinking, and does not show finished or waiting steps", () => {
    const waiting = liveAgentPills({
      interaction: "agent",
      snapshot: snapshot({
        stages: [{ id: "s1", name: "Push", status: "waiting" }],
        attempts: [{ id: "a1", stage_id: "s1", status: "running" }],
        events: [
          {
            id: "e1",
            runId: "33333333-3333-4333-8333-333333333333",
            sequence: 1,
            type: "agent.step",
            visibility: "user",
            summary: "Edited src/median.ts",
            at: "2026-10-03T00:00:00.000Z",
            data: { toolId: "workspace.replace" },
          },
        ],
      }),
    });
    expect(waiting).toEqual([]);
    expect(
      liveAgentPills({
        interaction: "ai",
        snapshot: snapshot({
          stages: [{ id: "s1", name: "Think", status: "running" }],
          attempts: [{ id: "a1", stage_id: "s1", status: "running" }],
        }),
      }),
    ).toEqual([]);
  });

  it("does not treat an older tool as current after a later non-tool event", () => {
    const pills = liveAgentPills({
      interaction: "agent",
      snapshot: snapshot({
        stages: [{ id: "s1", name: "Change the code", status: "running" }],
        events: [
          {
            id: "e1",
            runId: "33333333-3333-4333-8333-333333333333",
            sequence: 1,
            type: "agent.step",
            visibility: "user",
            summary: "Read src/median.ts",
            at: "2026-10-03T00:00:00.000Z",
            data: { toolId: "workspace.read" },
          },
          {
            id: "e2",
            runId: "33333333-3333-4333-8333-333333333333",
            sequence: 2,
            type: "planning",
            visibility: "user",
            summary: "Planning",
            at: "2026-10-03T00:00:01.000Z",
            data: {},
          },
        ],
      }),
    });
    expect(pills).toEqual([]);
  });
});
