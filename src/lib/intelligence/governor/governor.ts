import type { IntelStore, LedgerCategory } from "../store/store";
import type { FoundrySettings } from "../types";

// The ResourceGovernor: what the Foundry may spend today, and where to spend
// it. It never blocks work to be cautious; it stops work only when a daily
// envelope is spent, and it points the next unit of work at the agenda item
// with the highest expected gain per model call.

export type Allowance = {
  allowed: boolean;
  reason: string | null;
  remaining: Record<
    "modelCalls" | "tokens" | "sandboxMinutes" | "chainedTicks",
    number
  >;
};

/** Model calls a trial is expected to take, from recent experience. */
export const DEFAULT_CALLS_PER_TRIAL = 10;

export async function allowance(
  store: IntelStore,
  settings: FoundrySettings,
  need: { modelCalls?: number; sandboxMinutes?: number } = {},
): Promise<Allowance> {
  const used = await store.usage();
  const remaining = {
    modelCalls: settings.budgets.dailyModelCalls - used.model_calls,
    tokens: settings.budgets.dailyTokens - used.tokens,
    sandboxMinutes: settings.budgets.dailySandboxMinutes - used.sandbox_minutes,
    chainedTicks: settings.budgets.dailyChainedTicks - used.chained_ticks,
  };
  const pause = settings.providerPause;
  const paused = pause && Date.parse(pause.until) > Date.now();
  const reason = !settings.flags.intelligencePlane
    ? "Intelligence Plane is disabled"
    : paused
      ? `Provider paused until ${pause.until} (${pause.code})`
      : remaining.modelCalls < (need.modelCalls ?? 1)
        ? "Daily model-call envelope spent"
        : remaining.tokens <= 0
          ? "Daily token envelope spent"
          : remaining.sandboxMinutes < (need.sandboxMinutes ?? 0)
            ? "Daily sandbox envelope spent"
            : null;
  return { allowed: reason === null, reason, remaining };
}

/** Parked by a provider refusal: how long, from the refusal itself. */
export function pauseFor(
  code: string,
  notes: string[],
  now = new Date(),
): number {
  const asked = notes.join(" ").match(/retry after (\d+)s/)?.[1];
  if (asked) return Math.max(60, Number(asked)) * 1000;
  // No credit or no valid credential will not heal by itself soon.
  if (/insufficient_credit|credential|not_configured/.test(code))
    return 6 * 60 * 60 * 1000;
  // A refusal without a stated wait: until the next UTC midnight, when free
  // pools reset, but never less than fifteen minutes.
  const midnight = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + 1,
  );
  return Math.max(15 * 60 * 1000, midnight - now.getTime());
}

/** Record a provider refusal so no further trial starts before it lifts. */
export async function pauseForProvider(
  store: IntelStore,
  code: string,
  notes: string[],
) {
  const settings = await store.settings();
  const now = new Date();
  const used = await store.usage();
  const until = new Date(now.getTime() + pauseFor(code, notes, now));
  await store.saveSettings({
    ...settings,
    providerPause: {
      until: until.toISOString(),
      code,
      observedCalls: used.model_calls,
      at: now.toISOString(),
    },
  });
  return until;
}

export async function charge(
  store: IntelStore,
  usage: Partial<Record<LedgerCategory, number>>,
) {
  for (const [category, amount] of Object.entries(usage) as Array<
    [LedgerCategory, number]
  >)
    if (amount) await store.addUsage(category, amount);
}

/** Whether a tick may schedule another tick right after itself. */
export async function allowsContinuation(
  store: IntelStore,
  settings: FoundrySettings,
) {
  const state = await allowance(store, settings, {
    modelCalls: DEFAULT_CALLS_PER_TRIAL,
  });
  return state.allowed && state.remaining.chainedTicks > 0
    ? { allowed: true as const, reason: null }
    : {
        allowed: false as const,
        reason: state.reason ?? "Daily continuation cap reached",
      };
}

/**
 * Expected capability gain per model call of working on an item: weakness
 * times usefulness times estimated potential, over the calls an experiment
 * on it costs. The agenda is ranked by this.
 */
export function expectedGainPerCall(input: {
  weakness: number;
  usefulness: number;
  potential: number;
  callsPerTrial: number;
  trials: number;
}) {
  const cost = Math.max(1, input.callsPerTrial * input.trials);
  return (input.weakness * input.usefulness * input.potential * 1000) / cost;
}
