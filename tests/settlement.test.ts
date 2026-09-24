import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { sliceBudgetDelta } from "../src/lib/agent/loop";
import {
  budgetChargeForAttempt,
  pendingBudgetOf,
  settlementFor,
} from "../src/lib/runtime/settlement";
import { canTransitionStage } from "../src/lib/runtime/state-machine";

describe("stage settlement", () => {
  it("settles a completed stage terminally", () => {
    const settlement = settlementFor({ kind: "COMPLETE", output: { a: 1 } });
    expect(settlement.attemptStatus).toBe("completed");
    expect(settlement.stageStatus).toBe("completed");
  });

  it("yields without spending a retry", () => {
    // PROGRESS parks the stage in blocked with no delay, which is immediately
    // claimable. claim_next_stage only counts a claim as a retry when the
    // previous attempt failed, so a stage allowed one attempt can still run in
    // several slices.
    const settlement = settlementFor({
      kind: "PROGRESS",
      output: {},
      resume: { cursor: 3 },
    });
    expect(settlement.attemptStatus).toBe("completed");
    expect(settlement.stageStatus).toBe("blocked");
    expect(settlement.retryDelaySeconds).toBe(0);
  });

  it("parks an approval wait without failing the attempt", () => {
    const settlement = settlementFor({
      kind: "WAITING",
      reason: "approval",
      output: {},
    });
    expect(settlement.attemptStatus).toBe("completed");
    expect(settlement.stageStatus).toBe("waiting");
    expect(settlement.output).toMatchObject({ waitingOn: "approval" });
  });

  it("gives a blocked stage a delay so it cannot spin", () => {
    const settlement = settlementFor({
      kind: "BLOCKED",
      reason: "rate_limited",
      retryAfterSeconds: 0,
    });
    expect(settlement.retryDelaySeconds).toBeGreaterThanOrEqual(1);
  });

  it("sends a retryable failure back to blocked, not to failed", () => {
    // `failed` is terminal in the stage machine, so a retry has to be a new
    // attempt against a stage that is still claimable.
    const settlement = settlementFor({
      kind: "FAILED",
      failureClass: "provider_timeout",
      error: "timed out",
      retryable: true,
    });
    expect(settlement.attemptStatus).toBe("failed");
    expect(settlement.stageStatus).toBe("blocked");
    expect(settlement.retryDelaySeconds).toBeGreaterThan(0);
  });

  it("fails terminally when the failure is not retryable", () => {
    const settlement = settlementFor({
      kind: "FAILED",
      failureClass: "unhandled_stage",
      error: "no handler",
      retryable: false,
    });
    expect(settlement.stageStatus).toBe("failed");
  });

  it("only ever produces transitions the stage machine allows from running", () => {
    const outcomes = [
      settlementFor({ kind: "COMPLETE", output: {} }),
      settlementFor({ kind: "PROGRESS", output: {}, resume: {} }),
      settlementFor({ kind: "WAITING", reason: "approval", output: {} }),
      settlementFor({ kind: "BLOCKED", reason: "x", retryAfterSeconds: 1 }),
      settlementFor({
        kind: "FAILED",
        failureClass: "x",
        error: "x",
        retryable: true,
      }),
      settlementFor({
        kind: "FAILED",
        failureClass: "x",
        error: "x",
        retryable: false,
      }),
    ];
    for (const settlement of outcomes) {
      expect(
        canTransitionStage("running", settlement.stageStatus),
        settlement.stageStatus,
      ).toBe(true);
    }
  });
});

describe("checkpoint budget charge", () => {
  it("reads only a non-negative integer pending charge", () => {
    expect(pendingBudgetOf({})).toEqual({ modelCalls: 0, toolCalls: 0 });
    expect(pendingBudgetOf({ pendingBudget: null })).toEqual({
      modelCalls: 0,
      toolCalls: 0,
    });
    expect(
      pendingBudgetOf({
        pendingBudget: { modelCalls: 2.9, toolCalls: -4, extra: true },
      }),
    ).toEqual({ modelCalls: 2, toolCalls: 0 });
    expect(
      pendingBudgetOf({ pendingBudget: { modelCalls: "4", toolCalls: 1 } }),
    ).toEqual({ modelCalls: 0, toolCalls: 1 });
  });

  it("charges a resumed slice once when its checkpoint commit is replayed", () => {
    // The crash window: consume_budget used to commit before the checkpoint.
    // A replay of that attempt must add nothing. The next slice is a new
    // attempt and pays only the calls it added on top of the checkpointed
    // totals.
    const pending = sliceBudgetDelta({
      priorModelCalls: 3,
      priorToolCalls: 1,
      modelCalls: 5,
      toolCalls: 2,
      extraModelCalls: 1,
    });
    expect(pending).toEqual({ modelCalls: 3, toolCalls: 1 });

    const first = budgetChargeForAttempt({
      settledAttemptIds: [],
      attemptId: "attempt-a",
      pending,
    });
    expect(first).toEqual({
      modelCalls: 3,
      toolCalls: 1,
      alreadySettled: false,
    });

    const replay = budgetChargeForAttempt({
      settledAttemptIds: ["attempt-a"],
      attemptId: "attempt-a",
      pending,
    });
    expect(replay).toEqual({
      modelCalls: 0,
      toolCalls: 0,
      alreadySettled: true,
    });

    const next = budgetChargeForAttempt({
      settledAttemptIds: ["attempt-a"],
      attemptId: "attempt-b",
      pending: sliceBudgetDelta({
        priorModelCalls: 5,
        priorToolCalls: 2,
        modelCalls: 6,
        toolCalls: 2,
      }),
    });
    expect(next).toEqual({
      modelCalls: 1,
      toolCalls: 0,
      alreadySettled: false,
    });
  });

  it("commits the slice charge with the checkpoint, after the lease still holds", () => {
    const worker = readFileSync(
      join(process.cwd(), "src", "lib", "runtime", "worker.ts"),
      "utf8",
    );
    const execute = worker.slice(
      worker.indexOf("export async function executeClaimedStage"),
      worker.indexOf("async function persistVerdict"),
    );
    const lost = execute.indexOf("if (guard.leaseLost)");
    const finish = execute.indexOf("await finishAttempt(");
    const unsettled = execute.indexOf("if (!settled)");
    const charge = execute.indexOf("await checkpointStageBudget(");
    expect(lost).toBeGreaterThan(-1);
    expect(lost).toBeLessThan(finish);
    expect(finish).toBeLessThan(unsettled);
    expect(unsettled).toBeLessThan(charge);
    // The pending delta is an argument, not a durable key the next slice
    // could charge a second time.
    expect(execute).toContain("pendingBudgetOf(state)");
    expect(execute).toContain("state: durableState(state)");
    expect(worker).not.toContain('"pendingBudget"');
    expect(execute).not.toContain("consumeBudget");
    expect(execute).not.toContain("saveCheckpoint");

    const arm = readFileSync(
      join(process.cwd(), "src", "lib", "arms", "base.ts"),
      "utf8",
    );
    expect(arm).not.toContain("consumeBudget");
    expect(arm).toContain("context.state.pendingBudget = sliceBudgetDelta(");
    expect(arm).toContain("notePending(1)");
  });
});

describe("scheduler tick authorization", () => {
  const route = readFileSync(
    join(process.cwd(), "src", "app", "api", "scheduler", "tick", "route.ts"),
    "utf8",
  );

  it("refuses every request when no secret is configured", () => {
    // An unconfigured scheduler must be unavailable, not open. The 503 is
    // returned before any authorization check, so there is no path on which a
    // missing secret is treated as "no authentication required".
    expect(route).toContain("if (!env.OSIRUS_SCHEDULER_SECRET)");
    const guard = route.indexOf("if (!env.OSIRUS_SCHEDULER_SECRET)");
    const authorize = route.indexOf("if (!authorized(request))");
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(authorize);
    expect(route).toContain("scheduler_not_configured");
  });

  it("never falls back to same-origin checking", () => {
    // hasSameOrigin fails closed on a missing Origin header, which every cron
    // and machine caller omits. Using it here would make the route either
    // permanently closed or, if someone "fixed" it, open to any caller.
    expect(route).not.toMatch(/import[^;]*hasSameOrigin/);
    expect(route).not.toMatch(/hasSameOrigin\(/);
  });

  it("compares the secret in constant time", () => {
    expect(route).toContain("timingSafeEqual");
    expect(route).not.toMatch(/supplied === expected|expected === supplied/);
  });

  it("returns counts only, never tenant data", () => {
    const response = route.slice(route.lastIndexOf("return Response.json("));
    expect(response).toContain("runs: touched.size");
    for (const leak of ["objective", "answer", "workspaceId", "userId"]) {
      expect(response, leak).not.toContain(leak);
    }
  });

  it("executes each stage as the run's owner, not as the caller", () => {
    // The tick has no session. Taking identity from the claimed row is what
    // keeps a cross-tenant claim inside the tenant it belongs to.
    expect(route).toContain("userId: probe.requestedBy");
  });

  it("bounds the work one invocation may take", () => {
    expect(route).toContain("MAX_STAGES_PER_TICK");
    expect(route).toContain("MAX_RUNS_PER_TICK");
    expect(route).toContain("Date.now() < deadlineAt");
  });
});
