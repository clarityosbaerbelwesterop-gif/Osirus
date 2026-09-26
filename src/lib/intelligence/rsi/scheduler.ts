import "server-only";
import { PgPulseStore } from "../../agent/pulse/store";
import { PgIntelStore } from "../store/pg-store";
import { RSI_BUDGET_MS, runRsiSlice } from "./cycle";
import { rsiModel } from "./model";
import { PgRsiStore } from "./store";
import type { RsiTickReport } from "./types";

// The Recursive Intelligence Cycle inside the existing scheduler tick, after
// the Foundry step and the pulse, with its own share of the tick. State is
// in Postgres, so any instance continues any cycle. The cycle is tenantless:
// it runs as the system on osirus_intel only and never reads a tenant's
// work. Its only model spend is a live order the Actions runner executes.

export async function runRsiTick(input: {
  owner: string;
  signal: AbortSignal;
}): Promise<RsiTickReport> {
  const intel = new PgIntelStore();
  const settings = await intel.settings().catch(() => null);
  const model =
    settings?.foundryModel && /:free$/.test(settings.foundryModel)
      ? settings.foundryModel
      : rsiModel();
  return runRsiSlice({
    store: new PgRsiStore(),
    intel,
    pulse: new PgPulseStore(),
    owner: input.owner,
    deadline: Date.now() + RSI_BUDGET_MS,
    signal: input.signal,
    model,
  });
}
