import { describe, expect, it } from "vitest";
import {
  isSessionId,
  shouldApplyRunSnapshot,
} from "../src/lib/ui/snapshot-gate";

const session = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";
const run = "33333333-3333-4333-8333-333333333333";

describe("snapshot gate", () => {
  it("applies a poll that still belongs to this view", () => {
    expect(
      shouldApplyRunSnapshot({
        capturedGeneration: 2,
        generation: 2,
        requestedRunId: run,
        snapshotRunId: run,
        snapshotSessionId: session,
        viewSessionId: session,
      }),
    ).toBe(true);
  });

  it("drops a late poll after the conversation moved on", () => {
    expect(
      shouldApplyRunSnapshot({
        capturedGeneration: 1,
        generation: 2,
        requestedRunId: run,
        snapshotRunId: run,
        snapshotSessionId: session,
        viewSessionId: session,
      }),
    ).toBe(false);
  });

  it("drops a snapshot from another session", () => {
    expect(
      shouldApplyRunSnapshot({
        capturedGeneration: 1,
        generation: 1,
        requestedRunId: run,
        snapshotRunId: run,
        snapshotSessionId: other,
        viewSessionId: session,
      }),
    ).toBe(false);
  });

  it("drops a snapshot for a different run", () => {
    expect(
      shouldApplyRunSnapshot({
        capturedGeneration: 1,
        generation: 1,
        requestedRunId: run,
        snapshotRunId: other,
        snapshotSessionId: session,
        viewSessionId: session,
      }),
    ).toBe(false);
  });

  it("accepts only uuid session ids in the address bar", () => {
    expect(isSessionId(session)).toBe(true);
    expect(isSessionId("https://evil.example/app")).toBe(false);
    expect(isSessionId("../auth/sign-in")).toBe(false);
  });
});
