import "server-only";
import { armFor } from "../arms/registry";
import type {
  ArmId,
  ArmRuntime,
  ArmStageContext,
  RuntimeIdentity,
  StageOutcome,
} from "../arms/types";
import { MemoryRepository } from "../memory/repository";
import { UnoRouterProvider } from "../models/unorouter";
import type { Verdict } from "../verification/engine";
import {
  claimNextStage,
  consumeBudget,
  finishAttempt,
  heartbeatAttempt,
  type ClaimedWork,
} from "./dispatch";
import { runtimeErrorCode } from "./errors";
import { RuntimeRepository } from "./repository";
import { SkillRepository } from "../skills/repository";
import { settlementFor } from "./settlement";
import type { RuntimePacket } from "./types";

// The slice loop.
//
// This is what replaced running a whole run inside one HTTP request. A worker
// claims one stage, executes it under a lease it keeps renewing, settles it
// through osirus.finish_attempt, and repeats until either the work is gone or
// the request is close enough to its deadline that starting another stage
// would risk being killed mid-write.
//
// Two rules hold everywhere below and are the reason the loop is safe to run
// from several places at once:
//
//   1. Nothing is written for a stage whose lease we no longer hold. A failed
//      heartbeat aborts the stage and the result is discarded, because by then
//      another worker owns the stage and may have moved past it.
//   2. A stage only ever changes status through finish_attempt, which is
//      fenced on the lease token. A worker cannot leave a stage in a state the
//      claim scan disagrees with.

/** Renewal cadence as a fraction of the lease. */
const HEARTBEAT_DIVISOR = 3;

/** Refuse to start another stage with less than this left before the deadline. */
const STAGE_HEADROOM_MS = 20_000;

export type SliceResult = {
  claimed: number;
  completed: number;
  failed: number;
  /** Stopped because the deadline approached, not because work ran out. */
  yielded: boolean;
  /** Nothing was claimable on the first attempt. */
  idle: boolean;
  /** Set to the exhausted budget dimension when a ceiling stopped the slice. */
  exhausted?: string | null;
};

export type DriveInput = {
  /** Null claims across runs; the scheduler uses that, a request does not. */
  runId: string | null;
  workerId: string;
  deadlineAt: number;
  signal: AbortSignal;
  leaseSeconds?: number;
  maxStages?: number;
  emit?: (packet: RuntimePacket) => void | Promise<void>;
  correlationId?: string;
  /** Supplied by the request path, which already knows who is calling. */
  identity?: RuntimeIdentity;
};

/** The subset of run state that survives a checkpoint and a resume. */
const DURABLE_STATE_KEYS = new Set([
  "analysis",
  "plan",
  "answer",
  "answers",
  "assistantMessageId",
  "memoryContext",
  "memoryItemIds",
  "skillContext",
  "skillIds",
  "outline",
  "retrieved",
  "verdict",
  "repairRound",
  "repairInstruction",
  "testResult",
  "buildResult",
]);

function durableState(state: Record<string, unknown>) {
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(state)) {
    if (DURABLE_STATE_KEYS.has(key)) output[key] = value;
  }
  return output;
}

function identityFor(work: ClaimedWork): RuntimeIdentity {
  return {
    userId: work.requestedBy,
    organizationId: work.organizationId,
    workspaceId: work.workspaceId,
  };
}

/**
 * Keeps a lease alive while a stage runs, and aborts the stage the moment the
 * lease is gone.
 */
class LeaseGuard {
  private timer: ReturnType<typeof setInterval> | null = null;
  private lost = false;
  readonly controller = new AbortController();

  constructor(
    private readonly work: ClaimedWork,
    private readonly leaseSeconds: number,
    parent: AbortSignal,
  ) {
    if (parent.aborted) this.controller.abort(parent.reason);
    else {
      parent.addEventListener(
        "abort",
        () => this.controller.abort(parent.reason),
        { once: true },
      );
    }
  }

  start() {
    const every = Math.max(
      1000,
      Math.floor((this.leaseSeconds * 1000) / HEARTBEAT_DIVISOR),
    );
    this.timer = setInterval(() => {
      void heartbeatAttempt({
        attemptId: this.work.attemptId,
        leaseToken: this.work.leaseToken,
        leaseSeconds: this.leaseSeconds,
      })
        .then((renewed) => {
          if (renewed) return;
          this.lost = true;
          this.controller.abort(new Error("lease_lost"));
        })
        .catch(() => {
          // A transient database error is not proof the lease is gone. The
          // lease expiring on its own is what reclaims the stage.
        });
    }, every);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  get leaseLost() {
    return this.lost;
  }
}

export async function executeClaimedStage(input: {
  work: ClaimedWork;
  identity: RuntimeIdentity;
  leaseSeconds: number;
  signal: AbortSignal;
  emit?: DriveInput["emit"];
  correlationId?: string;
}): Promise<{ settled: boolean; outcome: StageOutcome }> {
  const { work, identity } = input;
  const repository = new RuntimeRepository(identity.userId);
  const guard = new LeaseGuard(work, input.leaseSeconds, input.signal);

  const runtime: ArmRuntime = {
    provider: new UnoRouterProvider(),
    repository,
    memory: new MemoryRepository(identity.userId),
    skills: new SkillRepository(identity.userId),
    activity: async (type, summary, data = {}, visibility = "user") => {
      const event = await repository.appendEvent({
        runId: work.runId,
        stageId: work.stageId,
        type,
        visibility,
        summary,
        data,
        correlationId: input.correlationId ?? work.runId,
      });
      await input.emit?.({ kind: "event", event });
      return event;
    },
    emitDelta: async (text) => {
      await input.emit?.({ kind: "delta", runId: work.runId, text });
    },
  };

  const checkpoint = await repository.loadLatestCheckpoint(work.runId);
  const state: Record<string, unknown> = { ...(checkpoint?.state ?? {}) };

  const armId = (work.stageInput.armId as ArmId | undefined) ?? "general";
  const arm = armFor(armId);
  const context: ArmStageContext = {
    identity,
    work,
    runtime,
    signal: guard.controller.signal,
    state,
  };

  await runtime.activity(
    "stage.started",
    work.stageName,
    {
      armId,
      stageKind: work.stageInput.stageKind,
      attempt: work.attemptNumber,
    },
    "internal",
  );

  guard.start();
  let outcome: StageOutcome;
  try {
    outcome = await arm.executeStage(context);
  } catch (error) {
    outcome = {
      kind: "FAILED",
      failureClass: runtimeErrorCode(error),
      error: error instanceof Error ? error.message : "stage_failed",
      // An aborted stage is not a failure of the work; it is this worker
      // losing the right to do it. Either way the next claim decides.
      retryable: !guard.leaseLost,
    };
  } finally {
    guard.stop();
  }

  // Rule 1: the lease is gone, so nothing this slice produced may be written.
  if (guard.leaseLost) {
    return { settled: false, outcome };
  }

  if (outcome.kind === "COMPLETE" && outcome.verdict) {
    await persistVerdict({
      repository,
      work,
      identity,
      verdict: outcome.verdict,
    });
  }

  const settlement = settlementFor(outcome);
  const settled = await finishAttempt({
    attemptId: work.attemptId,
    leaseToken: work.leaseToken,
    attemptStatus: settlement.attemptStatus,
    stageStatus: settlement.stageStatus,
    output: settlement.output,
    failureClass: settlement.failureClass ?? null,
    lastError: settlement.lastError ?? null,
    retryDelaySeconds: settlement.retryDelaySeconds,
  });

  if (!settled) {
    // Lost the lease between the last heartbeat and the write. The stage now
    // belongs to someone else; say so and leave it alone.
    await runtime
      .activity(
        "stage.lease_lost",
        `${work.stageName} was reclaimed by another worker`,
        { attempt: work.attemptNumber },
        "internal",
      )
      .catch(() => undefined);
    return { settled: false, outcome };
  }

  await repository
    .saveCheckpoint({
      runId: work.runId,
      stageId: work.stageId,
      label: `${work.stageName}:${outcome.kind.toLowerCase()}`,
      state: durableState(state),
    })
    .catch(() => undefined);

  await runtime
    .activity(
      outcome.kind === "FAILED" ? "stage.failed" : "stage.completed",
      outcome.kind === "FAILED"
        ? `${work.stageName} failed`
        : `${work.stageName} complete`,
      { armId, outcome: outcome.kind },
      outcome.kind === "FAILED" ? "user" : "internal",
    )
    .catch(() => undefined);

  return { settled: true, outcome };
}

async function persistVerdict(input: {
  repository: RuntimeRepository;
  work: ClaimedWork;
  identity: RuntimeIdentity;
  verdict: Verdict;
}) {
  const { repository, work, identity, verdict } = input;
  await repository
    .recordVerification({
      stageId: work.stageId,
      status: verdict.status,
      verification: {
        summary: verdict.summary,
        checks: verdict.checks,
      },
    })
    .catch(() => undefined);
  await repository
    .createArtifact({
      organizationId: identity.organizationId,
      workspaceId: identity.workspaceId,
      sessionId: work.sessionId,
      runId: work.runId,
      kind: "verification",
      title: `Verification: ${work.stageName}`,
      contentType: "application/json",
      content: {
        status: verdict.status,
        summary: verdict.summary,
        checks: verdict.checks,
      },
      provenance: {
        stageId: work.stageId,
        attemptId: work.attemptId,
        producedBy: "VerificationEngine",
      },
    })
    .catch(() => undefined);
}

/**
 * Claim and execute stages until the work runs out or the deadline nears.
 *
 * Returning without having drained the queue is normal, not a failure: the
 * next request, poll or scheduler tick picks the run up where this left it.
 */
export async function driveSlices(input: DriveInput): Promise<SliceResult> {
  const leaseSeconds = input.leaseSeconds ?? 60;
  const maxStages = input.maxStages ?? 64;
  const result: SliceResult = {
    claimed: 0,
    completed: 0,
    failed: 0,
    yielded: false,
    idle: false,
    exhausted: null,
  };

  while (result.claimed < maxStages) {
    if (input.signal.aborted) {
      result.yielded = true;
      break;
    }
    if (Date.now() + STAGE_HEADROOM_MS >= input.deadlineAt) {
      result.yielded = true;
      break;
    }

    const work = await claimNextStage({
      workerId: input.workerId,
      leaseSeconds,
      runId: input.runId,
    });
    if (!work) {
      result.idle = result.claimed === 0;
      break;
    }
    result.claimed += 1;

    const identity = input.identity ?? identityFor(work);
    // A supplied identity must still own the work it was handed. The request
    // path passes its own caller; the claim is scoped to that caller's run, so
    // a mismatch means the scope was wrong and the safe answer is the row.
    const effective =
      identity.userId === work.requestedBy ? identity : identityFor(work);

    const { settled, outcome } = await executeClaimedStage({
      work,
      identity: effective,
      leaseSeconds,
      signal: input.signal,
      emit: input.emit,
      correlationId: input.correlationId,
    });

    if (!settled) {
      result.yielded = true;
      break;
    }
    if (outcome.kind === "FAILED") {
      result.failed += 1;
      if (!outcome.retryable) break;
    } else if (outcome.kind === "COMPLETE") {
      result.completed += 1;
    } else if (outcome.kind === "WAITING") {
      // Parked on something outside the engine. Another stage may still be
      // runnable, so keep going rather than ending the slice here.
      continue;
    }

    const budget = await consumeBudget({
      runId: work.runId,
      scope: "run",
      attempts: 1,
    }).catch(() => ({ exhausted: false, reason: null }));

    // A ceiling that is checked and then ignored is not a ceiling. Stop the
    // slice here and let the run be finalised as blocked on its budget.
    if (budget.exhausted) {
      result.exhausted = budget.reason ?? "budget";
      break;
    }
  }

  return result;
}

export type RunCompletion = {
  status: "completed" | "failed" | "waiting_for_approval" | "running";
  reason: string;
  settled: number;
  total: number;
};

/**
 * Decide whether a run is finished, and record it if so.
 *
 * Deliberately separate from the slice loop: several workers may drive the
 * same run, and only the one that finds every stage settled may close it.
 */
export async function finalizeRun(input: {
  identity: RuntimeIdentity;
  runId: string;
  exhausted?: string | null;
}): Promise<RunCompletion> {
  const repository = new RuntimeRepository(input.identity.userId);
  const progress = await repository.stageProgress(input.runId);
  const run = await repository.getRun(input.runId);

  if (!run || isSettledRun(run.status)) {
    return {
      status: (run?.status as RunCompletion["status"]) ?? "failed",
      reason: "already_settled",
      settled: progress.settled,
      total: progress.total,
    };
  }

  if (run.cancel_requested || run.status === "cancelling") {
    return {
      status: "running",
      reason: "cancellation_in_progress",
      settled: progress.settled,
      total: progress.total,
    };
  }

  if (input.exhausted) {
    await repository.transitionRun(input.runId, "failed", {
      errorCode: "budget_exhausted",
      errorMessage: `The run stopped because its ${input.exhausted} budget was exhausted.`,
    });
    return {
      status: "failed",
      reason: `budget_exhausted:${input.exhausted}`,
      settled: progress.settled,
      total: progress.total,
    };
  }

  if (progress.failed > 0) {
    await repository.transitionRun(input.runId, "failed", {
      errorCode: "stage_failed",
      errorMessage: "A required stage failed after exhausting its attempts.",
    });
    return {
      status: "failed",
      reason: "stage_failed",
      settled: progress.settled,
      total: progress.total,
    };
  }

  if (progress.total > 0 && progress.settled === progress.total) {
    await repository.transitionRun(input.runId, "completed");
    return {
      status: "completed",
      reason: "all_stages_settled",
      settled: progress.settled,
      total: progress.total,
    };
  }

  if (progress.waiting > 0) {
    if (run.status !== "waiting_for_approval") {
      await repository
        .transitionRun(input.runId, "waiting_for_approval")
        .catch(() => undefined);
    }
    return {
      status: "waiting_for_approval",
      reason: "stage_waiting",
      settled: progress.settled,
      total: progress.total,
    };
  }

  return {
    status: "running",
    reason: progress.blockedFuture > 0 ? "retry_scheduled" : "work_remaining",
    settled: progress.settled,
    total: progress.total,
  };
}

function isSettledRun(status: string) {
  return (
    status === "completed" || status === "failed" || status === "cancelled"
  );
}
