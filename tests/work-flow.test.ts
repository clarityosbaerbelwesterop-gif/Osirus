import { describe, expect, it } from "vitest";
import {
  isPlaceholderModelId,
  RECOMMENDATION_TABLE,
} from "../src/config/recommendations";
import { catalogModel } from "../src/lib/models/catalog";
import { classifyWorkPrompt } from "../src/lib/work/classify";
import { executeWork } from "../src/lib/work/execute";
import { recommendWork } from "../src/lib/work/recommend";
import { applyWorkSelection } from "../src/lib/work/selection";
import { agentsMentioned } from "../src/lib/agents/mentions";
import {
  intersectKeyModels,
  modelsEndpoint,
} from "../src/lib/models/key-models";

describe("work recommendation", () => {
  it("classifies a short question as S and a refactor as XL", () => {
    expect(classifyWorkPrompt("Was ist 2+2?").difficulty).toBe("S");
    expect(
      classifyWorkPrompt(
        "Refactor the repository and migrate the schema across the whole codebase.",
      ).difficulty,
    ).toBe("XL");
  });

  it("marks the table values as placeholders and keeps reviewer distinct", () => {
    for (const slot of Object.values(RECOMMENDATION_TABLE)) {
      expect(isPlaceholderModelId(slot.executorModelId)).toBe(true);
      expect(isPlaceholderModelId(slot.reviewerModelId)).toBe(true);
      expect(catalogModel(slot.executorModelId)).toBeNull();
      expect(slot.executorModelId).not.toBe(slot.reviewerModelId);
      expect(slot.subAgents.recommended).toBeGreaterThanOrEqual(
        slot.subAgents.min,
      );
      expect(slot.subAgents.recommended).toBeLessThanOrEqual(
        slot.subAgents.max,
      );
    }
  });

  it("labels model, reviewer and sub-agent count as recommended", () => {
    const recommendation = recommendWork("Erkläre MVCC in einem Satz.");
    expect(recommendation.difficulty).toBe("S");
    expect(recommendation.executor.recommended).toBe(true);
    expect(recommendation.reviewer.recommended).toBe(true);
    expect(recommendation.subAgents.recommended).toBe(true);
    expect(recommendation.cost.status).toBe("unavailable");
    expect(recommendation.reason.length).toBeGreaterThan(10);
  });

  it("rejects a reviewer that is the same model as the executor", () => {
    const recommendation = recommendWork("Erkläre MVCC in einem Satz.");
    const refused = applyWorkSelection({
      recommendation,
      executorModelId: "PLACEHOLDER_EXECUTOR_S",
      reviewerModelId: "PLACEHOLDER_EXECUTOR_S",
      allowedModelIds: null,
    });
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.error).toBe("reviewer_same_as_executor");
  });

  it("does not call a model while the recommendation is still a placeholder", async () => {
    const recommendation = recommendWork("Erkläre MVCC in einem Satz.");
    const applied = applyWorkSelection({
      recommendation,
      allowedModelIds: null,
    });
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    let calls = 0;
    const execution = await executeWork({
      prompt: "Erkläre MVCC in einem Satz.",
      selection: applied.selection,
      caller: {
        complete: async () => {
          calls += 1;
          return { text: "should not run" };
        },
      },
    });
    expect(calls).toBe(0);
    expect(execution.status).toBe("unavailable");
    expect(execution.executorText).toBeNull();
    expect(execution.message).toMatch(/Bald verfügbar/);
  });

  it("runs the executor, sub-agents and a different reviewer", async () => {
    const recommendation = recommendWork(
      "Fix the bug in src/median.ts and explain the stack trace.",
    );
    const applied = applyWorkSelection({
      recommendation,
      executorModelId: "glm-5.3-flash",
      reviewerModelId: "claude-opus-5.5",
      subAgentCount: 2,
      allowedModelIds: ["glm-5.3-flash", "claude-opus-5.5"],
    });
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    expect(applied.selection.executorSource).toBe("chosen");
    const seen: string[] = [];
    const execution = await executeWork({
      prompt: "Fix the bug in src/median.ts and explain the stack trace.",
      selection: applied.selection,
      caller: {
        complete: async (input) => {
          seen.push(`${input.purpose}:${input.modelId}`);
          if (input.purpose === "executor") {
            return { text: '{"parts":["read the file","write the fix"]}' };
          }
          if (input.purpose === "reviewer") {
            return {
              text: '{"verdict":"passed","findings":"ok"}',
              costUsd: 0.01,
            };
          }
          return { text: "done", costUsd: 0.002 };
        },
      },
    });
    expect(seen).toEqual([
      "executor:glm-5.3-flash",
      "subagent:glm-5.3-flash",
      "subagent:glm-5.3-flash",
      "reviewer:claude-opus-5.5",
    ]);
    expect(execution.review.verdict).toBe("passed");
    expect(execution.subagents).toHaveLength(2);
    expect(
      execution.subagents.every((item) => item.status === "completed"),
    ).toBe(true);
  });

  it("does not treat a retired name as a catalog model", () => {
    const recommendation = recommendWork("Erkläre MVCC.");
    const refused = applyWorkSelection({
      recommendation,
      executorModelId: "darus",
      reviewerModelId: "claude-opus-5.5",
      allowedModelIds: ["claude-opus-5.5"],
    });
    expect(refused.ok).toBe(false);
  });
});

describe("group chat mentions", () => {
  const members = [
    { id: "a", name: "Ada" },
    { id: "b", name: "Ada Lovelace" },
  ];

  it("asks only the mentioned agent", () => {
    expect(
      agentsMentioned("Hallo @Ada Lovelace, bitte prüfen", members),
    ).toEqual([{ id: "b", name: "Ada Lovelace" }]);
  });

  it("asks nobody when there is no mention", () => {
    expect(agentsMentioned("Hallo zusammen", members)).toEqual([]);
  });
});

describe("key model list", () => {
  it("derives the models URL and keeps only catalog ids the key listed", () => {
    expect(
      modelsEndpoint("https://api.unorouter.com/v1/chat/completions"),
    ).toBe("https://api.unorouter.com/v1/models");
    const models = intersectKeyModels([
      "glm-5.3-flash",
      "not-a-real-model",
      "rouge",
    ]);
    expect(models.map((model) => model.id)).toEqual(["glm-5.3-flash"]);
  });
});
