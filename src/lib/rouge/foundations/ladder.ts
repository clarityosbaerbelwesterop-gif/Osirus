import { providerRefusalOf } from "../../models/provider";
import type {
  CoreSpec,
  FoundationAdapter,
  FoundationCall,
  FoundationEvent,
} from "../foundation";

// The core ladder (M56.1): the requested core first, then measured
// substitutes, in order.
//
// A substitute answers only when the call allows it (interactive use), only
// when the core above it refused before saying anything, and it is always
// reported: servedModel() names the core that answered, and Rouge labels the
// answer as substituted. An evaluation (allowSubstitute: false) only ever
// reaches the first rung. Each rung is pinned with fallback off, so no
// unmeasured model from the free pool can answer in Rouge's name.
//
// The order of substitutes is not an opinion: it comes from the core
// selection tournament (evals/rouge-core-selection.eval.ts), and the
// evidence is recorded next to the list (see policy.ts, MEASURED_SUBSTITUTES).

/** Refusals that say "this core cannot answer now"; the next rung may. */
const SKIPPABLE = new Set([
  "insufficient_credit",
  "model_not_configured",
  "provider_unavailable",
  "timeout",
  "rate_limited",
  "capacity_deferred",
]);

/** How long a refused rung is skipped: a missing balance does not heal in seconds. */
const SKIP_MS: Record<string, number> = {
  insufficient_credit: 10 * 60_000,
  model_not_configured: 30 * 60_000,
};
const TRANSIENT_SKIP_MS = 60_000;

export class LadderFoundation implements FoundationAdapter {
  private readonly served = new Map<string, string>();
  private readonly skipUntil = new Map<string, number>();

  constructor(
    private readonly rungs: FoundationAdapter[],
    private readonly now: () => number = Date.now,
  ) {
    if (!rungs.length) throw new Error("a core ladder needs at least one core");
  }

  get core(): CoreSpec {
    return this.rungs[0]!.core;
  }

  /** The cores in order, for telemetry and the UI. */
  get cores() {
    return this.rungs.map((rung) => rung.core.id);
  }

  servedModel(requestId: string) {
    return this.served.get(requestId);
  }

  async *stream(call: FoundationCall): AsyncIterable<FoundationEvent> {
    const rungs = call.allowSubstitute ? this.rungs : this.rungs.slice(0, 1);
    let lastError: unknown = null;
    for (const [index, rung] of rungs.entries()) {
      const isLast = index === rungs.length - 1;
      // A rung refused recently is passed over -- unless it is the only
      // one left, which must still be asked so the refusal stays honest.
      if (!isLast && (this.skipUntil.get(rung.core.id) ?? 0) > this.now())
        continue;
      let started = false;
      try {
        for await (const event of rung.stream({
          ...call,
          allowSubstitute: false,
        })) {
          started = true;
          yield event;
        }
        this.served.set(
          call.requestId,
          rung.servedModel(call.requestId) ?? rung.core.id,
        );
        this.trim();
        return;
      } catch (error) {
        const refusal = providerRefusalOf(error);
        // Mid-answer failures are not swapped for another core's answer.
        if (started || !refusal || !SKIPPABLE.has(refusal.code)) throw error;
        this.skipUntil.set(
          rung.core.id,
          this.now() + (SKIP_MS[refusal.code] ?? TRANSIENT_SKIP_MS),
        );
        lastError = error;
      }
    }
    throw lastError ?? new Error("no core in the ladder could answer");
  }

  private trim() {
    if (this.served.size <= 256) return;
    const oldest = this.served.keys().next().value;
    if (oldest !== undefined) this.served.delete(oldest);
  }
}
