import "server-only";
import { feedRegressionExperience, productRegressions } from "../watchdog/rsi";
import { pulseCatalog } from "./catalog";
import { PULSE_BUDGET_MS, runPulseSlice } from "./runner";
import { PgPulseStore } from "./store";
import type { PulseTickReport } from "./types";

// The capability pulse inside the existing scheduler tick. State is in
// Postgres (osirus_intel.pulse_*), so any instance continues any cycle.
// Offline tasks only: a live coding loop on the free model outlasts a tick.
// A chained tick is requested only while the day's continuation envelope
// has room -- the same envelope the Foundry uses.

export async function runCapabilityPulseTick(input: {
  owner: string;
  signal: AbortSignal;
}): Promise<PulseTickReport> {
  const store = new PgPulseStore();
  const specs = await pulseCatalog();
  const report = await runPulseSlice({
    store,
    owner: input.owner,
    specs,
    deadline: Date.now() + PULSE_BUDGET_MS,
    signal: input.signal,
    modes: ["offline"],
    onRegression: (regression, cycleId) =>
      feedRegressionExperience(regression, cycleId),
  });

  if (report.completedCycle) {
    const { PgIntelStore } = await import("../../intelligence/store/pg-store");
    const intel = new PgIntelStore();
    const product = await productRegressions({
      pulse: store,
      listExperience: (filter) => intel.listExperience(filter),
    }).catch(() => []);
    for (const regression of product)
      await feedRegressionExperience(regression, report.cycleId);
    report.regressions.push(...product);
  }

  if (report.continueChain) report.continueChain = await chainHasRoom();
  return report;
}

/** Whether the day's chained-tick envelope has room for one more. */
async function chainHasRoom() {
  try {
    const { PgIntelStore } = await import("../../intelligence/store/pg-store");
    const store = new PgIntelStore();
    const [settings, used] = await Promise.all([
      store.settings(),
      store.usage(),
    ]);
    return used.chained_ticks < settings.budgets.dailyChainedTicks;
  } catch {
    return false;
  }
}
