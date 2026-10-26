import type { Metadata } from "next";
import { PlanSection } from "@/components/settings/plan-offer";
import { ProfileName } from "@/components/settings/profile-name";
import { ReplayTour } from "@/components/settings/replay-tour";
import { isFreeTierEnabled } from "@/app/free-tier";
import { requireProductSession } from "@/lib/product/session";
import { signOut } from "../actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Account" };

export default async function AccountSettings() {
  const { user } = await requireProductSession();
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
      <PlanSection freeTier={isFreeTierEnabled()} />
    </>
  );
}
