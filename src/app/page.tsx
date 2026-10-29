import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import "@fontsource-variable/geist";
import "@fontsource-variable/geist-mono";
import { ProductFrame } from "@/components/marketing/product-frame";
import { OsirusMark } from "@/components/shell/osirus-mark";
import { auth } from "@/lib/auth/server";
import { isFreeTierEnabled, startAccountLabel } from "./free-tier";
import { absoluteUrl } from "./site-url";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Osirus — Dein KI-Team mit Freigabeknopf",
  description:
    "Osirus antwortet mit Quellen, erledigt Aufgaben selbstständig und arbeitet in deinen Repositories. Das passende Modell wählt Osirus selbst; alles, was nach außen wirkt, wartet auf deine Freigabe. Gehostet in der EU.",
  alternates: { canonical: "/" },
};

export default async function HomePage() {
  const { data: session } = await auth
    .getSession()
    .catch(() => ({ data: null }));
  if (session?.user) redirect("/app");
  const startLabel = startAccountLabel();
  const freeTier = isFreeTierEnabled();

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "Osirus",
    applicationCategory: "BusinessApplication",
    operatingSystem: "Web",
    url: absoluteUrl("/"),
    description:
      "KI-Team für Chat, autonome Aufgaben und Code, mit Freigabe vor jeder Aktion nach außen.",
  };

  return (
    <main className="ln" lang="de">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <a className="skip-link" href="#inhalt">
        Zum Inhalt
      </a>
      <header className="ln-wrap ln-header">
        <Link href="/" className="ln-brand">
          <OsirusMark />
          Osirus
        </Link>
        <nav className="ln-nav" aria-label="Hauptnavigation">
          <a className="ln-nav-section" href="#was">
            Produkt
          </a>
          <a className="ln-nav-section" href="#bots">
            Bots
          </a>
          <Link className="ln-nav-section" href="/sicherheit">
            Sicherheit
          </Link>
          <Link className="ln-nav-login" href="/auth/sign-in">
            Anmelden
          </Link>
          <Link className="ln-pill ln-pill-light" href="/auth/sign-up">
            {startLabel}
          </Link>
        </nav>
      </header>

      <div id="inhalt">
        <section className="ln-wrap ln-hero" aria-labelledby="hero-title">
          <p className="ln-overline">Gehostet in Frankfurt · EU</p>
          <h1 id="hero-title" className="ln-display">
            Dein KI-Team mit <span className="ln-accent">Freigabeknopf</span>.
          </h1>
          <div className="ln-hero-foot">
            <p className="ln-lede">
              Osirus antwortet mit Quellen, erledigt Aufgaben selbstständig und
              arbeitet in deinen Repositories. Für jede Aufgabe wählt es das
              passende Modell; alles, was nach außen wirkt, wartet auf deine
              Freigabe.
              {freeTier
                ? " Zum Einstieg steht ein begrenztes kostenloses Kontingent bereit."
                : ""}
            </p>
            <div className="ln-actions">
              <Link
                className="ln-pill ln-pill-light ln-pill-lg"
                href="/auth/sign-up"
              >
                {startLabel}
              </Link>
              <Link
                className="ln-pill ln-pill-line ln-pill-lg"
                href="/auth/sign-in"
              >
                Anmelden
              </Link>
            </div>
          </div>
        </section>

        <section
          className="ln-wrap ln-frame-wrap"
          aria-label="So arbeitet Osirus"
        >
          <ProductFrame />
        </section>

        <section
          className="ln-wrap ln-index"
          id="was"
          aria-labelledby="was-title"
        >
          <h2 id="was-title" className="ln-overline">
            Was Osirus macht
          </h2>
          <ol className="ln-list">
            <li id="chat">
              <span className="ln-num" aria-hidden="true">
                01
              </span>
              <h3>Chat</h3>
              <p>
                Schreib einfach los. Für Kurzes nimmt Osirus ein schnelles
                Modell, für Schweres ein Top-Modell; PDFs, Tabellen und Code
                liest es mit, und Antworten aus dem Web tragen nummerierte
                Quellen.
              </p>
            </li>
            <li id="bots">
              <span className="ln-num" aria-hidden="true">
                02
              </span>
              <h3>Bots</h3>
              <p>
                Dein Team aus Spezialisten. Jeder Bot hat eine Rolle, einen
                eigenen Raum und erinnert sich an eure Unterhaltungen; im
                Gruppenchat arbeiten mehrere zusammen.
              </p>
            </li>
            <li id="agent">
              <span className="ln-num" aria-hidden="true">
                03
              </span>
              <h3>Agent</h3>
              <p>
                Ziele statt Prompts. Der Agent plant, recherchiert und arbeitet
                mit GitHub, Datenbanken oder eigenen MCP-Servern; vor jedem
                schreibenden Schritt fragt er dich.
              </p>
            </li>
            <li id="code">
              <span className="ln-num" aria-hidden="true">
                04
              </span>
              <h3>Code</h3>
              <p>
                Vom Auftrag zum Pull Request. Osirus liest dein Repository,
                ändert den Code, führt die Tests aus und öffnet einen Pull
                Request zur Prüfung.
              </p>
            </li>
          </ol>
        </section>

        <section
          className="ln-wrap ln-proof"
          id="pruefung"
          aria-labelledby="pruefung-title"
        >
          <h2 id="pruefung-title" className="ln-statement">
            Nichts verlässt Osirus ohne dein OK.
          </h2>
          <ol className="ln-steps">
            <li>
              <span className="ln-step">01 · Plan</span>
              <p>
                Osirus zerlegt die Aufgabe und wählt das Modell, das zu ihr
                passt.
              </p>
            </li>
            <li>
              <span className="ln-step">02 · Prüfung</span>
              <p>
                Deterministische Checks und ein vom Ausführer getrenntes
                Prüfermodell kontrollieren das Ergebnis.
              </p>
            </li>
            <li>
              <span className="ln-step">03 · Freigabe</span>
              <p>
                Jeder Schreibzugriff auf verbundene Systeme wartet auf deinen
                Klick.
              </p>
            </li>
          </ol>
          <p className="ln-facts">
            Daten in Frankfurt · Jeder Workspace auf Datenbankebene getrennt ·{" "}
            <Link href="/sicherheit">Sicherheit im Detail</Link>
          </p>
        </section>

        <section className="ln-wrap ln-close" aria-labelledby="start-title">
          <h2 id="start-title" className="ln-statement">
            Fang mit einer
            <br />
            Frage an.
          </h2>
          <Link
            className="ln-pill ln-pill-light ln-pill-lg"
            href="/auth/sign-up"
          >
            {startLabel}
          </Link>
        </section>
      </div>

      <footer className="ln-wrap ln-footer">
        <Link href="/legal/impressum">Impressum</Link>
        <Link href="/legal/privacy">Datenschutz</Link>
        <Link href="/legal/terms">AGB</Link>
        <Link href="/legal/eula">EULA</Link>
        <Link href="/legal/cookies">Cookies</Link>
        <Link href="/sicherheit">Sicherheit</Link>
        <Link href="/kuendigen">Verträge hier kündigen</Link>
      </footer>
    </main>
  );
}
