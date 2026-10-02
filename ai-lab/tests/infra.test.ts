/**
 * AI Lab — Phase K infrastructure adapter tests.
 *
 * Coverage for ai-lab/infra/runpod.ts: dry-run default, authorization triple,
 * budget guard ceilings and ledger, shutdown policy validation. No network,
 * no real credentials — everything is exercised against the pure in-process
 * scaffold. Picked up by the root vitest gate via ai-lab/tests/**.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  BudgetExceededError,
  BudgetGuard,
  GPU_PROFILES,
  MAX_AUTO_SHUTDOWN_MS,
  NotAuthorizedError,
  RunPodProvider,
  TRAINING_READY_ENV,
  TransportUnavailableError,
  validateProvisionRequest,
  validateShutdownPolicy,
  type ProvisionRequest,
} from "../infra/runpod";

afterEach(() => {
  vi.unstubAllEnvs();
});

const validRequest: ProvisionRequest = {
  profileId: "h200-sxm-141gb",
  gpuCount: 1,
  maxRuntimeMs: 3_600_000,
  shutdownPolicy: { autoShutdownAfterMs: 3_600_000 },
  experimentRef: "exp_stageb_smoke",
};

describe("RunPodProvider authorization", () => {
  it("defaults to dry-run and is not authorized", () => {
    const provider = new RunPodProvider();
    expect(provider.isDryRun).toBe(true);
    expect(provider.isAuthorized).toBe(false);
  });

  it("refuses real provisioning without the authorization triple", async () => {
    const provider = new RunPodProvider({ dryRun: false });
    await expect(provider.provision(validRequest)).rejects.toBeInstanceOf(
      NotAuthorizedError,
    );
    await expect(provider.terminate("pod-1")).rejects.toBeInstanceOf(
      NotAuthorizedError,
    );
    await expect(provider.status("pod-1")).rejects.toBeInstanceOf(
      NotAuthorizedError,
    );
  });

  it("refuses with an API key but without TRAINING_READY", async () => {
    const provider = new RunPodProvider({
      dryRun: false,
      apiKey: "fake-key-from-env",
    });
    await expect(provider.provision(validRequest)).rejects.toBeInstanceOf(
      NotAuthorizedError,
    );
  });

  it("refuses with TRAINING_READY=true but without an API key", async () => {
    vi.stubEnv(TRAINING_READY_ENV, "true");
    const provider = new RunPodProvider({ dryRun: false });
    await expect(provider.provision(validRequest)).rejects.toBeInstanceOf(
      NotAuthorizedError,
    );
  });

  it("still performs no network call when fully authorized (no transport)", async () => {
    vi.stubEnv(TRAINING_READY_ENV, "true");
    const guard = new BudgetGuard({ maxUsdPerRun: 100, maxUsdTotal: 100 });
    const provider = new RunPodProvider({
      dryRun: false,
      apiKey: "fake-key-from-env",
      budgetGuard: guard,
    });
    expect(provider.isAuthorized).toBe(true);
    await expect(provider.provision(validRequest)).rejects.toBeInstanceOf(
      TransportUnavailableError,
    );
    expect(guard.totalSpentUsd).toBe(0);
  });
});

describe("RunPodProvider dry-run", () => {
  it("returns a planned instance without side effects", async () => {
    const guard = new BudgetGuard({ maxUsdPerRun: 100, maxUsdTotal: 100 });
    const provider = new RunPodProvider({ budgetGuard: guard });
    const instance = await provider.provision(validRequest);
    expect(instance.dryRun).toBe(true);
    expect(instance.status).toBe("planned");
    expect(instance.id).toMatch(/^dryrun-/);
    expect(instance.plannedAction).toContain("zero spend");
    expect(guard.totalSpentUsd).toBe(0);
    expect(guard.ledger).toHaveLength(0);
  });

  it("quotes from the catalog without any call", async () => {
    const provider = new RunPodProvider();
    const quote = await provider.quote(validRequest);
    const h200 = GPU_PROFILES.find((p) => p.id === "h200-sxm-141gb");
    expect(quote.dryRun).toBe(true);
    expect(quote.estimatedUsdPerHour).toBeCloseTo(
      (h200?.approxUsdPerHour ?? 0) * validRequest.gpuCount,
    );
    expect(quote.estimatedTotalUsd).toBeCloseTo(quote.estimatedUsdPerHour);
    expect(quote.plannedAction).toContain("no provider call");
  });

  it("marks a quote outside the budget as not withinBudget", async () => {
    const guard = new BudgetGuard({ maxUsdPerRun: 1, maxUsdTotal: 10 });
    const provider = new RunPodProvider({ budgetGuard: guard });
    const quote = await provider.quote(validRequest);
    expect(quote.withinBudget).toBe(false);
  });

  it("terminates and reports planned instances without calls", async () => {
    const provider = new RunPodProvider();
    const instance = await provider.provision(validRequest);
    await provider.terminate(instance.id);
    await expect(provider.status(instance.id)).resolves.toBe("terminated");
  });
});

describe("BudgetGuard", () => {
  it("refuses an estimate above the per-run ceiling", () => {
    const guard = new BudgetGuard({ maxUsdPerRun: 10, maxUsdTotal: 100 });
    expect(() => guard.assertWithinBudget(10.01)).toThrow(BudgetExceededError);
    expect(() => guard.assertWithinBudget(10)).not.toThrow();
  });

  it("refuses when cumulative spend would exceed the total ceiling", () => {
    const guard = new BudgetGuard({ maxUsdPerRun: 60, maxUsdTotal: 100 });
    guard.recordSpend({ runId: "run-1", amountUsd: 60 });
    expect(() => guard.assertWithinBudget(41)).toThrow(BudgetExceededError);
    expect(() => guard.assertWithinBudget(40)).not.toThrow();
  });

  it("counts the ledger correctly", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-02T00:00:00.000Z"));
    try {
      const guard = new BudgetGuard({ maxUsdPerRun: 50, maxUsdTotal: 100 });
      guard.recordSpend({ runId: "run-1", amountUsd: 12.5 });
      guard.recordSpend({ runId: "run-2", amountUsd: 7.5 });
      expect(guard.totalSpentUsd).toBe(20);
      expect(guard.remainingUsd()).toBe(80);
      expect(guard.ledger).toHaveLength(2);
      expect(guard.ledger[0]).toEqual({
        runId: "run-1",
        amountUsd: 12.5,
        recordedAt: "2026-10-02T00:00:00.000Z",
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("refuses to record spend past the total ceiling", () => {
    const guard = new BudgetGuard({ maxUsdPerRun: 90, maxUsdTotal: 100 });
    guard.recordSpend({ runId: "run-1", amountUsd: 90 });
    expect(() => guard.recordSpend({ runId: "run-2", amountUsd: 11 })).toThrow(
      BudgetExceededError,
    );
    expect(guard.totalSpentUsd).toBe(90);
  });

  it("rejects invalid ceiling configurations", () => {
    expect(
      () => new BudgetGuard({ maxUsdPerRun: 0, maxUsdTotal: 100 }),
    ).toThrow();
    expect(
      () => new BudgetGuard({ maxUsdPerRun: 200, maxUsdTotal: 100 }),
    ).toThrow();
  });
});

describe("shutdown policy and request validation", () => {
  it("accepts a valid shutdown policy", () => {
    expect(validateShutdownPolicy({ autoShutdownAfterMs: 3_600_000 })).toEqual(
      [],
    );
  });

  it("rejects missing, non-positive, and unbounded shutdown deadlines", () => {
    expect(validateShutdownPolicy({})).toEqual([
      "autoShutdownAfterMs must be a positive integer",
    ]);
    expect(validateShutdownPolicy({ autoShutdownAfterMs: 0 })).toEqual([
      "autoShutdownAfterMs must be a positive integer",
    ]);
    expect(
      validateShutdownPolicy({ autoShutdownAfterMs: MAX_AUTO_SHUTDOWN_MS + 1 }),
    ).toHaveLength(1);
  });

  it("accepts a valid provision request and rejects invalid ones", () => {
    expect(validateProvisionRequest(validRequest)).toEqual([]);
    expect(
      validateProvisionRequest({ ...validRequest, profileId: "h2000-xl" }),
    ).toContain("profileId must be a known GPU profile id");
    expect(
      validateProvisionRequest({ ...validRequest, gpuCount: 0 }),
    ).toContain("gpuCount must be a positive integer");
    expect(
      validateProvisionRequest({ ...validRequest, maxRuntimeMs: 7_200_000 }),
    ).toContain(
      "maxRuntimeMs must not exceed shutdownPolicy.autoShutdownAfterMs",
    );
  });
});
