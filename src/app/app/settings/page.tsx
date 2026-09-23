import type { Metadata } from "next";
import { requireProductSession } from "@/lib/product/session";
import { signOut } from "../actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Account" };

export default async function AccountSettings() {
  const { user } = await requireProductSession();
  return (
    <section className="card settings-group" aria-labelledby="account-heading">
      <h2 id="account-heading">Account</h2>
      <dl className="settings-rows">
        <div>
          <dt>Name</dt>
          <dd>{user.name ?? "Not set"}</dd>
        </div>
        <div>
          <dt>Email</dt>
          <dd>{user.email ?? "Not set"}</dd>
        </div>
        <div>
          <dt>Sign-in</dt>
          <dd>Managed by Neon Auth (email or GitHub)</dd>
        </div>
      </dl>
      <form action={signOut}>
        <button type="submit" className="btn btn-secondary">
          Sign out
        </button>
      </form>
    </section>
  );
}
