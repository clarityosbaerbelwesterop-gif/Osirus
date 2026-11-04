// Runs keep working when nobody watches.
//
// The request that starts a run drives it while the browser stays connected;
// a closed tab used to leave the rest to the scheduler, whose next tick could
// be an hour away (the hourly pulse; the cron is daily). Now the request asks
// for a tick the moment it ends with work left, and a tick that moved a
// person's run asks for the next one, until nothing moves.

/** Statuses with work a tick can claim (not waiting on a person). */
const WORKING = new Set([
  "created",
  "planning",
  "queued",
  "running",
  "verifying",
  "repairing",
  "cancelling",
]);

export function needsBackground(status: string | null | undefined) {
  return WORKING.has(String(status ?? ""));
}

/** Product chains stop here (about four hours of ticks), before MAX_CHAIN. */
export const MAX_PRODUCT_CHAIN = 60;

/**
 * Whether a tick asks for the next one, and whether that next tick is charged
 * to the Foundry's daily envelope (only Foundry, pulse or RSI work is: a
 * person's run never spends the research budget).
 */
export function chainDecision(input: {
  chain: number;
  maxChain: number;
  /** Stages of people's runs (not strategy trials) this tick moved. */
  productMoved: number;
  foundry: boolean;
  pulse: boolean;
  rsi: boolean;
}) {
  if (input.chain >= input.maxChain) return { chained: false, charge: false };
  const research = input.foundry || input.pulse || input.rsi;
  const product = input.productMoved > 0 && input.chain < MAX_PRODUCT_CHAIN;
  return { chained: research || product, charge: research };
}
