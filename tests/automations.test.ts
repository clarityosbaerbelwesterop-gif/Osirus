import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  describeSchedule,
  nextRunAt,
  parseSchedule,
} from "../src/lib/automations/schedule";

const calls: Array<{ sql: string; params: unknown[] }> = [];
let responder: (sql: string) => unknown[] = () => [];

vi.mock("../src/lib/db/client", () => ({
  queryAs: async (_user: string, sql: string, params: unknown[] = []) => {
    calls.push({ sql, params });
    return responder(sql);
  },
  querySystem: async (sql: string, params: unknown[] = []) => {
    calls.push({ sql, params });
    return responder(sql);
  },
}));

const identity = {
  userId: "11111111-1111-4111-8111-111111111111",
  organizationId: "22222222-2222-4222-8222-222222222222",
  workspaceId: "33333333-3333-4333-8333-333333333333",
};

describe("automation schedules", () => {
  it("runs in the next scheduler window on a matching day", () => {
    // Wednesday 2026-09-23 10:00 UTC
    const from = new Date("2026-09-23T10:00:00Z");
    expect(nextRunAt({ cadence: "daily" }, from).toISOString()).toBe(
      "2026-09-24T03:00:00.000Z",
    );
    expect(
      nextRunAt(
        { cadence: "daily" },
        new Date("2026-09-23T02:00:00Z"),
      ).toISOString(),
    ).toBe("2026-09-23T03:00:00.000Z");
    // Friday evening → next weekday window is Monday
    expect(
      nextRunAt(
        { cadence: "weekdays" },
        new Date("2026-09-25T20:00:00Z"),
      ).toISOString(),
    ).toBe("2026-09-28T03:00:00.000Z");
    // Weekly on Sunday
    expect(
      nextRunAt({ cadence: "weekly", weekday: 0 }, from).toISOString(),
    ).toBe("2026-09-27T03:00:00.000Z");
  });

  it("never schedules the same window twice", () => {
    const at = new Date("2026-09-24T03:00:00Z");
    expect(nextRunAt({ cadence: "daily" }, at).toISOString()).toBe(
      "2026-09-25T03:00:00.000Z",
    );
  });

  it("defaults junk schedules to daily and describes the window honestly", () => {
    expect(parseSchedule({ cadence: "every-minute" })).toEqual({
      cadence: "daily",
    });
    expect(parseSchedule({ cadence: "weekly", weekday: 9 })).toEqual({
      cadence: "weekly",
      weekday: 1,
    });
    expect(describeSchedule({ cadence: "weekdays" })).toBe(
      "Weekdays, 03:00 UTC",
    );
  });
});

describe("run settlement", () => {
  beforeEach(() => {
    calls.length = 0;
    responder = () => [];
  });

  it("records an automation's result and notifies once per its policy", async () => {
    responder = (sql) =>
      sql.includes("update osirus.automations set last_status")
        ? [{ name: "Nightly triage", notify_on: ["failed", "approval"] }]
        : [];
    const { onRunSettled } = await import("../src/lib/automations/store");
    await onRunSettled(identity, {
      id: "44444444-4444-4444-8444-444444444444",
      status: "failed",
      automationId: "55555555-5555-4555-8555-555555555555",
      objective: "Triage new issues",
    });
    const notification = calls.find((call) =>
      call.sql.includes("insert into osirus.notifications"),
    );
    expect(notification?.params).toContain("automation_failed");
    expect(notification?.sql).toContain(
      "on conflict (user_id, dedupe_key) do nothing",
    );
    expect(String(notification?.params.at(-1))).toBe(
      "automation:44444444-4444-4444-8444-444444444444:failed",
    );
  });

  it("does not notify on completion unless asked", async () => {
    responder = (sql) =>
      sql.includes("update osirus.automations set last_status")
        ? [{ name: "Nightly triage", notify_on: ["failed"] }]
        : [];
    const { onRunSettled } = await import("../src/lib/automations/store");
    await onRunSettled(identity, {
      id: "44444444-4444-4444-8444-444444444444",
      status: "completed",
      automationId: "55555555-5555-4555-8555-555555555555",
      objective: "x",
    });
    expect(
      calls.some((call) =>
        call.sql.includes("insert into osirus.notifications"),
      ),
    ).toBe(false);
  });

  it("lets only runs people started trigger run-completed automations", async () => {
    const { onRunSettled } = await import("../src/lib/automations/store");
    await onRunSettled(identity, {
      id: "44444444-4444-4444-8444-444444444444",
      status: "completed",
      automationId: "55555555-5555-4555-8555-555555555555",
      objective: "x",
    });
    expect(calls.some((call) => call.params.includes("run_completed"))).toBe(
      false,
    );

    calls.length = 0;
    await onRunSettled(identity, {
      id: "66666666-6666-4666-8666-666666666666",
      status: "completed",
      automationId: null,
      objective: "x",
    });
    expect(calls.some((call) => call.params.includes("run_completed"))).toBe(
      true,
    );
  });
});
