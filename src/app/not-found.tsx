import Link from "next/link";
import { OsirusMark } from "@/components/shell/osirus-mark";

export default function NotFound() {
  return (
    <main className="status-page" lang="de">
      <section className="status-card status-rise">
        <p className="auth-brand">
          <OsirusMark size={28} />
          Osirus
        </p>
        <p className="overline">404</p>
        <h1>Diese Seite gibt es nicht</h1>
        <p>
          Der Pfad ist unbekannt. Zurück zur Startseite oder zu den
          Rechtstexten.
        </p>
        <div className="status-links">
          <Link className="btn btn-primary" href="/">
            Zur Startseite
          </Link>
          <Link className="btn btn-secondary" href="/auth/sign-up">
            Konto erstellen
          </Link>
          <Link href="/legal/impressum">Impressum</Link>
          <Link href="/legal/privacy">Datenschutz</Link>
          <Link href="/legal/terms">AGB</Link>
          <Link href="/kuendigen">Verträge hier kündigen</Link>
        </div>
      </section>
    </main>
  );
}
