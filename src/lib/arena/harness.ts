import { randomUUID } from "node:crypto";
import { MemoryPlanRevisionStore } from "../agent/plan";
import { composeWorkflow } from "../arms/compose";
import { armFor } from "../arms/registry";
import type {
  ArmId,
  ArmRuntime,
  ArmStageContext,
  StageOutcome,
} from "../arms/types";
import { MemoryWorkspaceStore } from "../coding/store";
import type { ModelProvider, Usage } from "../models/provider";
import { MemoryEvidenceStore } from "../research/store";
import { routeObjective } from "../runtime/router-v2";
import { topologicalOrder } from "../runtime/graph";
import type { SandboxDriver } from "../sandbox/driver";
import { ToolRegistry, type ToolAudit } from "../tools/registry";
import { isFalseCompletion, type TaskResult } from "./metrics";
import type { ArenaTask } from "./suites";
import { stampPolicy, type RuntimePolicy } from "../strategy/runtime";

// Runs one arena task through the real arms.
//
// The same arm code as production: routing, composition, the workflow graph,
// every stage's executeStage, the agent loop, the tools, the verifier. What
// differs is only where records go -- memory instead of Postgres -- because
// the live-eval runner has no database, by design. Approvals are counted as
// human interventions and granted, so a task that needs one is visible in the
// metrics rather than silently stuck.

export type HarnessOptions = {
  provider: ModelProvider;
  sandbox: () => Promise<SandboxDriver>;
  signal?: AbortSignal;
  /** Stop starting stages once this much has been spent. */
  budget?: { maxCostUsd?: number; maxTokens?: number };
  spent?: { costUsd: number; tokens: number };
  /** The strategy the run uses; the baseline when absent. */
  policy?: RuntimePolicy;
  /** Extra input every stage receives, e.g. a Foundry trial's hidden checks. */
  stageInput?: Record<string, unknown>;
};

type Counters = {
  modelCalls: number;
  toolCalls: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  humanInterventions: number;
  securityEvents: number;
};

/** The real provider, with every billed token and cent counted. */
function meteredProvider(
  provider: ModelProvider,
  counters: Counters,
): ModelProvider {
  const count = (usage: Usage | undefined) => {
    counters.inputTokens += usage?.inputTokens ?? 0;
    counters.outputTokens += usage?.outputTokens ?? 0;
    counters.costUsd += Number(usage?.cost ?? 0);
  };
  const metered = Object.create(provider) as ModelProvider;
  metered.stream = async function* (input) {
    for await (const event of provider.stream(input)) {
      if (event.type === "usage") count(event.usage);
      yield event;
    }
  };
  metered.complete = async (input) => {
    const result = await provider.complete(input);
    count(result.usage);
    return result;
  };
  metered.structured = async (input) => {
    const result = await provider.structured(input);
    count(result.usage);
    return result;
  };
  return metered;
}

export async function runArenaTask(
  task: ArenaTask,
  options: HarnessOptions,
): Promise<
  TaskResult & {
    events: string[];
    answer: string;
    hiddenCheck: { exitCode: number | null; output: string } | null;
    diff: string;
    stages: string[];
    actions: Array<{ action: string; toolId?: string; outcome: string }>;
  }
> {
  const startedAt = Date.now();
  const counters: Counters = {
    modelCalls: 0,
    toolCalls: 0,
    inputTokens: 0,
    outputTokens: 0,
    costUsd: 0,
    humanInterventions: 0,
    securityEvents: 0,
  };
  const events: string[] = [];
  const notes: string[] = [];
  const messages: string[] = [];
  let toolFaultPending = task.fault === "first_tool_call_fails";

  const identity = {
    userId: randomUUID(),
    organizationId: randomUUID(),
    workspaceId: randomUUID(),
  };
  const runId = randomUUID();
  const sessionId = randomUUID();

  const audit: ToolAudit = async (entry) => {
    if (entry.status === "cancelled") counters.securityEvents += 1;
  };
  const workspaceStore = new MemoryWorkspaceStore();
  const planStore = new MemoryPlanRevisionStore();
  const evidence = new MemoryEvidenceStore();
  const approvals = new Map<string, string>();

  const provider = meteredProvider(options.provider, counters);
  const repository = {
    createModelCall: async () => {
      counters.modelCalls += 1;
      return randomUUID();
    },
    finishModelCall: async () => undefined,
    createMessage: async (input: { content: string; role: string }) => {
      if (input.role === "assistant") messages.push(input.content);
      return randomUUID();
    },
    createArtifact: async () => randomUUID(),
    createApproval: async () => {
      counters.humanInterventions += 1;
      const id = randomUUID();
      approvals.set(id, "approved");
      return id;
    },
    approvalStatus: async (id: string) => approvals.get(id) ?? null,
    getSessionMessages: async () => [],
    getSnapshot: async () => ({ run: { id: runId }, stages: [], events: [] }),
    appendEvent: async () => ({ id: randomUUID() }),
  };

  const runtime: ArmRuntime = {
    provider,
    repository: repository as unknown as ArmRuntime["repository"],
    memory: {
      retrieve: async () =>
        (task.memory ?? []).map((content, index) => ({
          id: `memory-${index}`,
          tier: "second",
          kind: "decision",
          content,
          source: "arena",
          updatedAt: new Date().toISOString(),
          verificationStatus: "verified",
        })),
      retrieveBundle: async () => {
        const items = (task.memory ?? []).map((content, index) => ({
          id: `memory-${index}`,
          tier: "second" as const,
          kind: "decision",
          content,
          source: "arena",
          updatedAt: new Date().toISOString(),
          verificationStatus: "verified" as const,
        }));
        return {
          planes: {
            episodic: [],
            semantic: items,
            procedural: [],
            strategic: [],
          },
          contextLines: items.map(
            (item) =>
              `[semantic/${item.tier}/${item.verificationStatus}] ${item.content}`,
          ),
          itemIds: items.map((item) => item.id),
          contradictionsPending: 0,
        };
      },
    } as unknown as ArmRuntime["memory"],
    // The real capability pack, so skill selection runs as in production;
    // with no history, every outcome weight is zero.
    skills: {
      loadEnabled: async () =>
        (await import("../skills/capability-pack")).osirusCapabilityPack.map(
          (skill) => ({ ...skill, state: "enabled" as const }),
        ),
      outcomeWeights: async () => ({}),
      recordSelection: async () => undefined,
      recordStageTelemetry: async () => undefined,
    } as unknown as ArmRuntime["skills"],
    activity: async (type, summary) => {
      events.push(`${type}: ${summary}`);
      return { id: randomUUID() };
    },
    emitDelta: () => undefined,
    stores: {
      sandbox: options.sandbox,
      workspace: () => workspaceStore,
      plans: () => planStore,
      evidence: () => evidence,
      fixture: () => task.fixture ?? [],
      registry: () => {
        const registry = new ToolRegistry({
          audit,
          // A human would be asked here. The arena grants and counts it.
          approvalGate: async () => {
            counters.humanInterventions += 1;
            return "approved";
          },
        });
        const register = registry.register.bind(registry);
        registry.register = ((tool) => {
          const run = tool.run;
          return register({
            ...tool,
            run: async (input: unknown, context: unknown) => {
              counters.toolCalls += 1;
              if (toolFaultPending) {
                toolFaultPending = false;
                notes.push(`Injected fault on first call to ${tool.id}.`);
                throw new Error("injected_fault: transient tool failure");
              }
              return run(input as never, context as never);
            },
          });
        }) as typeof registry.register;
        return registry;
      },
    },
  };

  const decision = await routeObjective(task.objective);
  const composition = task.composition ?? decision.composition;
  const composed = composeWorkflow({ objective: task.objective, composition });
  if (options.policy) stampPolicy(composed.graph.nodes, options.policy);
  if (options.stageInput)
    for (const node of composed.graph.nodes)
      node.input = { ...node.input, ...options.stageInput };
  const order = topologicalOrder(composed.graph);
  const nodes = new Map(composed.graph.nodes.map((node) => [node.key, node]));
  const state: Record<string, unknown> = {};
  const verdicts: string[] = [];
  let status: TaskResult["status"] = "completed";

  for (const [ordinal, key] of order.entries()) {
    const spent = {
      cost: (options.spent?.costUsd ?? 0) + counters.costUsd,
      tokens:
        (options.spent?.tokens ?? 0) +
        counters.inputTokens +
        counters.outputTokens,
    };
    if (
      (options.budget?.maxCostUsd && spent.cost >= options.budget.maxCostUsd) ||
      (options.budget?.maxTokens && spent.tokens >= options.budget.maxTokens)
    ) {
      notes.push(`Budget reached before stage ${key}; stopped.`);
      status = "failed";
      break;
    }
    const node = nodes.get(key)!;
    const armId = (node.input.armId as ArmId) ?? composition[0] ?? "general";
    const arm = armFor(armId);
    const context: ArmStageContext = {
      identity,
      work: {
        attemptId: randomUUID(),
        leaseToken: randomUUID(),
        leaseExpiresAt: new Date(Date.now() + 600_000).toISOString(),
        attemptNumber: 1,
        sliceCount: 0,
        handoff: {},
        runId,
        stageId: randomUUID(),
        organizationId: identity.organizationId,
        workspaceId: identity.workspaceId,
        sessionId,
        requestedBy: identity.userId,
        objective: task.objective,
        stageName: node.name,
        capability: node.capability,
        ordinal,
        stageInput: node.input,
        requiresVerification: node.requiresVerification ?? false,
      },
      runtime,
      signal: options.signal ?? new AbortController().signal,
      state,
    };

    const maxAttempts = node.retryPolicy?.maxAttempts ?? 1;
    let attempts = 1;
    let outcome: StageOutcome | null = null;
    for (let slice = 0; slice < 12; slice += 1) {
      try {
        outcome = await arm.executeStage(context);
      } catch (error) {
        outcome = {
          kind: "FAILED",
          failureClass: "exception",
          error: error instanceof Error ? error.message : String(error),
          retryable: true,
        };
      }
      if (outcome.kind === "PROGRESS" || outcome.kind === "WAITING") continue;
      if (outcome.kind === "BLOCKED") {
        // A provider refusal that asks for more than a short wait ends the
        // task: an evaluation cannot sit out a quota, and the refusal says
        // nothing about the work. The note carries the cause to the judge.
        if (outcome.retryAfterSeconds > 30) break;
        const wait = Math.min(outcome.retryAfterSeconds, 5) * 1000;
        await new Promise((resolve) => setTimeout(resolve, wait));
        continue;
      }
      if (
        outcome.kind === "FAILED" &&
        outcome.retryable &&
        attempts < maxAttempts
      ) {
        attempts += 1;
        context.work = { ...context.work, attemptNumber: attempts };
        notes.push(`Retried ${key} after ${outcome.failureClass}.`);
        continue;
      }
      break;
    }
    if (outcome?.kind === "COMPLETE" && outcome.verdict)
      verdicts.push(outcome.verdict.status);
    if (outcome?.kind === "BLOCKED") {
      notes.push(
        `${key} failed: ${outcome.reason} (retry after ${outcome.retryAfterSeconds}s)`,
      );
      status = "failed";
      break;
    }
    if (outcome?.kind === "FAILED") {
      notes.push(
        `${key} failed: ${outcome.failureClass}: ${outcome.error.slice(0, 200)}`,
      );
      if (node.failurePolicy !== "continue") {
        status = "failed";
        break;
      }
    }
  }

  // Arena workspaces are not kept: delete the VM and its snapshots.
  const workspaceRecord = await workspaceStore.load(runId);
  if (workspaceRecord) {
    try {
      const driver = await options.sandbox();
      const handle = await driver.reattach?.(workspaceRecord.handle);
      await handle?.destroy?.();
    } catch {
      notes.push("Workspace cleanup failed; it expires on its own.");
    }
  }

  const answer = String(state.answer ?? messages.at(-1) ?? "");
  const lower = answer.toLowerCase();
  const includes = (task.expect.answerIncludes ?? []).every((text) =>
    lower.includes(text.toLowerCase()),
  );
  const verdictOk = task.expect.verdicts
    ? verdicts.length > 0 &&
      verdicts.every((verdict) => task.expect.verdicts!.includes(verdict))
    : true;
  const verified =
    verdicts.length > 0 && verdicts.every((verdict) => verdict === "verified");
  const steps =
    (state.agentSteps as
      | Array<{ action: string; outcome: string; toolId?: string }>
      | undefined) ?? [];
  return {
    taskId: task.id,
    suite: task.suite,
    arm: composition.join("+"),
    status,
    verdicts,
    success: status === "completed" && includes && verdictOk,
    verifiedSuccess: status === "completed" && includes && verified,
    falseCompletion: isFalseCompletion(answer, verdicts),
    toolCalls: counters.toolCalls,
    modelCalls: counters.modelCalls,
    inputTokens: counters.inputTokens,
    outputTokens: counters.outputTokens,
    costUsd: Number(counters.costUsd.toFixed(6)),
    latencyMs: Date.now() - startedAt,
    repairs:
      steps.filter((step) => step.action === "REPLAN").length +
      events.filter((event) => event.startsWith("plan.revised")).length,
    humanInterventions: counters.humanInterventions,
    securityEvents: counters.securityEvents,
    notes,
    answerExcerpt: answer.slice(0, 600),
    events,
    answer,
    hiddenCheck:
      (state.hiddenCheck as { exitCode: number | null; output: string }) ??
      null,
    diff: String(state.workspaceDiff ?? ""),
    stages: order,
    actions: steps.map((step) => ({
      action: step.action,
      ...(step.toolId ? { toolId: step.toolId } : {}),
      outcome: step.outcome,
    })),
  };
}
