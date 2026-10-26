import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  AgentStory,
  BotStory,
  WorkStory,
} from "@/components/marketing/stories";
import { OsirusMark } from "@/components/shell/osirus-mark";
import { auth } from "@/lib/auth/server";
import { isFreeTierEnabled, startAccountLabel } from "./free-tier";
import { absoluteUrl } from "./site-url";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Osirus — Assistent, Work und autonome Agents",
  description:
    "Osirus ist der präzise Workspace für KI-Assistenz, mehrstufige Work-Aufträge mit unabhängiger Prüfung und spezialisierte Agents über UNOROUTER und NVIDIA.",
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
      "Workspace für Assistent, Work und Agents mit unabhängiger Verifikation über UNOROUTER und NVIDIA.",
  };

  return (
    <main className="landing" lang="de">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <a className="skip-link" href="#inhalt">
        Zum Inhalt
      </a>
      <nav className="landing-nav" aria-label="Hauptnavigation">
        <span className="landing-brand">
          <OsirusMark />
          Osirus
        </span>
        <div className="landing-nav-links">
          <a href="#bots">Bots</a>
          <a href="#work">Work</a>
          <a href="#agents">Agents</a>
          <a href="#pruefung">Verifikation</a>
          <Link className="btn btn-ghost" href="/auth/sign-in">
            Anmelden
          </Link>
        </div>
      </nav>

      <div id="inhalt">
        <section className="landing-hero">
          <p className="landing-eyebrow">
            <span className="landing-dot" aria-hidden="true" />
            Intelligence Workspace
          </p>
          <h1>
            Bots, Work und <span className="landing-emphasis">Agents</span>
          </h1>
          <p className="landing-copy">
            Osirus verbindet fokussierte KI-Assistenz, orchestrierte
            Work-Aufträge mit getrenntem Prüfermodell und dauerhafte Agents in
            einer ruhigen, verifizierbaren Arbeitsumgebung. Modelle werden über
            UNOROUTER und NVIDIA angebunden; jede Aktion nach außen wartet auf
            deine explizite Freigabe.
            {freeTier
              ? " Zum Einstieg steht ein begrenztes kostenloses Kontingent bereit."
              : ""}
          </p>
          <div className="landing-actions">
            <Link className="btn btn-primary btn-lg" href="/auth/sign-up">
              {startLabel}
            </Link>
            <Link className="btn btn-secondary btn-lg" href="/auth/sign-in">
              Anmelden
            </Link>
          </div>
        </section>

        <section
          id="bots"
          className="landing-block"
          aria-labelledby="bots-title"
        >
          <div>
            <h2 id="bots-title">Bots</h2>
            <p>
              Direkter Dialog mit klarem Kontext, mehrstufigem Caching und
              präziser Modellwahl. Lege spezialisierte Bots mit festem Modell
              und eigener Systemanweisung an und bündele ihre Perspektiven.
            </p>
            <Link className="btn btn-secondary" href="/auth/sign-up">
              {startLabel}
            </Link>
          </div>
          <BotStory />
        </section>

        <section
          id="work"
          className="landing-block"
          aria-labelledby="work-title"
        >
          <div>
            <h2 id="work-title">Work</h2>
            <p>
              Für komplexe Vorhaben analysiert Osirus zuerst den Auftrag (Klasse
              S bis XL) und empfiehlt das optimale Ausführermodell, ein
              unabhängiges Prüfermodell sowie die passende Anzahl paralleler
              Sub-Agents. Alle Empfehlungen lassen sich vor dem Start gezielt
              anpassen.
            </p>
          </div>
          <WorkStory />
        </section>

        <section
          id="agents"
          className="landing-block"
          aria-labelledby="agents-title"
        >
          <div>
            <h2 id="agents-title">Agents</h2>
            <p>
              Definiere dauerhafte Rollen in deinem Workspace, kombiniere
              mehrere Spezialisten im Gruppenchat per @Erwähnung und nutze
              autonome Code- und Prüfschleifen, die Änderungen deterministisch
              gegen Tests und Sicherheitsregeln validieren.
            </p>
          </div>
          <AgentStory />
        </section>

        <section
          id="pruefung"
          className="landing-block landing-block-single"
          aria-labelledby="pruefung-title"
        >
          <div>
            <h2 id="pruefung-title">Unabhängiges Prüfsystem</h2>
            <p>
              Eine Modellantwort allein gilt in Osirus nie als Beleg. Ergebnisse
              werden durch deterministische Checks und ein vom Ausführer
              getrenntes Prüfermodell kontrolliert, während Schreibzugriffe auf
              verbundene Systeme zwingend deine Freigabe erfordern.
            </p>
          </div>
        </section>
      </div>

      <footer className="landing-footer">
        <Link href="/legal/impressum">Impressum</Link>
        <Link href="/legal/privacy">Datenschutz</Link>
        <Link href="/legal/terms">AGB</Link>
        <Link href="/legal/eula">EULA</Link>
        <Link href="/legal/cookies">Cookies</Link>
      </footer>
    </main>
  );
}
