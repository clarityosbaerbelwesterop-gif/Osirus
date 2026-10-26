import "server-only";
import type { ModelProvider, ModelRole } from "../models/provider";
import { cachedProvider } from "../models/cache";
import { ProviderError } from "../models/unorouter";
import { env } from "../env";
import { isNvidiaTopModelId } from "../../config/recommendations";
import {
  BILLING_CONFIG,
  type BillingPlan,
  type FreePlanLimits,
} from "./config";
import { effectivePlan, quotaStatus, type QuotaStatus } from "./quota";
import { currentSubscription, usageSince } from "./store";
import { isOwnerUser } from "../gateway/owners";

// Server-side quota enforcement. Every model call made for a user goes
// through quotaGuardedProvider, which checks the user's 5-hour and weekly
// budgets before the call. A spent window throws a transient ProviderError
// (quota_exhausted) carrying the time until it refills, so the runtime parks
// the stage and resumes it on its own -- the user waits, nothing is banned.

/**
 * Quotas (and the free plan's model lock) are enforced whether or not Stripe
 * is configured: without STRIPE_SECRET_KEY nobody can buy a plan, so users
 * are on the free plan and its budgets still protect our UNOROUTER keys.
 * Only Checkout/Portal/upgrade depend on Stripe. BILLING_CONFIG.enforceQuotas
 * is the one master switch.
 */
export function quotaEnforced() {
  return BILLING_CONFIG.enforceQuotas;
}

/** Stripe is configured, so upgrading to a paid plan is possible. */
export function upgradesAvailable() {
  return Boolean(env.STRIPE_SECRET_KEY);
}

/** The provider for a user's product run: quota-guarded and cached when enforced. */
export function forUser(provider: ModelProvider, userId: string) {
  const withCache = cachedProvider(provider);
  return quotaEnforced() ? quotaGuardedProvider(withCache, userId) : withCache;
}

export async function quotaStatusFor(
  userId: string,
  now = new Date(),
): Promise<QuotaStatus> {
  const subscription = await currentSubscription(userId);
  const plan = effectivePlan(subscription);
  const upgradable = upgradesAvailable();
  if (!plan) return quotaStatus({ plan: null, calls: [], now, upgradable });
  const since = new Date(now.getTime() - BILLING_CONFIG.windows.weeklyMs);
  const calls = await usageSince(userId, since);
  return quotaStatus({ plan, calls, now, upgradable });
}

/**
 * A quota refusal. Same ProviderError codes as before (so the runtime parks
 * a quota_exhausted stage and resumes it); additionally says which plan ran
 * out and whether upgrading would help, so the UI can offer waiting and
 * upgrading side by side.
 */
export class QuotaError extends ProviderError {
  constructor(
    message: string,
    code: "subscription_required" | "quota_exhausted",
    status: number,
    retryAfterMs: number | undefined,
    readonly plan: BillingPlan | null,
    readonly upgradeAvailable: boolean,
  ) {
    super(message, code, status, false, retryAfterMs);
  }
}

export function quotaError(status: QuotaStatus) {
  if (status.reason === "no_subscription")
    return new QuotaError(
      "An active subscription is required",
      "subscription_required",
      402,
      undefined,
      null,
      status.upgradeAvailable,
    );
  return new QuotaError(
    `Usage budget spent; available again at ${status.availableAt?.toISOString()}`,
    "quota_exhausted",
    429,
    status.retryAfterMs,
    status.plan,
    status.upgradeAvailable,
  );
}

/**
 * The free plan's model lock. Throws a non-retryable 403 ProviderError:
 * `model_not_in_plan` for a main or reviewer model outside the free plan,
 * `subagent_limit` for more sub-agents than the free plan allows. Fields
 * that are not given are not checked.
 *
 * Model calls are checked automatically by quotaGuardedProvider. The
 * sub-agent count is not visible there: whoever starts sub-agents for a
 * free user must call this with `subAgents` before starting them.
 */
export function assertFreePlanAllowed(
  request: { model?: string; subAgents?: number; reviewerModel?: string },
  limits: FreePlanLimits = BILLING_CONFIG.freePlanLimits,
) {
  const { model, subAgents, reviewerModel } = request;
  if (
    model !== undefined &&
    limits.allowedModels.length > 0 &&
    !limits.allowedModels.includes(model)
  )
    throw new ProviderError(
      `Model ${model} is not available on the free plan`,
      "model_not_in_plan",
      403,
    );
  if (reviewerModel !== undefined && reviewerModel !== limits.reviewerModel)
    throw new ProviderError(
      `Reviewer model ${reviewerModel} is not available on the free plan`,
      "model_not_in_plan",
      403,
    );
  if (
    subAgents !== undefined &&
    (!Number.isFinite(subAgents) || subAgents > limits.maxSubAgents)
  )
    throw new ProviderError(
      `The free plan allows at most ${limits.maxSubAgents} sub-agents`,
      "subagent_limit",
      403,
    );
}

/** VERIFY is the reviewer/checker role; every other role is a main model. */
function assertFreeModel(
  provider: ModelProvider,
  role: ModelRole,
  limits: FreePlanLimits,
) {
  const id = provider.modelId(role);
  // Verified free-pool models (:free) consume zero paid credit and are the
  // default unpinned pool in free-first mode. Curated Top NVIDIA models are
  // also permitted on the default product allowlist, and so is every model
  // the gateway reaches through NVIDIA (trial credits, no per-call price).
  if (id.endsWith(":free")) return;
  if (id.startsWith("nvidia:")) return;
  if (limits === BILLING_CONFIG.freePlanLimits && isNvidiaTopModelId(id)) {
    return;
  }
  assertFreePlanAllowed(
    role === "VERIFY" ? { reviewerModel: id } : { model: id },
    limits,
  );
}

export async function assertQuota(
  userId: string,
  check: (userId: string) => Promise<QuotaStatus> = quotaStatusFor,
): Promise<QuotaStatus> {
  const status = await check(userId);
  if (!status.allowed) throw quotaError(status);
  return status;
}

/**
 * Wraps a provider so stream/complete/structured first assert the user's
 * quota and, on the free plan, the free model lock for the call's role.
 * Everything else passes through unchanged.
 */
export function quotaGuardedProvider(
  provider: ModelProvider,
  userId: string,
  check: (userId: string) => Promise<QuotaStatus> = quotaStatusFor,
  limits: FreePlanLimits = BILLING_CONFIG.freePlanLimits,
): ModelProvider {
  const guard = async (role: ModelRole) => {
    // The operator's own sign-ins (OSIRUS_OWNER_EMAILS) are not metered.
    if (await isOwnerUser(userId)) return;
    const status = await assertQuota(userId, check);
    if (status.plan === "free") assertFreeModel(provider, role, limits);
  };
  return {
    async *stream(input) {
      await guard(input.role);
      yield* provider.stream(input);
    },
    async complete(input) {
      await guard(input.role);
      return provider.complete(input);
    },
    async structured(input) {
      await guard(input.role);
      return provider.structured(input);
    },
    modelId: (role) => provider.modelId(role),
    servedModel: provider.servedModel
      ? (requestId) => provider.servedModel?.(requestId)
      : undefined,
    capabilities: () => provider.capabilities(),
    healthCheck: () => provider.healthCheck(),
    cancel: (id) => provider.cancel(id),
    normalizeUsage: (raw) => provider.normalizeUsage(raw),
    normalizeError: (error) => provider.normalizeError(error),
  };
}
