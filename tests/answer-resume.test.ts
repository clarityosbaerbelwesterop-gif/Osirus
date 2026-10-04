import { describe, expect, it } from "vitest";
import { botRuntimeBody } from "../src/lib/product/bot-run";
import { codingGrantFromRunInput } from "../src/lib/product/surfaces";
import { pollNudge } from "../src/lib/runtime/poll-nudge";
import {
  retryAttemptsLeft,
  settlementFor,
} from "../src/lib/runtime/settlement";
import type { RunSnapshot, RunStatus } from "../src/lib/runtime/types";

function snapshot(
  status: RunStatus,
  stages: Array<Record<string, unknown>>,
): RunSnapshot {
  return {
    run: {
      id: "r",
      sessionId: "s",
      objective: "answer",
      status,
      cancelRequested: false,
    },
    stages,
    attempts: [],
    dependencies: [],
    artifacts: [],
    approvals: [],
    events: [],
    checkpoints: [],
    messages: [],
  };
}

describe("answer stage after Yes", () => {
  it("keeps the one retry after an approval park", () => {
    // The approval wait is attempt 1 and completes. The resume is attempt 2.
    // attempt_count stays at 1 because a completed wait is not a failed try.
    // Comparing attemptNumber with maxAttempts (2) made the first model
    // error after Yes terminal.
    expect(
      retryAttemptsLeft({
        attemptCount: 1,
        attemptNumber: 2,
        maxAttempts: 2,
      }),
    ).toBe(true);
    expect(
      retryAttemptsLeft({
        attemptCount: 2,
        attemptNumber: 3,
        maxAttempts: 2,
      }),
    ).toBe(false);
    expect(
      retryAttemptsLeft({
        attemptCount: 1,
        attemptNumber: 1,
        maxAttempts: 1,
      }),
    ).toBe(false);
    // Arena claims have no stage counter; the attempt number is the ceiling.
    expect(retryAttemptsLeft({ attemptNumber: 1, maxAttempts: 2 })).toBe(true);
    expect(retryAttemptsLeft({ attemptNumber: 9, maxAttempts: null })).toBe(
      true,
    );
  });

  it("still parks a retryable failure when a try remains", () => {
    const outcome = {
      kind: "FAILED" as const,
      failureClass: "model",
      error: "boom",
      retryable: true,
    };
    expect(settlementFor(outcome, Date.now(), true).stageStatus).toBe(
      "blocked",
    );
    expect(settlementFor(outcome, Date.now(), false).stageStatus).toBe(
      "failed",
    );
  });

  it("drives a released answer stage that is still waiting_for_approval", () => {
    const released = pollNudge(
      snapshot("waiting_for_approval", [
        { status: "blocked", runnable_after: null },
      ]),
    );
    expect(released.drive).toBe(true);
    expect(released.finalize).toBe(true);

    const stillWaiting = pollNudge(
      snapshot("waiting_for_approval", [{ status: "waiting" }]),
    );
    expect(stillWaiting).toEqual({
      settleCancel: false,
      drive: false,
      finalize: false,
    });
  });
});

describe("bot runtime body", () => {
  it("starts the shared run on the bot surface with no coding grant", () => {
    const body = botRuntimeBody({
      objective: "What is the capital of Switzerland?",
      requestId: "req",
      sessionId: null,
    });
    expect(body).toEqual({
      objective: "What is the capital of Switzerland?",
      requestId: "req",
      sessionId: null,
      surface: "bot",
    });
    expect(body).not.toHaveProperty("coding");
    expect(
      codingGrantFromRunInput({
        ...body,
        coding: {
          repository: "https://github.com/acme/widgets",
          branch: "main",
          effort: "hoch",
          model: "darus",
        },
      }),
    ).toBeNull();
  });
});
