/** Stops a call before any network spend. Zero means free calls only. */
export class LabCostBudget {
  private spentUsd = 0;

  constructor(readonly maxUsd: number) {
    if (!Number.isFinite(maxUsd) || maxUsd < 0) {
      throw new Error("lab cost budget must be a non-negative finite number");
    }
  }

  get spent(): number {
    return this.spentUsd;
  }

  reserve(estimateUsd: number): void {
    if (!Number.isFinite(estimateUsd) || estimateUsd < 0) {
      throw new Error(
        "cost estimate must be a non-negative finite number; refusing to call",
      );
    }
    if (this.spentUsd + estimateUsd > this.maxUsd) {
      throw new Error(
        `cost budget stop: estimate ${estimateUsd} would exceed remaining ${this.maxUsd - this.spentUsd}`,
      );
    }
    this.spentUsd += estimateUsd;
  }
}

/**
 * `:free` catalog ids are treated as zero cost. Anything else needs an
 * explicit non-negative price. Unknown price fails closed.
 */
export function estimateCallUsd(
  modelId: string,
  priceUsd: number | undefined,
): number {
  if (modelId.endsWith(":free")) return 0;
  if (priceUsd === undefined) {
    throw new Error(
      `no price for ${modelId}; refusing the call rather than spending`,
    );
  }
  return priceUsd;
}

export function budgetFromEnv(env: NodeJS.ProcessEnv): LabCostBudget {
  const raw = env.LAB_COST_BUDGET_USD;
  if (raw === undefined || raw.trim() === "") return new LabCostBudget(0);
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error("LAB_COST_BUDGET_USD must be a non-negative number");
  }
  return new LabCostBudget(value);
}
