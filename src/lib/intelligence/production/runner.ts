import "server-only";
import { env } from "../../env";
import { resolveSandbox } from "../../sandbox";
import { DurableTrialExecutor, foundryTenant } from "../executors/durable";
import { allowsContinuation, charge } from "../governor/governor";
import { foundryStep, type StepReport } from "../loop/research-loop";
import { advanceCanaries } from "../promotion/canary-step";
import { PgIntelStore } from "../store/pg-store";

// The Foundry in production: one bounded step per scheduler tick.
//
// It runs inside the M20 tick, after scheduled automations and before the
// claim loop, with its own short budget. Trials it starts are ordinary runs
// below product priority, so the claim loop that follows serves customers
// first and Foundry stages with whatever time is left. Any failure here is
// contained: the tick goes on and the Product Plane never notices.

export type FoundryTickReport = {
  ran: boolean;
  reason: string | null;
  step: StepReport | null;
  canary: string[];
  /** Whether another tick right away would have work to do. */
  continueChain: boolean;
};

/** The Foundry's share of a tick. */
const FOUNDRY_BUDGET_MS = 60_000;

export async function runFoundryTick(input: {
  owner: string;
  signal: AbortSignal;
}): Promise<FoundryTickReport> {
  const store = new PgIntelStore();
  const settings = await store.settings();
  const idle = (reason: string): FoundryTickReport => ({
    ran: false,
    reason,
    step: null,
    canary: [],
    continueChain: false,
  });
  if (!settings.flags.intelligencePlane) return idle("Foundry disabled");
  // Paid models are the operator's emergency switch, never a default.
  if (
    !/:free$/.test(settings.foundryModel) &&
    !settings.flags.paidModelEmergency
  )
    return idle(`Paid Foundry model ${settings.foundryModel} is not allowed`);
  if (!(await foundryTenant()))
    return idle("No platform operator is configured for the Foundry");

  const canary = await advanceCanaries(store, settings).catch(
    () => [] as string[],
  );
  const step = await foundryStep({
    store,
    executor: new DurableTrialExecutor(),
    owner: input.owner,
    deadline: Date.now() + FOUNDRY_BUDGET_MS,
    signal: input.signal,
    // Label checks and mutants run our own fixture code, in the sandbox.
    sandbox: () => resolveSandbox(),
    maxChallengers: 2,
    // M49: under the free-first policy the product runs on the verified free
    // pool; "free"/"auto" role values are pool sentinels, not model IDs.
    productModels: [
      env.OSIRUS_MODEL_STRONG,
      env.OSIRUS_MODEL_CODING,
      env.OSIRUS_FREE_MODEL_PRIMARY,
    ].filter(
      (model): model is string =>
        Boolean(model) && !/^(free|auto|free-first)$/i.test(model ?? ""),
    ),
  });
  const chain = await allowsContinuation(store, await store.settings());
  const busy =
    step.phase !== "idle" &&
    !/^Provider paused|envelope spent|disabled/.test(step.waiting ?? "");
  return {
    ran: true,
    reason: step.waiting,
    step,
    canary,
    continueChain: busy && chain.allowed,
  };
}

/** Count a chained tick against the day's continuation envelope. */
export async function chargeChainedTick() {
  await charge(new PgIntelStore(), { chained_ticks: 1 });
}
