import { today, type IntelStore } from "../store/store";

// The cycle's own live-call envelope, on top of the Foundry governor.
//
// By operator decision the free model is spent at about two calls an hour
// on live self-improvement: 48 a day, never more than 6 in one cycle, and
// never ahead of the clock (the allowance accrues through the UTC day, so a
// burst at 00:05 cannot spend the whole day). Everything else a cycle does
// is deterministic and costs no model call. When the envelope is spent the
// cycle still runs: evaluation, generation, red attacks, compilation and
// failure analysis continue offline.

export const RSI_DAILY_CALLS = 48;
export const RSI_CALLS_PER_HOUR = 2;
export const RSI_MAX_CALLS_PER_CYCLE = 6;

export type RsiBudget = {
  day: string;
  used: number;
  /** Calls accrued so far today, capped by the daily envelope. */
  accrued: number;
  /** What one cycle (or one live order) may reserve now. */
  available: number;
};

export function accruedCalls(now: Date) {
  const hours = now.getUTCHours() + 1;
  return Math.min(RSI_DAILY_CALLS, hours * RSI_CALLS_PER_HOUR);
}

export async function rsiBudget(
  store: IntelStore,
  now = new Date(),
): Promise<RsiBudget> {
  const day = today(now);
  const used = (await store.usage(day)).rsi_model_calls ?? 0;
  const accrued = accruedCalls(now);
  return {
    day,
    used,
    accrued,
    available: Math.max(0, Math.min(RSI_MAX_CALLS_PER_CYCLE, accrued - used)),
  };
}

/**
 * Reserve calls before spending them. Returns what was granted (possibly
 * fewer than asked, possibly 0). The reservation is charged at once, so two
 * callers cannot both spend the same headroom.
 */
export async function reserveCalls(
  store: IntelStore,
  want: number,
  now = new Date(),
) {
  const budget = await rsiBudget(store, now);
  const granted = Math.max(0, Math.min(want, budget.available));
  if (granted > 0) await store.addUsage("rsi_model_calls", granted, budget.day);
  return { granted, budget };
}

/**
 * Settle a reservation against what was actually spent: unused calls go
 * back, overruns are charged. The Foundry ledger sees the real spend too.
 */
export async function settleCalls(
  store: IntelStore,
  input: { reserved: number; spent: number; tokens: number; day: string },
) {
  const delta = input.spent - input.reserved;
  if (delta) await store.addUsage("rsi_model_calls", delta, input.day);
  if (input.spent) await store.addUsage("model_calls", input.spent, input.day);
  if (input.tokens) await store.addUsage("tokens", input.tokens, input.day);
}
