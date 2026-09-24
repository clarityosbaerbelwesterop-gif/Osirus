import { describe, expect, it } from "vitest";
import {
  formatPulseMarkdown,
  PULSE_LEVELS,
  PULSE_SUITES,
  runPulseSuite,
} from "../src/lib/agent/pulse";

describe("M38 capability pulse", () => {
  it("runs twenty offline tasks across four suites at L1–L5", async () => {
    const records = await runPulseSuite();
    expect(records).toHaveLength(20);
    for (const suite of PULSE_SUITES) {
      const levels = records
        .filter((record) => record.suite === suite)
        .map((r) => r.level);
      expect(levels.sort()).toEqual([...PULSE_LEVELS]);
    }
    for (const record of records) {
      expect(record.liveProvider).toBe(false);
      expect(record.mode).toBe("offline-fixture");
      expect(record.costUsd).toBeNull();
      expect(record.notes.length).toBeGreaterThan(10);
    }
  }, 120_000);

  it("filters by suite and level", async () => {
    const records = await runPulseSuite({ suite: "TOOL_USE", level: 3 });
    expect(records).toHaveLength(1);
    expect(records[0]?.id).toBe("tool-use-l3-retry");
    expect(records[0]?.success).toBe(true);
  }, 30_000);

  it("formats markdown summary", async () => {
    const records = await runPulseSuite({ suite: "BUILDING", level: 1 });
    const markdown = formatPulseMarkdown(records);
    expect(markdown).toContain("M38 capability pulse");
    expect(markdown).toContain("| BUILDING | L1 |");
    expect(markdown).toContain("building-l1-scaffold");
  }, 30_000);

  it("building L1 scaffold succeeds without claiming browser QA", async () => {
    const [record] = await runPulseSuite({ suite: "BUILDING", level: 1 });
    expect(record?.success).toBe(true);
    expect(record?.verifiedSuccess).toBe(true);
    expect(record?.falseCompletion).toBe(true);
  }, 30_000);

  it("tool use L5 compute verify passes", async () => {
    const [record] = await runPulseSuite({ suite: "TOOL_USE", level: 5 });
    expect(record?.success).toBe(true);
    expect(record?.verifiedSuccess).toBe(true);
  }, 30_000);
});
