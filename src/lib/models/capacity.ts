// M49 section 7: protect user chat from RSI.
//
// Free model capacity is scarce and shared by everything Osirus does. This
// scheduler decides, per model request, whether a caller may spend model
// capacity *now*:
//
//   P0  interactive user requests (chat)          -- always admitted
//   P1  user background work (automations)        -- always admitted
//   P2  verification jobs                         -- paused when no model is ready
//   P3  capability probes (pulse)                 -- paused when capacity is scarce
//   P4  RSI / self-play / Software RSI / Foundry  -- paused when capacity is scarce
//
// "Scarce" means a recent rate limit, free models cooling down, or user
// requests in flight. A paused P3/P4 caller gets a transient
// `capacity_deferred` refusal: it keeps doing offline work (tests, static
// analysis, failure analysis) and asks again later, but it does not consume
// model capacity while users are waiting. Pure except for the injected clock.

export type CapacityPriority = "P0" | "P1" | "P2" | "P3" | "P4";

export const PRIORITY_RANK: Record<CapacityPriority, number> = {
  P0: 0,
  P1: 1,
  P2: 2,
  P3: 3,
  P4: 4,
};

export type CapacitySignal = {
  /** Verified free models in the pool. */
  poolSize: number;
  /** Of those, how many are cooling down right now. */
  coolingDown: number;
  /** Of those, how many could take a request right now. */
  ready: number;
  /** Milliseconds since the last 429 anywhere, or null if none recorded. */
  msSinceRateLimit: number | null;
};

export type Admission =
  | { admitted: true }
  | { admitted: false; reason: string; retryAfterMs: number };

export type CapacityOptions = {
  /** How long after a 429 capacity counts as scarce. */
  rateLimitWindowMs?: number;
  /** Retry hint handed to deferred callers. */
  deferMs?: number;
};

export class CapacityScheduler {
  private readonly inFlight: Record<CapacityPriority, number> = {
    P0: 0,
    P1: 0,
    P2: 0,
    P3: 0,
    P4: 0,
  };
  private readonly rateLimitWindowMs: number;
  private readonly deferMs: number;

  constructor(options: CapacityOptions = {}) {
    this.rateLimitWindowMs = options.rateLimitWindowMs ?? 120_000;
    this.deferMs = options.deferMs ?? 60_000;
  }

  /** User-facing work (P0/P1) currently holding or waiting for capacity. */
  userDemand() {
    return this.inFlight.P0 + this.inFlight.P1;
  }

  inFlightCount(priority: CapacityPriority) {
    return this.inFlight[priority];
  }

  scarce(signal: CapacitySignal) {
    if (signal.poolSize === 0) return true;
    if (
      signal.msSinceRateLimit !== null &&
      signal.msSinceRateLimit < this.rateLimitWindowMs
    )
      return true;
    if (signal.coolingDown > 0) return true;
    return signal.ready === 0;
  }

  admit(priority: CapacityPriority, signal: CapacitySignal): Admission {
    const rank = PRIORITY_RANK[priority];
    if (rank <= PRIORITY_RANK.P1) return { admitted: true };
    const scarce = this.scarce(signal);
    if (rank === PRIORITY_RANK.P2) {
      // Verification yields only when nothing can serve at all and users
      // are waiting for that nothing.
      if (signal.ready === 0 && this.userDemand() > 0)
        return this.defer("user requests are waiting for a free model");
      return { admitted: true };
    }
    // P3 / P4.
    if (this.userDemand() > 0)
      return this.defer("user requests are using model capacity");
    if (scarce)
      return this.defer(
        "free model capacity is scarce (rate limit or cooldown)",
      );
    return { admitted: true };
  }

  private defer(reason: string): Admission {
    return { admitted: false, reason, retryAfterMs: this.deferMs };
  }

  /** Hold a slot for the duration of a request; returns the release. */
  begin(priority: CapacityPriority) {
    this.inFlight[priority] += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.inFlight[priority] = Math.max(0, this.inFlight[priority] - 1);
    };
  }
}
