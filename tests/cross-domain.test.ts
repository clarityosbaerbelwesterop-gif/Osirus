import { describe, expect, it } from "vitest";
import {
  crossDomainComparison,
  pickValue,
} from "../src/lib/agent/pulse/cross-domain-suite";

// M39 evidence: the same five cross-domain tasks, the same fixture decision
// policy, the same real loop and tools -- once with the mission state and
// gate, once with the pre-M39 prose handoff and last-stage completion. What
// differs is only how capabilities hand over and how the run ends.

describe("cross-domain generalist (M39)", () => {
  it("reads a verified fact over a stale one, and avoids a rejected value", () => {
    expect(
      pickValue(
        {
          lines: ["An older page lists 16%; the current VAT rate is 19%."],
          rejected: ["The VAT rate is 16%"],
        },
        /(\d{1,2})\s*%/,
      ),
    ).toBe(19);
    expect(
      pickValue(
        {
          lines: ["An older page lists 16%; the current VAT rate is 19%."],
          rejected: [],
        },
        /(\d{1,2})\s*%/,
      ),
    ).toBe(16);
  });

  it("completes more missions on verified evidence and never falsely", async () => {
    const rows = await crossDomainComparison();
    const mission = rows.map((row) => row.mission);
    const prose = rows.map((row) => row.prose);
    const verified = (records: typeof mission) =>
      records.filter((record) => record.verifiedSuccess).length;

    expect(verified(mission)).toBe(5);
    expect(verified(prose)).toBeLessThan(verified(mission));
    expect(mission.some((record) => record.falseCompletion)).toBe(false);
    // Before M39 the last stage decided: L5 finished "done" on a wrong price.
    expect(prose.find((record) => record.level === 5)?.falseCompletion).toBe(
      true,
    );
    // Nothing handed over was lost, and cost is unchanged.
    for (const record of mission) expect(record.handoffLoss).toBe(0);
    for (const [index, row] of rows.entries())
      expect(row.mission.modelCalls, String(index)).toBe(row.prose.modelCalls);
    // L5 needed a capability the plan did not have, and recorded why.
    const l5 = mission.find((record) => record.level === 5)!;
    expect(l5.switches).toBe(1);
    expect(l5.planRevisions).toBeGreaterThanOrEqual(1);
  }, 120_000);
});
