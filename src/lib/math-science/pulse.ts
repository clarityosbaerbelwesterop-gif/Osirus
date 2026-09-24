import { ComputeEngine } from "../compute/engine";
import { computeTools } from "../compute/tools";
import { ToolRegistry } from "../tools/registry";
import type { ArmId } from "../arms/types";
import type { AgentDecision } from "../agent/decision";
import { runAgentLoop } from "../agent/loop";
import { computeEvidenceCheck } from "../verification/compute-evidence";
import {
  formalizeProblem,
  renderFormalizationPlan,
  type ProblemFormalization,
} from "./formalization";
import {
  counterexampleGateCheck,
  recomputationGateCheck,
  sanityGateCheck,
} from "./verification-gates";
import {
  MATH_SCIENCE_PULSE_TASKS,
  pulseTasksUpToLevel,
  type PulseLevel,
  type PulseTask,
} from "./pulse-suite";

// M37 — Math/Science capability pulse.
//
// Offline fixture protocol over the production agent loop, like M30.2
// baseline. Independent graders (compute evidence, verification gates)
// decide success. Pulse hooks let the scheduler tick or baseline runner
// sample math/science health without a second evaluator.

export type PulseRecord = {
  id: string;
  level: PulseLevel;
  domain: "MATH" | "SCIENCE";
  objective: string;
  liveProvider: false;
  mode: "offline-fixture";
  success: boolean;
  verifiedSuccess: boolean;
  falseCompletion: boolean;
  formalization: ProblemFormalization;
  gates: {
    sanity: string;
    recomputation: string;
    counterexample: string;
  };
  modelCalls: number;
  toolCalls: number;
  steps: number;
  latencyMs: number;
  notes: string;
};

export type PulseHook = (records: PulseRecord[]) => void | Promise<void>;

const hooks: PulseHook[] = [];

/** Register a callback invoked after each pulse run (metrics, logging, CI). */
export function registerMathSciencePulseHook(hook: PulseHook) {
  hooks.push(hook);
}

export async function notifyPulseHooks(records: PulseRecord[]) {
  for (const hook of hooks) {
    await hook(records);
  }
}

const IDENTITY = {
  runId: "m37-pulse-run",
  stageId: "m37-pulse-stage",
  organizationId: "m37-pulse-org",
  workspaceId: "m37-pulse-ws",
};

function context(armId: ArmId) {
  return { ...IDENTITY, armId };
}

function scripted(decisions: AgentDecision[]) {
  let index = 0;
  return async () => {
    const next = decisions[Math.min(index, decisions.length - 1)]!;
    index += 1;
    return next;
  };
}

function decisionsForTask(task: PulseTask): AgentDecision[] {
  if (task.expectUnderdetermined) {
    return [
      {
        action: "FINISH",
        summary: "Report underdetermined system",
        answer:
          "The problem is underdetermined: x + y = 10 has infinitely many solutions. Not enough equations were given to fix x and y uniquely. A second independent relation is needed before Result: can be stated.",
      },
    ];
  }
  if (task.id === "pulse-l5-universal") {
    return [
      {
        action: "USE_TOOL",
        summary: "Test n=40 for a counterexample",
        toolId: "compute.run",
        toolInput: { op: "evaluate", expression: "40^2 + 40 + 41" },
      },
      {
        action: "FINISH",
        summary: "Report counterexample at n=40",
        answer:
          "Tested n=40 as a counterexample. The expression evaluates to 1681, which is 41 squared and not prime. The claim is not true for every positive integer n.\n\nResult: composite at n=40 (value 1681)",
      },
    ];
  }
  if (task.id === "pulse-l1-discount") {
    return [
      {
        action: "USE_TOOL",
        summary: "Apply 10% discount",
        toolId: "compute.run",
        toolInput: { op: "evaluate", expression: "50 * 0.9" },
      },
      {
        action: "FINISH",
        summary: "State discounted price",
        answer: "Result: 45",
      },
    ];
  }
  if (task.id === "pulse-l1-unit-sum") {
    return [
      {
        action: "USE_TOOL",
        summary: "Sum masses",
        toolId: "compute.run",
        toolInput: { op: "evaluate", expression: "2.0 + 3.5" },
      },
      {
        action: "FINISH",
        summary: "State total mass",
        answer: "Result: 5.5 kg",
      },
    ];
  }
  if (task.id === "pulse-l2-linear") {
    return [
      {
        action: "USE_TOOL",
        summary: "Solve for x",
        toolId: "compute.run",
        toolInput: { op: "solve", equations: ["3*x+7=22"], variables: ["x"] },
      },
      {
        action: "FINISH",
        summary: "State solution",
        answer: "3x + 7 = 22 gives x = 5.\n\nResult: 5",
      },
    ];
  }
  if (task.id === "pulse-l2-moles") {
    return [
      {
        action: "USE_TOOL",
        summary: "Compute moles",
        toolId: "compute.run",
        toolInput: { op: "evaluate", expression: "18 / 18" },
      },
      {
        action: "FINISH",
        summary: "State moles",
        answer: "Result: 1 mol",
      },
    ];
  }
  if (task.id === "pulse-l3-discount-tax") {
    return [
      {
        action: "USE_TOOL",
        summary: "Discount then tax",
        toolId: "compute.run",
        toolInput: { op: "evaluate", expression: "80 * 0.85 * 1.1" },
      },
      {
        action: "FINISH",
        summary: "State amount paid",
        answer:
          "Result: 74.8 after a 15% discount and 10% tax on the discounted price.",
      },
    ];
  }
  if (task.id === "pulse-l3-projectile") {
    return [
      {
        action: "USE_TOOL",
        summary: "Maximum height",
        toolId: "compute.run",
        toolInput: {
          op: "evaluate",
          expression: "20^2 / (2 * 9.81)",
        },
      },
      {
        action: "FINISH",
        summary: "State height with units",
        answer: "Result: 20.387359836901 m maximum height with g = 9.81 m/s².",
      },
    ];
  }
  if (task.id === "pulse-l4-pump-leak") {
    return [
      {
        action: "USE_TOOL",
        summary: "Net fill rate",
        toolId: "compute.run",
        toolInput: { op: "evaluate", expression: "1/(1/6-1/12)" },
      },
      {
        action: "FINISH",
        summary: "State fill time accounting for leak",
        answer:
          "Result: 12 hours. The pump-only 6 hour estimate ignores the leak; net rate 1/6 - 1/12 fills the tank in 12 hours.",
      },
    ];
  }
  if (task.id === "pulse-l4-integral") {
    return [
      {
        action: "USE_TOOL",
        summary: "Definite integral",
        toolId: "compute.run",
        toolInput: {
          op: "integrate",
          expression: "x^2 * exp(x)",
          variable: "x",
          lower: 0,
          upper: 1,
        },
      },
      {
        action: "FINISH",
        summary: "State integral value",
        answer:
          "Result: 0.71828182845906 (integral of x^2 * exp(x) from 0 to 1, numeric).",
      },
    ];
  }
  return [
    {
      action: "FINISH",
      summary: "Unimplemented pulse fixture",
      answer: "Result: 0",
    },
  ];
}

async function falseCompletion(
  task: PulseTask,
  tools: ToolRegistry,
  claim: string,
  claimHolds: boolean,
): Promise<boolean> {
  const result = await runAgentLoop({
    objective: task.objective,
    directives: [],
    context: [],
    tools,
    toolContext: context("math_science"),
    decide: async () => ({
      action: "FINISH",
      summary: "Unsupported completion claim",
      answer: claim,
    }),
  });
  return result.status === "finished" && !claimHolds;
}

async function runPulseTask(task: PulseTask): Promise<PulseRecord> {
  const formalization = formalizeProblem(task.objective);
  const tools = new ToolRegistry();
  for (const tool of computeTools(async () => ComputeEngine.inProcess())) {
    tools.register(tool);
  }
  const started = Date.now();
  const toolLog: Array<{
    toolId: string;
    input: unknown;
    result: { ok: boolean; data?: unknown };
  }> = [];
  const loop = await runAgentLoop({
    objective: task.objective,
    directives: [renderFormalizationPlan(formalization)],
    context: [],
    tools,
    toolContext: context("math_science"),
    decide: scripted(decisionsForTask(task)),
    hooks: {
      onToolResult: (entry) => {
        toolLog.push({
          toolId: entry.toolId,
          input: entry.input,
          result: { ok: entry.result.ok, data: entry.result.data },
        });
      },
    },
  });
  const latencyMs = Date.now() - started;
  const answer = loop.answer ?? "";
  const evidence = toolLog.map((entry) => ({
    toolId: entry.toolId,
    ok: entry.result.ok,
    input: entry.input,
    data: entry.result.data,
  }));
  const sanity = sanityGateCheck(answer, formalization);
  const recomputation = recomputationGateCheck(answer, evidence);
  const counterexample = counterexampleGateCheck(answer, formalization);
  const compute = computeEvidenceCheck(answer, evidence);

  const includesOk = task.expectIncludes.every((part) =>
    answer.toLowerCase().includes(part.toLowerCase()),
  );
  const underdeterminedOk = task.expectUnderdetermined
    ? formalization.underdetermined && sanity.status !== "failed"
    : true;
  const gatesOk =
    sanity.status !== "failed" &&
    recomputation.status !== "failed" &&
    counterexample.status !== "failed";
  const verifiedOk = task.expectUnderdetermined
    ? underdeterminedOk && gatesOk
    : includesOk && gatesOk && compute.status === "passed";

  const falseClaim = task.expectUnderdetermined
    ? "Result: x=3 and y=7. The system is uniquely solved."
    : "Result: 1. No computation was needed.";
  const falseCompletionProbe = await falseCompletion(
    task,
    tools,
    falseClaim,
    false,
  );

  return {
    id: task.id,
    level: task.level,
    domain: task.domain,
    objective: task.objective,
    liveProvider: false,
    mode: "offline-fixture",
    success: includesOk && underdeterminedOk && loop.status === "finished",
    verifiedSuccess: verifiedOk && loop.status === "finished",
    falseCompletion: falseCompletionProbe,
    formalization,
    gates: {
      sanity: sanity.detail,
      recomputation: recomputation.detail,
      counterexample: counterexample.detail,
    },
    modelCalls: loop.state.modelCalls,
    toolCalls: loop.state.toolCalls,
    steps: loop.state.steps.length,
    latencyMs,
    notes: task.notes,
  };
}

export async function runMathSciencePulse(
  level: PulseLevel = 5,
): Promise<PulseRecord[]> {
  const tasks = pulseTasksUpToLevel(level);
  const records: PulseRecord[] = [];
  for (const task of tasks) {
    records.push(await runPulseTask(task));
  }
  await notifyPulseHooks(records);
  return records;
}

export function formatPulseMarkdown(records: PulseRecord[]): string {
  const header = [
    "# M37 Math/Science pulse",
    "",
    `Measured by \`runMathSciencePulse\` over ${MATH_SCIENCE_PULSE_TASKS.length} tasks (L1–L5).`,
    "Live model providers were not called. Gates: sanity, recomputation, counterexample when applicable.",
    "",
    "| Level | Id | Success | Verified | False completion | Tool calls | Latency ms |",
    "| --- | --- | --- | --- | --- | --- | --- |",
  ];
  const rows = records.map(
    (record) =>
      `| L${record.level} | ${record.id} | ${record.success} | ${record.verifiedSuccess} | ${record.falseCompletion} | ${record.toolCalls} | ${record.latencyMs} |`,
  );
  const notes = records.flatMap((record) => [
    "",
    `## ${record.id} (L${record.level})`,
    "",
    record.objective,
    "",
    `Formalization underdetermined: ${record.formalization.underdetermined}`,
    `Gates: sanity=${record.gates.sanity}; recomputation=${record.gates.recomputation}`,
    record.notes,
  ]);
  return [...header, ...rows, ...notes, ""].join("\n");
}
