// When a scheduled automation runs next.
//
// Automations do not get their own timer. They run in the scheduler's window:
// the deployment's cron calls the tick once a day at 03:00 UTC, and the tick
// starts every automation that is due. So a schedule names days, not minutes,
// and "next run" is the next window on a matching day. This is the honest
// granularity of the platform, not a promise of a to-the-minute trigger.

export const SCHEDULER_WINDOW_HOUR_UTC = 3;

export type Cadence = "daily" | "weekdays" | "weekly";

export type Schedule = {
  cadence: Cadence;
  /** 0 = Sunday … 6 = Saturday; only for weekly. */
  weekday?: number;
};

export function parseSchedule(raw: unknown): Schedule {
  const value = (raw ?? {}) as { cadence?: unknown; weekday?: unknown };
  const cadence: Cadence =
    value.cadence === "weekdays" || value.cadence === "weekly"
      ? value.cadence
      : "daily";
  const weekday =
    typeof value.weekday === "number" &&
    Number.isInteger(value.weekday) &&
    value.weekday >= 0 &&
    value.weekday <= 6
      ? value.weekday
      : 1;
  return cadence === "weekly" ? { cadence, weekday } : { cadence };
}

function matches(schedule: Schedule, day: number) {
  if (schedule.cadence === "daily") return true;
  if (schedule.cadence === "weekdays") return day >= 1 && day <= 5;
  return day === (schedule.weekday ?? 1);
}

/** The first scheduler window strictly after `from` on a matching day. */
export function nextRunAt(
  schedule: Schedule,
  from: Date,
  hourUtc = SCHEDULER_WINDOW_HOUR_UTC,
): Date {
  const candidate = new Date(
    Date.UTC(
      from.getUTCFullYear(),
      from.getUTCMonth(),
      from.getUTCDate(),
      hourUtc,
      0,
      0,
      0,
    ),
  );
  if (candidate.getTime() <= from.getTime())
    candidate.setUTCDate(candidate.getUTCDate() + 1);
  for (let i = 0; i < 8; i += 1) {
    if (matches(schedule, candidate.getUTCDay())) return candidate;
    candidate.setUTCDate(candidate.getUTCDate() + 1);
  }
  return candidate;
}

const WEEKDAY = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

export function describeSchedule(schedule: Schedule) {
  const time = `${String(SCHEDULER_WINDOW_HOUR_UTC).padStart(2, "0")}:00 UTC`;
  if (schedule.cadence === "daily") return `Every day, ${time}`;
  if (schedule.cadence === "weekdays") return `Weekdays, ${time}`;
  return `Every ${WEEKDAY[schedule.weekday ?? 1]}, ${time}`;
}
