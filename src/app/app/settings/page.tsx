import Link from "next/link";
import { redirect } from "next/navigation";
import { bootstrapProductIdentity } from "@/lib/auth/bootstrap";
import { auth, requireAuthConfiguration } from "@/lib/auth/server";
import { signOut } from "../actions";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  requireAuthConfiguration();
  const { data: session } = await auth.getSession();
  if (!session?.user) redirect("/auth/sign-in");
  const identity = await bootstrapProductIdentity({
    id: session.user.id,
    email: session.user.email,
    name: session.user.name,
  });

  return (
    <main className="settings-page">
      <section className="settings-card">
        <p className="eyebrow">ACCOUNT</p>
        <h1>Workspace settings</h1>
        <p className="muted">
          Signed in as {session.user.email ?? "your managed account"}.
        </p>
        <dl>
          <div>
            <dt>Workspace</dt>
            <dd>{identity.workspaceName}</dd>
          </div>
          <div>
            <dt>Session security</dt>
            <dd>Managed by Neon Auth</dd>
          </div>
        </dl>
        <div className="settings-actions">
          <Link href="/app">Back to ChatHub</Link>
          <form action={signOut}>
            <button type="submit">Sign out</button>
          </form>
        </div>
      </section>
    </main>
  );
}
