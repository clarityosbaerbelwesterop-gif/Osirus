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
          <a href="#chat">Chat</a>
          <a href="#agent">Agent</a>
          <a href="#code">Code</a>
          <Link href="/sicherheit">Sicherheit</Link>
          <Link className="btn btn-ghost" href="/auth/sign-in">
            Anmelden
          </Link>
        </div>
      </nav>

      <div id="inhalt">
        <section className="landing-hero">
          <p className="landing-eyebrow">
            <span className="landing-dot" aria-hidden="true" />
            Gehostet in der EU
          </p>
          <h1>
            Dein KI-Team mit{" "}
            <span className="landing-emphasis">Freigabeknopf</span>
          </h1>
          <p className="landing-copy">
            Osirus antwortet mit Quellen, erledigt Aufgaben selbstständig und
            arbeitet in deinen Repositories. Für jede Aufgabe wählt es das
            passende Modell; alles, was nach außen wirkt, wartet auf deine
            Freigabe.
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
          id="chat"
          className="landing-block"
          aria-labelledby="chat-title"
        >
          <div>
            <h2 id="chat-title">Chat: fragen, anhängen, belegen</h2>
            <p>
              Schreib einfach los, wie in einem Chat. Osirus nimmt für Kurzes
              ein schnelles Modell und für Schweres ein Top-Modell, liest
              angehängte PDFs, Tabellen und Code und belegt Antworten aus dem
              Web mit nummerierten Quellen. Eigene Bots mit fester Rolle
              arbeiten mit einem Modell, das zu ihrer Aufgabe passt.
            </p>
            <Link className="btn btn-secondary" href="/auth/sign-up">
              {startLabel}
            </Link>
          </div>
          <BotStory />
        </section>

        <section
          id="agent"
          className="landing-block"
          aria-labelledby="agent-title"
        >
          <div>
            <h2 id="agent-title">Agent: Aufgaben statt Prompts</h2>
            <p>
              Gib ein Ziel, keine Anleitung. Der Agent plant, recherchiert und
              arbeitet mit deinen verbundenen Werkzeugen wie GitHub, Datenbanken
              oder eigenen MCP-Servern. Ein getrenntes Prüfermodell kontrolliert
              das Ergebnis, und vor jedem schreibenden Schritt fragt er dich.
            </p>
          </div>
          <WorkStory />
        </section>

        <section
          id="code"
          className="landing-block"
          aria-labelledby="code-title"
        >
          <div>
            <h2 id="code-title">Code: vom Auftrag zum Pull Request</h2>
            <p>
              Verbinde GitHub, wähle ein Repository und beschreibe, was sich
              ändern soll. Osirus liest den Code, ändert ihn, führt die Tests
              aus und öffnet einen Pull Request zur Prüfung. Hier wählst du das
              Modell auch selbst.
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
              verbundene Systeme zwingend deine Freigabe erfordern. Deine Daten
              liegen in Frankfurt, jeder Workspace ist auf Datenbankebene
              getrennt.
            </p>
            <Link className="btn btn-secondary" href="/sicherheit">
              Sicherheit im Detail
            </Link>
          </div>
        </section>
      </div>

      <footer className="landing-footer">
        <Link href="/legal/impressum">Impressum</Link>
        <Link href="/legal/privacy">Datenschutz</Link>
        <Link href="/legal/terms">AGB</Link>
        <Link href="/legal/eula">EULA</Link>
        <Link href="/legal/cookies">Cookies</Link>
        <Link href="/sicherheit">Sicherheit</Link>
      </footer>
    </main>
  );
}
