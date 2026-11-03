import { describe, expect, it } from "vitest";
import { BILLING_CONFIG } from "../src/lib/billing/config";
import { quotaMessageDe, quotaStatus } from "../src/lib/billing/quota";

// Both windows refill on their own: a person who spent the 5-hour window is
// blocked until those calls are five hours old, a spent week until those
// calls are seven days old, then the next message goes through again.

const HOUR = 3_600_000;
const t0 = new Date("2026-11-03T08:00:00Z");
const at = (ms: number) => new Date(t0.getTime() + ms);

describe("quota refill over time", () => {
  const plan = "pro" as const;
  const five = BILLING_CONFIG.plans[plan].fiveHourBudgetUsd;
  const week = BILLING_CONFIG.plans[plan].weeklyBudgetUsd;

  it("the 5-hour window is blocked while spent and free again after five hours", () => {
    const calls = [{ at: t0, costUsd: five }];
    expect(quotaStatus({ plan, calls, now: at(HOUR) }).allowed).toBe(false);
    expect(quotaStatus({ plan, calls, now: at(5 * HOUR - 1000) }).allowed).toBe(
      false,
    );
    const after = quotaStatus({ plan, calls, now: at(5 * HOUR + 1000) });
    expect(after.allowed).toBe(true);
    expect(after.windows.find((w) => w.window === "fiveHour")!.spentUsd).toBe(
      0,
    );
  });

  it("the weekly window refills after seven days, even with the 5-hour window free", () => {
    // Spend the week in slices that each stay under the 5-hour budget.
    const slice = five * 0.9;
    const count = Math.ceil(week / slice);
    const calls = Array.from({ length: count }, (_, index) => ({
      at: at(index * 6 * HOUR),
      costUsd: slice,
    }));
    const last = (count - 1) * 6 * HOUR;
    const blocked = quotaStatus({ plan, calls, now: at(last + 6 * HOUR) });
    expect(blocked.allowed).toBe(false);
    expect(blocked.windows.find((w) => w.window === "weekly")!.exhausted).toBe(
      true,
    );
    expect(
      blocked.windows.find((w) => w.window === "fiveHour")!.exhausted,
    ).toBe(false);
    // Usable again at the reported moment, not before.
    const refill = blocked.availableAt!.getTime();
    expect(
      quotaStatus({ plan, calls, now: new Date(refill - 1000) }).allowed,
    ).toBe(false);
    expect(
      quotaStatus({ plan, calls, now: new Date(refill + 1000) }).allowed,
    ).toBe(true);
    // Fully empty once the newest call is a week old.
    const full = quotaStatus({
      plan,
      calls,
      now: at(last + 7 * 24 * HOUR + 1000),
    });
    expect(full.windows.every((w) => w.spentUsd === 0)).toBe(true);
  });

  it("tells the person in German which window is spent and when it is back", () => {
    const status = quotaStatus({
      plan,
      calls: [{ at: t0, costUsd: five }],
      now: at(HOUR),
      upgradable: false,
    });
    const text = quotaMessageDe(status);
    expect(text).toContain("5-Stunden-Kontingent");
    // 08:00 UTC + 5 h = 13:00 UTC = 14:00 in Berlin (CET).
    expect(text).toContain("14:00 Uhr");
    expect(text).not.toContain("größeren Plan");
  });
});
