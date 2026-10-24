import { quotaEnforced, quotaStatusFor } from "@/lib/billing/enforce";
import { serializeQuota } from "@/lib/billing/quota";
import { currentSubscription } from "@/lib/billing/store";
import { apiIdentity, json } from "@/lib/product/api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * The signed-in user's plan and, per window (5 hours, 7 days), the budget,
 * what is spent, what remains and when it refills. Amounts are EUR.
 */
export async function GET() {
  const identity = await apiIdentity();
  if (!identity) return json({ error: "unauthorized" }, 401);
  const [status, subscription] = await Promise.all([
    quotaStatusFor(identity.userId),
    currentSubscription(identity.userId),
  ]);
  return json({
    enforced: quotaEnforced(),
    subscription: subscription
      ? {
          plan: subscription.plan,
          status: subscription.status,
          currentPeriodEnd: subscription.current_period_end
            ? new Date(subscription.current_period_end).toISOString()
            : null,
          cancelAtPeriodEnd: subscription.cancel_at_period_end,
        }
      : null,
    ...serializeQuota(status),
  });
}
