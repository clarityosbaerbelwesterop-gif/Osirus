import "server-only";
import { BILLING_CONFIG } from "@/lib/billing/config";
import { quotaEnforced, quotaStatusFor } from "@/lib/billing/enforce";
import type { QuotaStatus } from "@/lib/billing/quota";
import type { GatewayModel } from "./models";
import { ownerEmailList } from "./owners";

// Who may call which gateway model.
// - Owner emails (OSIRUS_OWNER_EMAILS): every listed model, no usage windows.
//   These are the operator's own keys.
// - Paid plan: every listed model within the plan's windows.
// - Free plan: free models (":free", zero-priced, NVIDIA trial credits) and
//   the free plan's allowed ids, within the free windows.

/** An owner sign-in: listed in OSIRUS_OWNER_EMAILS and not unconfirmed. */
export function isOwnerEmail(
  email: string | null | undefined,
  emailVerified?: boolean,
) {
  if (!email || emailVerified === false) return false;
  return ownerEmailList().includes(email.trim().toLowerCase());
}

export type ModelAccess = {
  unlimited: boolean;
  /** Only free models may be called. */
  freeOnly: boolean;
  /** Null when quotas are off or the person is an owner. */
  quota: QuotaStatus | null;
};

export async function modelAccessFor(user: {
  userId: string;
  email: string | null;
  emailVerified?: boolean;
}): Promise<ModelAccess> {
  if (isOwnerEmail(user.email, user.emailVerified)) {
    return { unlimited: true, freeOnly: false, quota: null };
  }
  if (!quotaEnforced())
    return { unlimited: false, freeOnly: false, quota: null };
  const quota = await quotaStatusFor(user.userId);
  return { unlimited: false, freeOnly: quota.plan === "free", quota };
}

export function modelAllowed(model: GatewayModel, access: ModelAccess) {
  if (access.unlimited || !access.freeOnly) return true;
  return (
    model.free || BILLING_CONFIG.freePlanLimits.allowedModels.includes(model.id)
  );
}
