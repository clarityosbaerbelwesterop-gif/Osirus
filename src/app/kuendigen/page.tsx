import type { Metadata } from "next";
import Link from "next/link";
import { CancelForm } from "@/components/cancellation/cancel-form";
import { berlinDay } from "@/lib/cancellation/rules";
import { loadAuthUser } from "@/lib/product/session";
import { OPERATOR } from "../legal/operator";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Verträge hier kündigen",
  description:
    "Kündige dein Osirus-Abonnement oder dein kostenloses Konto direkt online, ohne Anmeldung. Du erhältst sofort eine Bestätigung mit Datum und Uhrzeit.",
  alternates: { canonical: "/kuendigen" },
};

/** The cancellation page (§ 312k BGB): reachable without an account. */
export default async function CancelPage() {
  const user = await loadAuthUser().catch(() => null);
  return (
    <article className="legal-body cancel-page" lang="de">
      <h1>Verträge hier kündigen</h1>
      <p>
        Hier kündigst du dein Osirus-Abonnement oder dein kostenloses Konto.
        Eine Anmeldung brauchst du dafür nicht. Nach dem Absenden erhältst du
        sofort eine Bestätigung mit Datum und Uhrzeit, die du speichern kannst,
        und dieselbe Bestätigung per E-Mail.
      </p>
      <p>
        Ein Abonnement endet zum Ende der laufenden Abrechnungsperiode. Bis
        dahin nutzt du deinen Plan wie gewohnt, danach gilt wieder das
        kostenlose Kontingent; dein Konto und deine Inhalte bleiben erhalten.
        Einzelheiten stehen in § 11 der <Link href="/legal/terms">AGB</Link>.
      </p>
      <CancelForm
        defaults={{
          name: user?.name ?? "",
          email: user?.email ?? "",
          signedIn: Boolean(user),
        }}
        today={berlinDay(new Date())}
        supportEmail={OPERATOR.email}
      />
      <p className="cancel-alt">
        Du kannst auch per E-Mail an{" "}
        <a href={`mailto:${OPERATOR.email}`}>{OPERATOR.email}</a> oder
        schriftlich an {OPERATOR.name}, {OPERATOR.street}, {OPERATOR.city}{" "}
        kündigen.
      </p>
    </article>
  );
}
