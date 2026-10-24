import "server-only";
import type { ModelProvider } from "../models/provider";
import { ProviderError } from "../models/unorouter";
import { env } from "../env";
import { BILLING_CONFIG } from "./config";
import { effectivePlan, quotaStatus, type QuotaStatus } from "./quota";
import { currentSubscription, usageSince } from "./store";

// Server-side quota enforcement. Every model call made for a user goes
// through quotaGuardedProvider, which checks the user's 5-hour and weekly
// budgets before the call. A spent window throws a transient ProviderError
// (quota_exhausted) carrying the time until it refills, so the runtime parks
// the stage and resumes it on its own -- the user waits, nothing is banned.

/**
 * Quotas are enforced once billing is configured (STRIPE_SECRET_KEY set), so
 * a deployment without Stripe keeps working instead of refusing every call.
 * BILLING_CONFIG.enforceQuotas can force it off.
 */
export function quotaEnforced() {
  return BILLING_CONFIG.enforceQuotas && Boolean(env.STRIPE_SECRET_KEY);
}

/** The provider for a user's product run: quota-guarded when enforced. */
export function forUser(provider: ModelProvider, userId: string) {
  return quotaEnforced() ? quotaGuardedProvider(provider, userId) : provider;
}

export async function quotaStatusFor(
  userId: string,
  now = new Date(),
): Promise<QuotaStatus> {
  const subscription = await currentSubscription(userId);
  const plan = effectivePlan(subscription);
  if (!plan) return quotaStatus({ plan: null, calls: [], now });
  const since = new Date(now.getTime() - BILLING_CONFIG.windows.weeklyMs);
  const calls = await usageSince(userId, since);
  return quotaStatus({ plan, calls, now });
}

export function quotaError(status: QuotaStatus) {
  if (status.reason === "no_subscription")
    return new ProviderError(
      "An active subscription is required",
      "subscription_required",
      402,
    );
  return new ProviderError(
    `Usage budget spent; available again at ${status.availableAt?.toISOString()}`,
    "quota_exhausted",
    429,
    false,
    status.retryAfterMs,
  );
}

export async function assertQuota(
  userId: string,
  check: (userId: string) => Promise<QuotaStatus> = quotaStatusFor,
) {
  const status = await check(userId);
  if (!status.allowed) throw quotaError(status);
  return status;
}

/**
 * Wraps a provider so stream/complete/structured first assert the user's
 * quota. Everything else passes through unchanged.
 */
export function quotaGuardedProvider(
  provider: ModelProvider,
  userId: string,
  check: (userId: string) => Promise<QuotaStatus> = quotaStatusFor,
): ModelProvider {
  return {
    async *stream(input) {
      await assertQuota(userId, check);
      yield* provider.stream(input);
    },
    async complete(input) {
      await assertQuota(userId, check);
      return provider.complete(input);
    },
    async structured(input) {
      await assertQuota(userId, check);
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
