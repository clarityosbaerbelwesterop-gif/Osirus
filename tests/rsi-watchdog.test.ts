import { describe, expect, it } from "vitest";
import type { LoopResult } from "../src/lib/agent/loop";
import { MemoryPulseStore } from "../src/lib/agent/pulse/store";
import {
  gradeLoopOutcome,
  PRODUCT_SUITE,
  productRegressions,
} from "../src/lib/agent/watchdog/rsi";
import { WINDOW } from "../src/lib/agent/watchdog/window";
import type { CapabilityOutcome } from "../src/lib/verification/outcome";

function loop(overrides: Partial<LoopResult> = {}): LoopResult {
  return {
    status: "finished",
    state: {
      steps: [
        {
          index: 0,
          action: "FINISH",
          summary: "done",
          outcome: "finished",
          latencyMs: 1,
        },
      ],
      observations: [],
      disclosedSchemas: {},
      modelCalls: 1,
      toolCalls: 0,
      answer: "Result: 391",
      artifacts: [],
    },
    answer: "Result: 391",
    reason: "finished",
    ...overrides,
  } as LoopResult;
}

describe("RSI watchdog", () => {
  it("does not call a finished answer verified without evidence", () => {
    expect(gradeLoopOutcome(loop()).outcome).toBe("SUCCESS_UNVERIFIED");
  });

  it("reads a provider refusal as infrastructure, never as a regression", () => {
    const refused = loop({
      status: "failed",
      answer: undefined,
      refusal: { code: "rate_limited", transient: true, retryAfterMs: 60_000 },
    } as Partial<LoopResult>);
    expect(gradeLoopOutcome(refused).outcome).toBe("INFRASTRUCTURE_FAILURE");
  });

  it("uses the verification the loop recorded", () => {
    const base = loop();
    const verified = loop({
      state: {
        ...base.state,
        kernel: {
          verificationState: { status: "verified", checks: [] },
          hypotheses: [],
        },
      } as never,
    });
    expect(gradeLoopOutcome(verified).outcome).toBe("VERIFIED_SUCCESS");
    const rejectedClaim = loop({
      answer: "All tests pass and the bug is fixed.",
      state: {
        ...base.state,
        kernel: {
          verificationState: { status: "rejected", checks: [] },
          hypotheses: [],
        },
      } as never,
    });
    expect(gradeLoopOutcome(rejectedClaim).outcome).toBe("FALSE_COMPLETION");
  });

  it("decides product regressions over windows, confirmed twice", async () => {
    const pulse = new MemoryPulseStore();
    const rows: Array<{
      outcome: string;
      verification: { capabilityOutcome?: CapabilityOutcome };
      createdAt: string;
    }> = [];
    const at = (index: number) =>
      new Date(
        Date.parse("2026-09-20T00:00:00Z") + index * 60_000,
      ).toISOString();
    for (let index = 0; index < WINDOW.reference; index += 1)
      rows.push({
        outcome: "verified_success",
        verification: {},
        createdAt: at(index),
      });
    for (let index = 0; index < WINDOW.recent; index += 1)
      rows.push({
        outcome: "failure",
        verification: { capabilityOutcome: "REJECTED" },
        createdAt: at(100 + index),
      });
    const listExperience = async (filter: { capabilityId: string }) =>
      filter.capabilityId === "arm.coding" ? rows : [];
    const now = Date.parse("2026-09-25T00:00:00Z");
    const first = await productRegressions({ pulse, listExperience, now });
    expect(first).toHaveLength(0);
    const second = await productRegressions({ pulse, listExperience, now });
    expect(second.map((entry) => [entry.family, entry.source])).toEqual([
      ["CODING", "product"],
    ]);
    const cell = await pulse.baseline(PRODUCT_SUITE, "CODING", 3);
    expect(cell?.regressionStreak).toBe(2);
  });

  it("ignores infrastructure failures in product windows", async () => {
    const pulse = new MemoryPulseStore();
    const rows = Array.from({ length: 30 }, (_, index) => ({
      outcome: index < 20 ? "verified_success" : "error",
      verification: {},
      createdAt: new Date(1_700_000_000_000 + index * 1000).toISOString(),
    }));
    const listExperience = async () => rows;
    await productRegressions({ pulse, listExperience });
    const again = await productRegressions({ pulse, listExperience });
    expect(again).toHaveLength(0);
  });
});
