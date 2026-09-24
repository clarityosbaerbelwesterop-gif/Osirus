import { describe, expect, it } from "vitest";
import { armFor } from "../src/lib/arms/registry";
import type { ArmStageContext } from "../src/lib/arms/types";
import {
  chooseDepth,
  critiquePlan,
  detectReplanTrigger,
  MemoryPlanRevisionStore,
  planProblems,
  planTask,
  revisePlan,
  unresolvedObjections,
  type PlanGraph,
  type Structured,
} from "../src/lib/agent/plan";

// Thinking V2 with the model replaced by scripted replies. What is under test
// is everything around the model: schema validation, graph validity, depth
// selection, critic handling, revision provenance and the verifier.

function scriptedStructured(replies: unknown[]): {
  structured: Structured;
  calls: Array<{ system: string; user: string }>;
} {
  const calls: Array<{ system: string; user: string }> = [];
  let index = 0;
  const structured: Structured = async (input) => {
    calls.push({ system: input.system, user: input.user });
    const reply = replies[Math.min(index, replies.length - 1)];
    index += 1;
    return input.validate(reply);
  };
  return { structured, calls };
}

const plan: PlanGraph = {
  nodes: [
    {
      id: "inventory",
      title: "Inventory current claims",
      arm: "research",
      action: "List every caller of the claim function",
      dependsOn: [],
      doneWhen: "A list of callers with file paths",
    },
    {
      id: "migrate",
      title: "Move claims to the queue",
      arm: "coding",
      action: "Implement the queue consumer behind a flag",
      dependsOn: ["inventory"],
      doneWhen: "Tests for the consumer pass",
    },
  ],
};

const taskModel = {
  goal: "Move claims to a queue",
  deliverable: "A reversible migration plan",
  successCriteria: ["Every claim stays atomic", "The rollout is reversible"],
  constraints: [],
  assumptions: [
    {
      statement: "Queue supports FIFO",
      confidence: "medium",
      check: "Read docs",
    },
  ],
  unknowns: [],
  risks: [
    {
      risk: "Double processing",
      severity: "high",
      mitigation: "Idempotency keys",
    },
  ],
  complexity: "high",
  riskLevel: "high",
};

describe("thinking depth", () => {
  it("does not plan simple tasks and uses a critic for risky ones", () => {
    expect(chooseDepth({ complexity: "low", risk: "low" })).toBe("direct");
    expect(
      chooseDepth({ complexity: "low", risk: "low", compound: true }),
    ).toBe("standard");
    expect(chooseDepth({ complexity: "medium", risk: "low" })).toBe("standard");
    expect(chooseDepth({ complexity: "low", risk: "high" })).toBe("deep");
  });
});

describe("plan graph", () => {
  it("rejects cycles, unknown dependencies and duplicates", () => {
    expect(planProblems(plan)).toEqual([]);
    expect(
      planProblems({
        nodes: [{ ...plan.nodes[0]!, dependsOn: ["migrate"] }, plan.nodes[1]!],
      }).join(" "),
    ).toMatch(/cycle/);
    expect(
      planProblems({
        nodes: [{ ...plan.nodes[0]!, dependsOn: ["ghost"] }],
      }).join(" "),
    ).toMatch(/unknown node ghost/);
  });

  it("refuses a planner reply whose graph is invalid", async () => {
    const { structured } = scriptedStructured([
      {
        taskModel,
        plan: { nodes: [{ ...plan.nodes[0]!, dependsOn: ["inventory"] }] },
      },
    ]);
    await expect(
      planTask({ structured, objective: "Migrate claims" }),
    ).rejects.toThrow(/plan_invalid/);
  });
});

describe("critic and revision", () => {
  it("makes the planner answer every serious objection", async () => {
    const critic = scriptedStructured([
      {
        verdict: "revise",
        objections: [
          {
            id: "o1",
            severity: "high",
            nodeId: "migrate",
            issue: "No rollback step",
            suggestion: "Add a rollback node",
          },
          {
            id: "o2",
            severity: "low",
            issue: "Titles are vague",
            suggestion: "Be specific",
          },
        ],
      },
    ]);
    const critique = await critiquePlan({
      structured: critic.structured,
      objective: "Migrate claims",
      taskModel: taskModel as never,
      plan,
    });
    expect(critic.calls[0]!.system).toMatch(/critic/);

    const reviser = scriptedStructured([
      {
        plan: {
          nodes: [
            ...plan.nodes,
            {
              id: "rollback",
              title: "Rehearse rollback",
              arm: "coding",
              action: "Flip the flag back and confirm claims resume",
              dependsOn: ["migrate"],
              doneWhen: "Rollback test passes",
            },
          ],
        },
        resolutions: [
          {
            objectionId: "o1",
            action: "addressed",
            note: "Added rollback node",
          },
        ],
      },
    ]);
    const revision = await revisePlan({
      structured: reviser.structured,
      objective: "Migrate claims",
      plan,
      critique,
    });
    expect(revision.plan.nodes.map((node) => node.id)).toContain("rollback");
    expect(unresolvedObjections(critique, revision.resolutions)).toEqual([]);
    expect(unresolvedObjections(critique, [])).toHaveLength(1);
  });

  it("keeps every revision with the reason it was made", async () => {
    const store = new MemoryPlanRevisionStore();
    await store.append("run", {
      trigger: "agent_requested",
      reason: "Initial plan",
      plan,
    });
    await store.append("run", {
      trigger: "repeated_failure",
      reason: "workspace.run failed twice",
      plan: { nodes: [plan.nodes[0]!] },
    });
    const revisions = await store.list("run");
    expect(revisions.map((revision) => revision.revision)).toEqual([1, 2]);
    expect(revisions[0]!.plan.nodes).toHaveLength(2);
    expect(revisions[1]!.trigger).toBe("repeated_failure");
  });
});

describe("replan triggers from the run's own record", () => {
  const step = (overrides: Record<string, unknown>) => ({
    index: 0,
    action: "USE_TOOL" as const,
    summary: "s",
    outcome: "ok" as const,
    latencyMs: 1,
    ...overrides,
  });

  it("detects the same tool failing twice and a missing tool", () => {
    expect(
      detectReplanTrigger({
        steps: [
          step({ toolId: "workspace.run", outcome: "error" }),
          step({ toolId: "workspace.run", outcome: "error" }),
        ] as never,
        budgetUsed: 0.2,
      })?.trigger,
    ).toBe("repeated_failure");
    expect(
      detectReplanTrigger({
        steps: [
          step({
            toolId: "web.search",
            outcome: "error",
            detail: "tool_permission_denied:web.search:unknown_tool",
          }),
        ] as never,
        budgetUsed: 0.1,
      })?.trigger,
    ).toBe("tool_unavailable");
    expect(
      detectReplanTrigger({
        steps: [step({})] as never,
        budgetUsed: 0.8,
        planNodesTotal: 4,
        planNodesDone: 1,
      })?.trigger,
    ).toBe("budget_risk");
    expect(
      detectReplanTrigger({ steps: [step({})] as never, budgetUsed: 0.1 }),
    ).toBeNull();
    expect(
      detectReplanTrigger({
        steps: [
          step({
            toolId: "workspace.read",
            outcome: "ok",
            summary: "Read auth.ts",
            evidenceRefs: ["auth.ts"],
          }),
          step({
            toolId: "workspace.read",
            outcome: "ok",
            summary: "Read auth.ts again",
            evidenceRefs: ["auth.ts"],
          }),
        ] as never,
        budgetUsed: 0.2,
      })?.trigger,
    ).toBe("repeated_diagnostic");
    expect(
      detectReplanTrigger({
        steps: [
          step({
            toolId: "workspace.read",
            outcome: "ok",
            summary: "Read auth.ts",
            evidenceRefs: ["auth.ts"],
          }),
          step({
            toolId: "workspace.read",
            outcome: "ok",
            summary: "Read billing.ts",
            evidenceRefs: ["billing.ts"],
          }),
        ] as never,
        budgetUsed: 0.2,
      }),
    ).toBeNull();
  });
});

describe("thinking verifier", () => {
  function context(state: Record<string, unknown>) {
    return {
      identity: { userId: "u", organizationId: "o", workspaceId: "w" },
      work: {
        runId: "11111111-1111-4111-8111-111111111111",
        stageId: "22222222-2222-4222-8222-222222222222",
        objective: "Plan the claim migration",
        stageInput: { stageKind: "verify" },
      },
      runtime: {
        provider: {
          structured: async () => ({
            value: { verdict: "pass", reason: "complete" },
            usage: {},
          }),
        },
      },
      state,
    } as unknown as ArmStageContext;
  }
  const answer =
    "Plan: inventory callers, then migrate behind a flag, then rehearse rollback. Every claim stays atomic because the stored function remains; the rollout is reversible at each step.";

  it("rejects a plan whose serious critic objection went unanswered", async () => {
    const verdict = await armFor("thinking").verify(
      context({
        answer,
        taskModel,
        planGraph: plan,
        critique: {
          verdict: "revise",
          objections: [
            {
              id: "o1",
              severity: "high",
              issue: "No rollback step",
              suggestion: "Add one",
            },
          ],
        },
        planResolutions: [],
      }),
    );
    expect(verdict.status).toBe("rejected");
  });

  it("verifies a valid plan whose objections were answered", async () => {
    const verdict = await armFor("thinking").verify(
      context({
        answer,
        taskModel,
        planGraph: plan,
        critique: {
          verdict: "revise",
          objections: [
            {
              id: "o1",
              severity: "high",
              issue: "No rollback step",
              suggestion: "Add one",
            },
          ],
        },
        planResolutions: [
          { objectionId: "o1", action: "addressed", note: "Added rollback" },
        ],
      }),
    );
    expect(verdict.status, verdict.summary).toBe("verified");
  });
});
