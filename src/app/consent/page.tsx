import Link from "next/link";
import { redirect } from "next/navigation";
import { OsirusMark } from "@/components/shell/osirus-mark";
import { ensureOsirusUser } from "@/lib/auth/bootstrap";
import { consentIsCurrent } from "@/lib/legal/store";
import { LEGAL_VERSIONS } from "@/lib/legal/versions";
import { loadAuthUser } from "@/lib/product/session";
import { ConsentForm } from "./consent-form";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Zustimmung",
  robots: { index: false, follow: false },
};

export default async function ConsentPage() {
  const authUser = await loadAuthUser();
  if (!authUser) redirect("/auth/sign-in");
  await ensureOsirusUser(authUser);
  if (await consentIsCurrent(authUser.id)) redirect("/app");
  return (
    <main className="auth-page">
      <section className="auth-card">
        <p className="auth-brand">
          <OsirusMark size={24} />
          Osirus
        </p>
        <h1>Zustimmung</h1>
        <p className="auth-lede">
          Bevor du Osirus nutzt, bestätigst du die aktuellen Texte. Jedes
          Häkchen gilt nur für die genannte Fassung und ist nicht vorausgewählt.
        </p>
        <ConsentForm versions={LEGAL_VERSIONS} />
        <p className="auth-footer">
          <Link href="/legal/terms">AGB</Link>
          {" · "}
          <Link href="/legal/privacy">Datenschutz</Link>
        </p>
      </section>
    </main>
  );
}
