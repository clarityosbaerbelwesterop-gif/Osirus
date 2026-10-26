import type { Metadata } from "next";
import {
  PlanSection,
  type CurrentPlanInfo,
} from "@/components/settings/plan-offer";
import { ProfileName } from "@/components/settings/profile-name";
import { ReplayTour } from "@/components/settings/replay-tour";
import { BILLING_CONFIG } from "@/lib/billing/config";
import { effectivePlan } from "@/lib/billing/quota";
import { currentSubscription, customerIdFor } from "@/lib/billing/store";
import { requireProductSession } from "@/lib/product/session";
import { signOut } from "../actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Account" };

export default async function AccountSettings() {
  const { user } = await requireProductSession();
  const [subscription, customer] = await Promise.all([
    currentSubscription(user.id).catch(() => null),
    customerIdFor(user.id).catch(() => null),
  ]);
  const plan = effectivePlan(subscription);
  const current: CurrentPlanInfo = {
    label: plan ? BILLING_CONFIG.plans[plan].label : null,
    status: subscription?.status ?? null,
    periodEnd: subscription?.current_period_end
      ? new Date(subscription.current_period_end).toISOString()
      : null,
    cancelAtPeriodEnd: Boolean(subscription?.cancel_at_period_end),
    trialEligible: !subscription,
    canManage: Boolean(customer && subscription),
  };
  return (
    <>
      <section
        className="card settings-group"
        aria-labelledby="account-heading"
      >
        <h2 id="account-heading">Account</h2>
        <dl className="settings-rows">
          <div>
            <dt>Name</dt>
            <dd>
              <ProfileName name={user.name} />
            </dd>
          </div>
          <div>
            <dt>E-Mail</dt>
            <dd>{user.email ?? "Nicht gesetzt"}</dd>
          </div>
          <div>
            <dt>Anmeldung</dt>
            <dd>E-Mail oder GitHub</dd>
          </div>
        </dl>
        <div className="settings-actions">
          <ReplayTour />
          <form action={signOut}>
            <button type="submit" className="btn btn-secondary">
              Abmelden
            </button>
          </form>
        </div>
      </section>
      <PlanSection current={current} />
    </>
  );
}
