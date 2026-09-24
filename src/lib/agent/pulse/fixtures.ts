import { ComputeEngine } from "../../compute/engine";
import { computeTools } from "../../compute/tools";
import { ToolRegistry, type ToolContext } from "../../tools/registry";
import type { AgentDecision } from "../decision";
import { runAgentLoop } from "../loop";
import type { PulseTaskResult } from "./types";

// Offline pulse fixtures for lanes the M30 baseline does not cover.

const IDENTITY = {
  runId: "55555555-5555-4555-8555-555555555555",
  stageId: "66666666-6666-4666-8666-666666666666",
  organizationId: "77777777-7777-4777-8777-777777777777",
  workspaceId: "88888888-8888-4888-8888-888888888888",
};

function context(): ToolContext {
  return { ...IDENTITY, armId: "general" };
}

function scripted(decisions: AgentDecision[]) {
  let index = 0;
  return async () => {
    const next = decisions[Math.min(index, decisions.length - 1)]!;
    index += 1;
    return next;
  };
}

async function runProtocol(input: {
  taskId: string;
  lane: PulseTaskResult["lane"];
  level: PulseTaskResult["level"];
  objective: string;
  tools: ToolRegistry;
  decide: () => Promise<AgentDecision>;
  hooks?: import("../loop").LoopHooks;
  grade: (result: Awaited<ReturnType<typeof runAgentLoop>>) => {
    success: boolean;
    verifiedSuccess: boolean;
    notes: string;
  };
}): Promise<PulseTaskResult> {
  const started = Date.now();
  const result = await runAgentLoop({
    objective: input.objective,
    directives: [],
    context: [],
    tools: input.tools,
    toolContext: context(),
    decide: input.decide,
    bounds: {
      maxSteps: 6,
      maxModelCalls: 6,
      maxToolCalls: 4,
      maxWallMs: 5_000,
    },
    hooks: input.hooks,
  });
  const graded = input.grade(result);
  return {
    taskId: input.taskId,
    lane: input.lane,
    level: input.level,
    success: graded.success,
    verifiedSuccess: graded.verifiedSuccess,
    falseCompletion: false,
    modelCalls: result.state.modelCalls,
    toolCalls: result.state.toolCalls,
    steps: result.state.steps.length,
    repairs: 0,
    latencyMs: Date.now() - started,
    notes: graded.notes,
  };
}

/** L3 tool-use: delegate arithmetic to compute.run and state the result. */
export async function toolMultimodalL3(): Promise<PulseTaskResult> {
  const tools = new ToolRegistry();
  for (const tool of computeTools(async () => ComputeEngine.inProcess())) {
    tools.register(tool);
  }
  const objective =
    "What is 17 * 23? Use the compute tool and report the numeric result.";
  return runProtocol({
    taskId: "fixture-tool-multimodal-l3",
    lane: "TOOL_MULTIMODAL",
    level: 3,
    objective,
    tools,
    decide: scripted([
      {
        action: "USE_TOOL",
        toolId: "compute.run",
        toolInput: { expression: "17 * 23" },
        summary: "Multiply with compute.run",
      },
      {
        action: "FINISH",
        answer: "Result: 391",
        summary: "Report the product",
      },
    ]),
    grade: (result) => {
      const answer = result.answer ?? "";
      const success = answer.includes("391");
      return {
        success,
        verifiedSuccess: success && result.status === "finished",
        notes:
          "Offline compute tool fixture. Verified means the answer cites 391 from compute.run.",
      };
    },
  });
}

/** L3 cross-domain: recall a seeded fact and apply it in a short plan. */
export async function crossDomainLongHorizonL3(): Promise<PulseTaskResult> {
  const tools = new ToolRegistry();
  const memory =
    "Atlas preview listens on port 4173. Schema v3 forbids nullable tenant_id.";
  const objective =
    "Continue Atlas. Which port does the preview use, and which schema constraint did we already accept?";
  return runProtocol({
    taskId: "fixture-cross-domain-l3",
    lane: "CROSS_DOMAIN_LONG_HORIZON",
    level: 3,
    objective,
    tools,
    decide: scripted([
      {
        action: "RETRIEVE_MEMORY",
        memoryQuery: "Atlas preview port schema",
        summary: "Recall Atlas facts",
      },
      {
        action: "FINISH",
        answer:
          "Preview port 4173. Schema v3 forbids nullable tenant_id on tenants.",
        summary: "Answer from recalled facts",
      },
    ]),
    hooks: {
      retrieveMemory: async (query) =>
        /atlas|port|schema/i.test(query) ? [memory] : [],
    },
    grade: (result) => {
      const fact = result.state.kernel?.knownFacts[0] ?? "";
      const answer = result.answer ?? "";
      const success =
        fact.includes("4173") &&
        fact.includes("schema v3") &&
        answer.includes("4173");
      return {
        success,
        verifiedSuccess: success && answer.includes("schema v3"),
        notes: "Offline memory + planning fixture across recall and synthesis.",
      };
    },
  });
}
