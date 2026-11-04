import { describe, expect, it } from "vitest";
import {
  chainDecision,
  MAX_PRODUCT_CHAIN,
  needsBackground,
} from "../src/lib/runtime/background";

// A closed tab used to park a person's run until the next hourly tick.

describe("background continuation", () => {
  it("continues only runs with claimable work", () => {
    for (const status of ["queued", "running", "verifying", "repairing"])
      expect(needsBackground(status)).toBe(true);
    for (const status of [
      "waiting_for_approval",
      "completed",
      "failed",
      "cancelled",
      null,
    ])
      expect(needsBackground(status)).toBe(false);
  });

  it("chains a tick while a person's run moved, without charging research", () => {
    expect(
      chainDecision({
        chain: 0,
        maxChain: 288,
        productMoved: 2,
        foundry: false,
        pulse: false,
        rsi: false,
      }),
    ).toEqual({ chained: true, charge: false });
    expect(
      chainDecision({
        chain: 3,
        maxChain: 288,
        productMoved: 0,
        foundry: false,
        pulse: false,
        rsi: false,
      }),
    ).toEqual({ chained: false, charge: false });
    expect(
      chainDecision({
        chain: 3,
        maxChain: 288,
        productMoved: 1,
        foundry: true,
        pulse: false,
        rsi: false,
      }),
    ).toEqual({ chained: true, charge: true });
  });

  it("stops a product chain after its limit and every chain at the hard cap", () => {
    expect(
      chainDecision({
        chain: MAX_PRODUCT_CHAIN,
        maxChain: 288,
        productMoved: 5,
        foundry: false,
        pulse: false,
        rsi: false,
      }).chained,
    ).toBe(false);
    expect(
      chainDecision({
        chain: 288,
        maxChain: 288,
        productMoved: 5,
        foundry: true,
        pulse: true,
        rsi: true,
      }).chained,
    ).toBe(false);
  });
});
