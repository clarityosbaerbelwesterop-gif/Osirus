import { randomUUID } from "node:crypto";
import { composeWorkflow, missionFor } from "../arms/compose";
import { analyseTask } from "../arms/thinking";
import type { ArmId, RuntimeIdentity, TaskAnalysis } from "../arms/types";
import { UnoRouterProvider } from "../models/unorouter";
import { recordingProvider } from "../models/recording";
import { resolveProductPolicy } from "../strategy/resolve";
import { stampPolicy, type RuntimePolicy } from "../strategy/runtime";
import { abortLocalRun, registerRunController } from "./cancellation";
import { persistGraph, setBudget } from "./dispatch";
import { publicRuntimeErrorMessage, runtimeErrorCode } from "./errors";
import { RuntimeRepository } from "./repository";
import { capabilitiesFor, routeObjective } from "./router-v2";
import { isTerminalRunStatus } from "./state-machine";
import type { Capability, RuntimePacket } from "./types";
import { driveSlices, finalizeRun } from "./worker";

export type { RuntimeIdentity };

export type PreparedRun = {
  runId: string;
  sessionId: string;
  created: boolean;
};

export type RuntimeEmit = (packet: RuntimePacket) => void | Promise<void>;

/**
 * How long this request will spend executing before it yields.
 *
 * The route is configured for 300s. Stopping well short of that is the point:
 * the run is durable, so a request that returns with work outstanding costs
 * nothing, while a request killed mid-write costs a stage its lease and a
 * worker its result.
 */
const SLICE_BUDGET_MS = 240_000;

/** Ceilings written at run creation, enforced by osirus.consume_budget. */
const DEFAULT_RUN_BUDGET = {
  maxModelCalls: 40,
  maxToolCalls: 100,
  maxAttempts: 60,
  maxRepairRounds: 4,
  maxWallClockMs: 30 * 60 * 1000,
};

function complexityFor(objective: string): "low" | "medium" | "high" {
  if (objective.length > 4000) return "high";
  if (objective.length > 800) return "medium";
  return "low";
}

export async function prepareRuntimeRun(input: {
  identity: RuntimeIdentity;
  objective: string;
  requestId: string;
  capabilities: Capability[];
  sessionId?: string | null;
  regenerate?: boolean;
}): Promise<PreparedRun> {
  const repository = new RuntimeRepository(input.identity.userId);
  const existing = await repository.findRunByRequestId(
    input.identity.workspaceId,
    input.requestId,
  );
  if (existing) {
    return {
      runId: existing.id,
      sessionId: existing.session_id,
      created: false,
    };
  }

  let sessionId = input.sessionId ?? null;
  if (sessionId) {
    sessionId = await repository.resolveSession(
      sessionId,
      input.identity.workspaceId,
    );
    if (!sessionId) throw new Error("session_not_accessible");
  } else {
    sessionId = await repository.createSession({
      organizationId: input.identity.organizationId,
      workspaceId: input.identity.workspaceId,
      title: input.objective.slice(0, 120),
    });
  }

  const [primaryCapability, ...secondaryCapabilities] = input.capabilities;
  const created = await repository.createRun({
    organizationId: input.identity.organizationId,
    workspaceId: input.identity.workspaceId,
    sessionId,
    objective: input.objective,
    primaryCapability: primaryCapability ?? "general",
    secondaryCapabilities,
    complexity: complexityFor(input.objective),
    requestId: input.requestId,
  });

  if (created.created && !input.regenerate) {
    await repository.createMessage({
      organizationId: input.identity.organizationId,
      workspaceId: input.identity.workspaceId,
      sessionId,
      runId: created.run.id,
      role: "user",
      content: input.objective,
      metadata: { requestId: input.requestId },
    });
  }

  return {
    runId: created.run.id,
    sessionId,
    created: created.created,
  };
}

async function cancellationWatcher(
  repository: RuntimeRepository,
  runId: string,
  controller: AbortController,
) {
  while (!controller.signal.aborted) {
    await sleep(900, controller.signal);
    if (controller.signal.aborted) return;
    try {
      if (await repository.isCancellationRequested(runId)) {
        controller.abort(new Error("cancel_requested"));
        return;
      }
    } catch {
      // A transient poll failure must not terminate the model call.
    }
  }
}

function sleep(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

/**
 * Route the objective, build the graph it implies, and write both down.
 *
 * Separated from execution because it happens exactly once per run, while the
 * slice loop may run many times across many requests and scheduler ticks.
 */
export async function planRuntimeRun(input: {
  identity: RuntimeIdentity;
  runId: string;
  objective: string;
  emit?: RuntimeEmit;
  correlationId?: string;
  signal?: AbortSignal;
  /**
   * The strategy to run under. Foundry trials pass theirs; product runs get
   * the product champion (or a canary) resolved here.
   */
  policy?: RuntimePolicy;
  /**
   * Foundry trials only: the composition the task is defined by, so both
   * sides of a comparison run the same arms and routing costs no model call.
   */
  composition?: ArmId[];
  /** Foundry trials only: the fixture and hidden checks, server-written. */
  stageInput?: Record<string, unknown>;
  /** Files sent with the objective; their excerpts are retrieved per stage. */
  attachments?: Array<{ id: string; kind: string }>;
}) {
  const repository = new RuntimeRepository(input.identity.userId);
  const provider = input.policy?.model
    ? new UnoRouterProvider({
        model: input.policy.model,
        maxRateLimitWaitSeconds: 60,
      })
    : new UnoRouterProvider();

  const activity = async (
    type: string,
    summary: string,
    data: Record<string, unknown> = {},
    visibility: "user" | "internal" = "user",
  ) => {
    const event = await repository.appendEvent({
      runId: input.runId,
      stageId: null,
      type,
      visibility,
      summary,
      data,
      correlationId: input.correlationId ?? input.runId,
    });
    await input.emit?.({ kind: "event", event });
    return event;
  };

  await repository.transitionRun(input.runId, "planning");
  await activity("planning", "Planning");

  // Escalation to a structured analysis is the router's decision, not this
  // function's. Passing the classifier in means an unconfigured provider
  // degrades to the heuristic route instead of failing the run.
  const fixed = input.composition?.length ? input.composition : null;
  const decision = fixed
    ? {
        ...(await routeObjective(input.objective)),
        primary: fixed[0]!,
        composition: fixed,
        capabilities: capabilitiesFor(fixed),
        reason: "Composition fixed by the evaluation task.",
      }
    : await routeObjective(input.objective, {
        classify: (objective) =>
          analyseTask({
            provider: recordingProvider(provider, repository, {
              organizationId: input.identity.organizationId,
              workspaceId: input.identity.workspaceId,
              runId: input.runId,
              stageId: null,
              purpose: "routing",
            }),
            requestId: `${input.runId}:routing`,
            objective,
            signal: input.signal,
          }),
      });

  // Tabular or structured data goes to the math/data arm first, which can
  // compute over it; everything else keeps the route the objective chose.
  const data = (input.attachments ?? []).some(
    (attachment) => attachment.kind === "csv" || attachment.kind === "json",
  );
  if (data && !fixed && !decision.composition.includes("math_science")) {
    decision.composition = [
      "math_science" as ArmId,
      ...decision.composition,
    ].slice(0, 4);
    decision.primary = "math_science";
    decision.reason = `${decision.reason} Attached data routed to the math/data arm.`;
  }

  const composed = composeWorkflow({
    objective: input.objective,
    composition: decision.composition,
    analysis: decision.analysis,
  });

  await repository.setRunPlan({
    runId: input.runId,
    armId: decision.primary,
    acceptanceContract: {
      ...composed.contract,
      routing: {
        composition: decision.composition,
        confidence: decision.confidence,
        escalated: decision.escalated,
        reason: decision.reason,
      },
    },
  });

  const policy =
    input.policy ??
    (await resolveProductPolicy({
      armId: decision.primary,
      runId: input.runId,
    }));
  stampPolicy(composed.graph.nodes, policy);
  if (input.stageInput)
    for (const node of composed.graph.nodes)
      node.input = { ...node.input, ...input.stageInput };
  if (input.attachments?.length)
    for (const node of composed.graph.nodes)
      node.input = {
        ...node.input,
        attachmentIds: input.attachments.map((attachment) => attachment.id),
      };

  const stageIds = await persistGraph({
    runId: input.runId,
    graph: composed.graph,
  });

  // One mission state for the whole run, whichever capabilities it spans.
  // Missing (a database without migration 017) degrades to per-stage state.
  const { PgMissionStore } = await import("./missions");
  await new PgMissionStore(input.identity.userId)
    .create(
      input.runId,
      missionFor({
        objective: input.objective,
        composition: decision.composition,
        contract: composed.contract,
        analysis: decision.analysis,
      }),
    )
    .catch(() => false);

  await setBudget({
    runId: input.runId,
    scope: "run",
    ...DEFAULT_RUN_BUDGET,
  });

  await activity("capability.selected", "Selected capabilities", {
    armId: decision.primary,
    composition: decision.composition,
    capabilities: decision.capabilities,
    confidence: decision.confidence,
    escalated: decision.escalated,
    reason: decision.reason,
  });

  await activity(
    "strategy.selected",
    `Strategy ${policy.label}`,
    {
      strategyVersionId: policy.strategyVersionId,
      label: policy.label,
      assignment: policy.assignment,
      model: policy.model ?? null,
    },
    "internal",
  );

  await activity("plan.persisted", "Planned the run", {
    stages: composed.graph.nodes.map((node) => ({
      key: node.key,
      name: node.name,
      armId: node.input.armId,
      dependsOn: node.dependsOn,
    })),
    successCriteria: composed.contract.successCriteria,
    requiredEvidence: composed.contract.requiredEvidence,
  });

  if (decision.analysis) {
    await recordAnalysisArtifact({
      repository,
      identity: input.identity,
      runId: input.runId,
      analysis: decision.analysis,
    });
  }

  await repository.transitionRun(input.runId, "queued");
  return { decision, composed, stageIds };
}

async function recordAnalysisArtifact(input: {
  repository: RuntimeRepository;
  identity: RuntimeIdentity;
  runId: string;
  analysis: TaskAnalysis;
}) {
  await input.repository
    .createArtifact({
      organizationId: input.identity.organizationId,
      workspaceId: input.identity.workspaceId,
      runId: input.runId,
      kind: "task_analysis",
      title: "Task analysis",
      contentType: "application/json",
      // Conclusions only. The analysis schema has no field for reasoning, so
      // there is nothing private to strip here -- and nothing may be added.
      content: input.analysis as unknown as Record<string, unknown>,
      provenance: { producedBy: "ThinkingArm", modelRole: "THINKING" },
    })
    .catch(() => undefined);
}

/**
 * Drive a run from an HTTP request.
 *
 * The request owns the run only for as long as it is alive. It plans, then
 * claims and executes stages until the work is gone or the deadline nears,
 * then returns. Whatever is left is claimable by the next request, the client
 * poll, or the scheduler -- the run does not depend on this function finishing.
 */
export async function executeRuntimeRun(input: {
  identity: RuntimeIdentity;
  runId: string;
  sessionId: string;
  objective: string;
  capabilities: Capability[];
  emit: RuntimeEmit;
  correlationId?: string;
  attachments?: Array<{ id: string; kind: string }>;
}) {
  const repository = new RuntimeRepository(input.identity.userId);
  const controller = new AbortController();
  const unregister = registerRunController(input.runId, controller);
  const watcher = cancellationWatcher(repository, input.runId, controller);
  const deadlineAt = Date.now() + SLICE_BUDGET_MS;

  const activity = async (
    type: string,
    summary: string,
    data: Record<string, unknown> = {},
    visibility: "user" | "internal" = "user",
  ) => {
    const event = await repository.appendEvent({
      runId: input.runId,
      stageId: null,
      type,
      visibility,
      summary,
      data,
      correlationId: input.correlationId ?? input.runId,
    });
    await input.emit({ kind: "event", event });
    return event;
  };

  try {
    await input.emit({
      kind: "started",
      runId: input.runId,
      sessionId: input.sessionId,
    });

    await planRuntimeRun({
      identity: input.identity,
      runId: input.runId,
      objective: input.objective,
      emit: input.emit,
      correlationId: input.correlationId,
      attachments: input.attachments,
      signal: controller.signal,
    });

    await repository.transitionRun(input.runId, "running");

    const slice = await driveSlices({
      runId: input.runId,
      workerId: `request:${randomUUID()}`,
      deadlineAt,
      signal: controller.signal,
      identity: input.identity,
      emit: input.emit,
      correlationId: input.correlationId,
    });

    if (controller.signal.aborted) throw controller.signal.reason;

    const completion = await finalizeRun({
      identity: input.identity,
      runId: input.runId,
      exhausted: slice.exhausted,
    });

    if (completion.status === "completed") {
      await activity("completed", "Completed", {
        stages: completion.total,
      });
    } else if (completion.status === "failed") {
      await activity("failed", "Failed", { reason: completion.reason });
    } else {
      // Honest reporting: the run is still going, this request is not.
      await activity(
        "slice.yielded",
        completion.status === "waiting_for_approval"
          ? "Waiting for approval"
          : "Continuing in the background",
        {
          reason: completion.reason,
          settled: completion.settled,
          total: completion.total,
        },
        "internal",
      );
    }

    const snapshot = await repository.getSnapshot(input.runId);
    await input.emit({ kind: "snapshot", snapshot });
    await input.emit({
      kind: "done",
      runId: input.runId,
      status: snapshot.run.status,
    });
  } catch (error) {
    const current = await repository.getRun(input.runId);
    const cancelled =
      controller.signal.aborted ||
      current?.cancel_requested ||
      current?.status === "cancelling";

    const latest = await repository.getRun(input.runId).catch(() => null);
    if (latest && !isTerminalRunStatus(latest.status)) {
      if (cancelled) {
        if (latest.status !== "cancelling") {
          await repository
            .requestCancellation(input.runId)
            .catch(() => undefined);
        }
        await repository
          .transitionRun(input.runId, "cancelled")
          .catch(() => undefined);
        await activity("cancelled", "Cancelled").catch(() => undefined);
        await input.emit({
          kind: "done",
          runId: input.runId,
          status: "cancelled",
        });
      } else {
        await repository
          .transitionRun(input.runId, "failed", {
            errorCode: runtimeErrorCode(error),
            errorMessage: publicRuntimeErrorMessage(error),
          })
          .catch(() => undefined);
        await activity("failed", "Failed").catch(() => undefined);
        await input.emit({
          kind: "error",
          runId: input.runId,
          message: publicRuntimeErrorMessage(error),
        });
      }
    }
  } finally {
    controller.abort(new Error("runtime_finished"));
    unregister();
    abortLocalRun(input.runId, "runtime_finished");
    await watcher;
  }
}
