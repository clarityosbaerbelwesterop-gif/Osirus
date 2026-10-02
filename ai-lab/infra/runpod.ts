/**
 * AI Lab — Phase K infrastructure adapter slot (RunPod / H200).
 *
 * HARD INVARIANTS (docs/ROUGE_RESEARCH_HANDOFF.md, docs/PRODUCTION_CERTIFICATION.md):
 * - TRAINING_READY is currently FALSE. No GPU spend without TRAINING_READY=TRUE
 *   **and** explicit written owner authorization (Stage D decision point).
 * - This module ships **no network transport**. Even a fully "authorized"
 *   provider instance cannot perform a real API call from this scaffold —
 *   there is intentionally nothing to call. See `TransportUnavailableError`.
 * - Default posture is dry-run: every method returns a *planned action*
 *   description without side effects and without spend.
 *
 * Authorization triple (ALL required for anything beyond dry-run):
 *   1. process.env.OSIRUS_TRAINING_READY === "true"
 *   2. an API key explicitly provided to the provider (never stored here,
 *      never committed — pass via environment at the call site)
 *   3. dryRun explicitly set to false
 *
 * This file is self-contained by design: no imports from `src/`, no external
 * dependencies, so the ai-lab tree stays severable. Validators follow the
 * contract convention of returning `string[]` of human-readable errors
 * (empty = valid), see ai-lab/contracts/common.ts.
 */

/* ---------------------------------------------------------------------------
 * Errors
 * ------------------------------------------------------------------------ */

/**
 * Thrown whenever a non-dry-run provider method is invoked without the full
 * authorization triple (TRAINING_READY env + API key + dryRun=false).
 */
export class NotAuthorizedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotAuthorizedError";
  }
}

/** Thrown when a run would exceed the configured budget ceiling. */
export class BudgetExceededError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BudgetExceededError";
  }
}

/**
 * Thrown when an authorized provider would perform a real API call. Phase K
 * ships no transport on purpose; reaching this error means the authorization
 * gate passed but there is still, by design, nothing to spend money with.
 */
export class TransportUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TransportUnavailableError";
  }
}

/* ---------------------------------------------------------------------------
 * Environment access (dependency-free; ai-lab has no @types/node)
 * ------------------------------------------------------------------------ */

function readEnv(name: string): string | undefined {
  const proc = (
    globalThis as { process?: { env?: Record<string, string | undefined> } }
  ).process;
  return proc?.env?.[name];
}

/** Env flag name gating any real provisioning. Currently FALSE repo-wide. */
export const TRAINING_READY_ENV = "OSIRUS_TRAINING_READY";

/* ---------------------------------------------------------------------------
 * GPU profiles (data only — no spend before TRAINING_READY)
 * ------------------------------------------------------------------------ */

export type GpuProfileId =
  | "cpu-only"
  | "rtx-4090-24gb"
  | "a100-80gb"
  | "h100-sxm-80gb"
  | "h200-sxm-141gb";

export interface GpuProfile {
  readonly id: GpuProfileId;
  readonly name: string;
  /** VRAM per device in GB; 0 for CPU-only. */
  readonly vramGb: number;
  /**
   * Catalog price estimate in USD per device-hour, for budgeting only.
   * Estimates, not quotes; a real quote requires owner authorization.
   */
  readonly approxUsdPerHour: number;
  readonly suitableFor: string;
}

/**
 * GPU profile catalog as pure data. **No spend before TRAINING_READY.**
 * Prices are rough public catalog figures for budget estimation; they are
 * never used to place an order from this scaffold.
 */
export const GPU_PROFILES: readonly GpuProfile[] = [
  {
    id: "cpu-only",
    name: "CPU-only dev box",
    vramGb: 0,
    approxUsdPerHour: 0.1,
    suitableFor: "Phase G/K scaffolding, unit tests, pipeline dry runs",
  },
  {
    id: "rtx-4090-24gb",
    name: "NVIDIA RTX 4090 24GB",
    vramGb: 24,
    approxUsdPerHour: 0.69,
    suitableFor: "Stage B smoke runs (tiny end-to-end, checkpoint + resume)",
  },
  {
    id: "a100-80gb",
    name: "NVIDIA A100 80GB SXM",
    vramGb: 80,
    approxUsdPerHour: 1.89,
    suitableFor: "Single-node ablations after Stage D sign-off",
  },
  {
    id: "h100-sxm-80gb",
    name: "NVIDIA H100 80GB SXM",
    vramGb: 80,
    approxUsdPerHour: 3.59,
    suitableFor: "Scale-path candidate (requires Stage D + Phase L gate)",
  },
  {
    id: "h200-sxm-141gb",
    name: "NVIDIA H200 141GB SXM",
    vramGb: 141,
    approxUsdPerHour: 4.69,
    suitableFor:
      "Scale-path candidate with largest VRAM headroom (requires Stage D + Phase L gate)",
  },
];

/** Look up a profile by id; `undefined` for unknown ids. */
export function getGpuProfile(id: string): GpuProfile | undefined {
  return GPU_PROFILES.find((profile) => profile.id === id);
}

/* ---------------------------------------------------------------------------
 * Shutdown policy (kill switch)
 * ------------------------------------------------------------------------ */

/**
 * Hard ceiling for any auto-shutdown timer: 24 hours. No run in this program
 * may exist without an automatic shutdown deadline, and no deadline may exceed
 * this bound.
 */
export const MAX_AUTO_SHUTDOWN_MS = 24 * 60 * 60 * 1000;

export interface ShutdownPolicy {
  /**
   * Mandatory kill switch: the instance must be terminated automatically at
   * most this many milliseconds after start. Required, positive, and bounded
   * by MAX_AUTO_SHUTDOWN_MS.
   */
  readonly autoShutdownAfterMs: number;
}

/** Contract-style validator: returns human-readable errors ([] = valid). */
export function validateShutdownPolicy(policy: unknown): string[] {
  const errors: string[] = [];
  if (typeof policy !== "object" || policy === null || Array.isArray(policy)) {
    return ["shutdown policy must be an object"];
  }
  const value = (policy as Record<string, unknown>).autoShutdownAfterMs;
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    !Number.isInteger(value) ||
    value <= 0
  ) {
    errors.push("autoShutdownAfterMs must be a positive integer");
  } else if (value > MAX_AUTO_SHUTDOWN_MS) {
    errors.push(
      `autoShutdownAfterMs must not exceed ${MAX_AUTO_SHUTDOWN_MS} (24h kill-switch bound)`,
    );
  }
  return errors;
}

/* ---------------------------------------------------------------------------
 * Provider contract
 * ------------------------------------------------------------------------ */

export interface ProvisionRequest {
  readonly profileId: GpuProfileId;
  /** Number of devices; positive integer. */
  readonly gpuCount: number;
  /** Wall-clock cap for the run; must not exceed the shutdown policy. */
  readonly maxRuntimeMs: number;
  /** Mandatory kill switch for the provisioned instance. */
  readonly shutdownPolicy: ShutdownPolicy;
  /** Experiment registry id this run is attributed to (recommended). */
  readonly experimentRef?: string;
}

export interface Quote {
  readonly request: ProvisionRequest;
  readonly profile: GpuProfile;
  /** Estimated USD per hour for the whole request (per-device * count). */
  readonly estimatedUsdPerHour: number;
  /** Worst-case estimate: hourly rate * maxRuntime. */
  readonly estimatedTotalUsd: number;
  /** True when the estimate fits the attached budget guard. */
  readonly withinBudget: boolean;
  /** True for every quote produced by this scaffold (no real calls). */
  readonly dryRun: boolean;
  /** Human-readable description of what a real call would do. */
  readonly plannedAction: string;
}

export type InstanceStatus =
  | "planned"
  | "provisioning"
  | "running"
  | "terminated"
  | "failed";

export interface Instance {
  readonly id: string;
  readonly request: ProvisionRequest;
  readonly status: InstanceStatus;
  /** True when the instance is a dry-run plan, not a real machine. */
  readonly dryRun: boolean;
  readonly plannedAction?: string;
}

/**
 * GPU provider contract. Training and experiment code programs against this
 * interface so providers stay replaceable (RunPod now, others later).
 */
export interface GpuProvider {
  quote(req: ProvisionRequest): Promise<Quote>;
  provision(req: ProvisionRequest): Promise<Instance>;
  terminate(id: string): Promise<void>;
  status(id: string): Promise<InstanceStatus>;
}

/** Contract-style validator for provision requests ([] = valid). */
export function validateProvisionRequest(req: unknown): string[] {
  const errors: string[] = [];
  if (typeof req !== "object" || req === null || Array.isArray(req)) {
    return ["provision request must be an object"];
  }
  const record = req as Record<string, unknown>;

  if (
    typeof record.profileId !== "string" ||
    !getGpuProfile(record.profileId)
  ) {
    errors.push("profileId must be a known GPU profile id");
  }
  if (
    typeof record.gpuCount !== "number" ||
    !Number.isInteger(record.gpuCount) ||
    record.gpuCount <= 0
  ) {
    errors.push("gpuCount must be a positive integer");
  }
  if (
    typeof record.maxRuntimeMs !== "number" ||
    !Number.isFinite(record.maxRuntimeMs) ||
    record.maxRuntimeMs <= 0
  ) {
    errors.push("maxRuntimeMs must be a positive number");
  }
  for (const policyError of validateShutdownPolicy(record.shutdownPolicy)) {
    errors.push(`shutdownPolicy: ${policyError}`);
  }
  if (
    typeof record.maxRuntimeMs === "number" &&
    typeof record.shutdownPolicy === "object" &&
    record.shutdownPolicy !== null
  ) {
    const policy = (record.shutdownPolicy as Record<string, unknown>)
      .autoShutdownAfterMs;
    if (
      typeof policy === "number" &&
      Number.isFinite(record.maxRuntimeMs) &&
      record.maxRuntimeMs > policy
    ) {
      errors.push(
        "maxRuntimeMs must not exceed shutdownPolicy.autoShutdownAfterMs",
      );
    }
  }
  if (
    record.experimentRef !== undefined &&
    (typeof record.experimentRef !== "string" ||
      record.experimentRef.trim().length === 0)
  ) {
    errors.push("experimentRef must be a non-empty string when provided");
  }
  return errors;
}

/* ---------------------------------------------------------------------------
 * Budget guard (in-memory ledger, hard ceilings)
 * ------------------------------------------------------------------------ */

export interface BudgetGuardConfig {
  /** Maximum USD a single run may cost (worst-case estimate). */
  readonly maxUsdPerRun: number;
  /** Maximum cumulative USD across all recorded runs. */
  readonly maxUsdTotal: number;
}

export interface SpendEntry {
  readonly runId: string;
  readonly amountUsd: number;
  readonly recordedAt: string;
}

/**
 * In-memory budget ledger with hard ceilings. The guard *refuses* any run
 * whose worst-case estimate exceeds `maxUsdPerRun` or would push cumulative
 * spend past `maxUsdTotal`. The ledger is process-local by design — durable
 * accounting belongs to the Phase H registry layer, not to this scaffold.
 */
export class BudgetGuard {
  private readonly config: BudgetGuardConfig;
  private readonly entries: SpendEntry[] = [];
  private readonly now: () => string;

  constructor(config: BudgetGuardConfig, now?: () => string) {
    if (
      !Number.isFinite(config.maxUsdPerRun) ||
      config.maxUsdPerRun <= 0 ||
      !Number.isFinite(config.maxUsdTotal) ||
      config.maxUsdTotal <= 0
    ) {
      throw new Error("budget ceilings must be positive finite numbers");
    }
    if (config.maxUsdPerRun > config.maxUsdTotal) {
      throw new Error("maxUsdPerRun must not exceed maxUsdTotal");
    }
    this.config = config;
    this.now = now ?? (() => new Date().toISOString());
  }

  /** Sum of all recorded spend. */
  get totalSpentUsd(): number {
    return this.entries.reduce((sum, entry) => sum + entry.amountUsd, 0);
  }

  /** Read-only view of the ledger. */
  get ledger(): readonly SpendEntry[] {
    return this.entries;
  }

  /** Remaining headroom under the total ceiling. */
  remainingUsd(): number {
    return this.config.maxUsdTotal - this.totalSpentUsd;
  }

  /** Non-throwing check used for quotes (estimate step of estimate→approve→run). */
  wouldExceed(estimatedUsd: number): boolean {
    return (
      estimatedUsd > this.config.maxUsdPerRun ||
      this.totalSpentUsd + estimatedUsd > this.config.maxUsdTotal
    );
  }

  /** Throws BudgetExceededError when the estimate breaks either ceiling. */
  assertWithinBudget(estimatedUsd: number): void {
    if (!Number.isFinite(estimatedUsd) || estimatedUsd < 0) {
      throw new BudgetExceededError(
        "estimated cost must be a non-negative finite number",
      );
    }
    if (estimatedUsd > this.config.maxUsdPerRun) {
      throw new BudgetExceededError(
        `estimated $${estimatedUsd.toFixed(2)} exceeds per-run ceiling $${this.config.maxUsdPerRun.toFixed(2)}`,
      );
    }
    if (this.totalSpentUsd + estimatedUsd > this.config.maxUsdTotal) {
      throw new BudgetExceededError(
        `estimated $${estimatedUsd.toFixed(2)} would push total spend past ceiling $${this.config.maxUsdTotal.toFixed(2)} (spent so far: $${this.totalSpentUsd.toFixed(2)})`,
      );
    }
  }

  /**
   * Record actual spend for a finished run. Refuses entries that would push
   * the ledger past the total ceiling — the ledger never lies about budget.
   */
  recordSpend(entry: { runId: string; amountUsd: number }): SpendEntry {
    if (typeof entry.runId !== "string" || entry.runId.trim().length === 0) {
      throw new Error("runId must be a non-empty string");
    }
    if (!Number.isFinite(entry.amountUsd) || entry.amountUsd < 0) {
      throw new BudgetExceededError(
        "spend amount must be a non-negative finite number",
      );
    }
    if (this.totalSpentUsd + entry.amountUsd > this.config.maxUsdTotal) {
      throw new BudgetExceededError(
        `recording $${entry.amountUsd.toFixed(2)} would exceed total ceiling $${this.config.maxUsdTotal.toFixed(2)}`,
      );
    }
    const recorded: SpendEntry = {
      runId: entry.runId,
      amountUsd: entry.amountUsd,
      recordedAt: this.now(),
    };
    this.entries.push(recorded);
    return recorded;
  }
}

/* ---------------------------------------------------------------------------
 * RunPod provider (adapter slot — no transport shipped)
 * ------------------------------------------------------------------------ */

export interface RunPodProviderConfig {
  /**
   * RunPod API key. Never hard-code, never commit; supply from the
   * environment at the call site. Required (with TRAINING_READY and
   * dryRun=false) for anything beyond dry-run.
   */
  readonly apiKey?: string;
  /** Default: true. Dry-run returns planned actions with zero side effects. */
  readonly dryRun?: boolean;
  /** Budget guard consulted by quote/provision. A zero-ish default guard is
   *  NOT provided: callers must state their ceilings explicitly. */
  readonly budgetGuard?: BudgetGuard;
}

export class RunPodProvider implements GpuProvider {
  private readonly apiKey?: string;
  private readonly dryRun: boolean;
  private readonly budgetGuard?: BudgetGuard;
  private readonly planned = new Map<string, Instance>();
  private planCounter = 0;

  constructor(config: RunPodProviderConfig = {}) {
    this.apiKey = config.apiKey;
    this.dryRun = config.dryRun ?? true;
    this.budgetGuard = config.budgetGuard;
  }

  /**
   * True only when the full authorization triple holds. Note: even then this
   * scaffold cannot spend — it ships no transport (see TransportUnavailableError).
   */
  get isAuthorized(): boolean {
    return (
      readEnv(TRAINING_READY_ENV) === "true" &&
      typeof this.apiKey === "string" &&
      this.apiKey.trim().length > 0 &&
      this.dryRun === false
    );
  }

  get isDryRun(): boolean {
    return this.dryRun;
  }

  private assertAuthorized(method: string): void {
    if (!this.isAuthorized) {
      throw new NotAuthorizedError(
        `RunPodProvider.${method} refused: requires ${TRAINING_READY_ENV}="true", an API key, and dryRun=false (docs/ROUGE_RESEARCH_HANDOFF.md: no GPU spend before TRAINING_READY)`,
      );
    }
  }

  private validateOrThrow(req: ProvisionRequest): void {
    const errors = validateProvisionRequest(req);
    if (errors.length > 0) {
      throw new Error(`invalid provision request: ${errors.join("; ")}`);
    }
  }

  private estimate(req: ProvisionRequest): {
    profile: GpuProfile;
    usdPerHour: number;
    totalUsd: number;
  } {
    // validateOrThrow guarantees the profile exists.
    const profile = getGpuProfile(req.profileId) as GpuProfile;
    const usdPerHour = profile.approxUsdPerHour * req.gpuCount;
    const totalUsd = (usdPerHour * req.maxRuntimeMs) / 3_600_000;
    return { profile, usdPerHour, totalUsd };
  }

  /**
   * Estimate step of the estimate → approve → run flow. Pure computation from
   * the catalog; never a network call, regardless of authorization state.
   */
  async quote(req: ProvisionRequest): Promise<Quote> {
    this.validateOrThrow(req);
    const { profile, usdPerHour, totalUsd } = this.estimate(req);
    const withinBudget = this.budgetGuard
      ? !this.budgetGuard.wouldExceed(totalUsd)
      : false;
    return {
      request: req,
      profile,
      estimatedUsdPerHour: usdPerHour,
      estimatedTotalUsd: totalUsd,
      withinBudget,
      dryRun: true,
      plannedAction: `would quote ${req.gpuCount}x ${profile.name} (~$${usdPerHour.toFixed(2)}/h, worst-case ~$${totalUsd.toFixed(2)}) — estimate only, no provider call`,
    };
  }

  async provision(req: ProvisionRequest): Promise<Instance> {
    this.validateOrThrow(req);
    const { profile, totalUsd } = this.estimate(req);

    if (this.dryRun) {
      // Dry-run never touches the budget ledger and never performs a call.
      this.planCounter += 1;
      const instance: Instance = {
        id: `dryrun-${this.planCounter}`,
        request: req,
        status: "planned",
        dryRun: true,
        plannedAction: `would provision ${req.gpuCount}x ${profile.name} with auto-shutdown after ${req.shutdownPolicy.autoShutdownAfterMs}ms (worst-case ~$${totalUsd.toFixed(2)}) — planned only, zero spend`,
      };
      this.planned.set(instance.id, instance);
      return instance;
    }

    this.assertAuthorized("provision");
    this.budgetGuard?.assertWithinBudget(totalUsd);
    throw new TransportUnavailableError(
      "RunPodProvider.provision: this Phase K scaffold ships no network transport; real provisioning is impossible here by design",
    );
  }

  async terminate(id: string): Promise<void> {
    const plannedInstance = this.planned.get(id);
    if (plannedInstance) {
      this.planned.set(id, { ...plannedInstance, status: "terminated" });
      return;
    }
    if (this.dryRun) {
      throw new Error(`unknown dry-run instance id: ${id}`);
    }
    this.assertAuthorized("terminate");
    throw new TransportUnavailableError(
      "RunPodProvider.terminate: no network transport in this scaffold",
    );
  }

  async status(id: string): Promise<InstanceStatus> {
    const plannedInstance = this.planned.get(id);
    if (plannedInstance) {
      return plannedInstance.status;
    }
    if (this.dryRun) {
      throw new Error(`unknown dry-run instance id: ${id}`);
    }
    this.assertAuthorized("status");
    throw new TransportUnavailableError(
      "RunPodProvider.status: no network transport in this scaffold",
    );
  }
}
