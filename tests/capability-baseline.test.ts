import { describe, expect, it } from "vitest";
import {
  formatBaselineMarkdown,
  runCapabilityBaseline,
} from "../src/lib/agent/baseline";

describe("capability baseline", () => {
  it("records eight offline tasks with independent grades", async () => {
    const records = await runCapabilityBaseline();
    expect(records.map((record) => record.domain)).toEqual([
      "THINKING",
      "REASONING",
      "CODING",
      "RESEARCH",
      "MATH",
      "BUILDING",
      "COMPUTER",
      "MEMORY",
    ]);
    for (const record of records) {
      expect(record.liveProvider).toBe(false);
      expect(record.mode).toBe("offline-fixture");
      expect(record.costUsd).toBeNull();
      expect(record.modelCalls).toBeGreaterThan(0);
      expect(record.latencyMs).toBeGreaterThanOrEqual(0);
    }

    const gated = ["THINKING", "REASONING", "RESEARCH", "MATH"];
    for (const domain of gated) {
      expect(
        records.find((record) => record.domain === domain)?.falseCompletion,
      ).toBe(false);
    }
    for (const domain of ["CODING", "BUILDING", "COMPUTER", "MEMORY"]) {
      expect(
        records.find((record) => record.domain === domain)?.falseCompletion,
      ).toBe(true);
    }

    const byDomain = Object.fromEntries(
      records.map((record) => [record.domain, record]),
    );
    expect(byDomain.THINKING?.success).toBe(true);
    expect(byDomain.THINKING?.verifiedSuccess).toBe(true);
    expect(byDomain.THINKING?.repairs).toBeGreaterThan(0);

    expect(byDomain.REASONING?.success).toBe(true);
    expect(byDomain.REASONING?.verifiedSuccess).toBe(true);
    expect(byDomain.REASONING?.toolCalls).toBe(2);

    expect(byDomain.CODING?.success).toBe(false);
    expect(byDomain.CODING?.verifiedSuccess).toBe(false);
    expect(byDomain.CODING?.notes).toMatch(/hidden tests still fail/i);
    expect(byDomain.CODING?.toolCalls).toBe(2);

    expect(byDomain.RESEARCH?.success).toBe(true);
    expect(byDomain.RESEARCH?.verifiedSuccess).toBe(true);
    expect(byDomain.RESEARCH?.toolCalls).toBe(2);

    expect(byDomain.MATH?.success).toBe(true);
    expect(byDomain.MATH?.verifiedSuccess).toBe(true);
    expect(byDomain.MATH?.toolCalls).toBe(1);

    expect(byDomain.BUILDING?.success).toBe(true);
    expect(byDomain.BUILDING?.verifiedSuccess).toBe(true);

    expect(byDomain.COMPUTER?.verifiedSuccess).toBe(false);
    expect(byDomain.COMPUTER?.notes.length).toBeGreaterThan(20);

    expect(byDomain.MEMORY?.success).toBe(true);
    expect(byDomain.MEMORY?.verifiedSuccess).toBe(true);
    expect(byDomain.MEMORY?.notes).toMatch(/Memory OS I/i);

    const markdown = formatBaselineMarkdown(records);
    expect(markdown).toContain("M30.2 capability baseline");
    expect(markdown).toContain("| CODING | false | false | true |");
    expect(byDomain.THINKING?.falseCompletion).toBe(false);
    expect(byDomain.REASONING?.falseCompletion).toBe(false);
  }, 60_000);
});
