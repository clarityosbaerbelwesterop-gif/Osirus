import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  AgentStory,
  BotStory,
  WorkStory,
} from "@/components/marketing/stories";
import { PLANS, PRICE_TAX_NOTE } from "@/components/marketing/plans";
import { PLACEHOLDER_QUOTA, QuotaBars } from "@/components/motion/quota-bars";
import { OsirusMark } from "@/components/shell/osirus-mark";
import { auth } from "@/lib/auth/server";
import { absoluteUrl } from "./site-url";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Osirus — Bots, Work und Agents",
  description:
    "Osirus ist ein Workspace für Assistent, Work und Agents. Modelle laufen über UNOROUTER. Abos: Pro, Developer, Ultra 100 und Ultra 200.",
  alternates: { canonical: "/" },
};

const FAQ = [
  {
    q: "Was ist heute nutzbar?",
    a: "Du kannst ein Konto anlegen und mit dem Assistenten arbeiten. Aktionen nach außen warten auf deine Freigabe. Eigene Bots, Deploy, Gruppenchats und die Empfehlung aus Modell, Prüfer und Sub-Agents sind bald verfügbar.",
  },
  {
    q: "Welche Modelle gibt es?",
    a: "Aufrufe laufen über UNOROUTER. Eine auswählbare Modellliste ist bald verfügbar. Eigene Modelle werden nicht angeboten.",
  },
  {
    q: "Was kosten die Abos?",
    a: `Pro 20 €, Developer 50 €, Ultra 100 100 € und Ultra 200 200 € pro Monat, als Endpreise. ${PRICE_TAX_NOTE} Die Buchung ist bald verfügbar. Einen Tarif ohne Entgelt gibt es nicht.`,
  },
  {
    q: "Was passiert, wenn das Kontingent leer ist?",
    a: "Jedes Abo hat ein 5-Stunden-Fenster und ein Wochenfenster. Ist ein Fenster aufgebraucht, wartest du, bis es sich füllt. Zusätzliches Guthaben kann nicht gekauft werden. Konkrete Mengen sind noch nicht veröffentlicht.",
  },
  {
    q: "Prüft Osirus jede Antwort?",
    a: "Nein. Eine Modellantwort allein ist kein Beleg. Ein getrenntes Prüfermodell ist bald verfügbar.",
  },
] as const;

export default async function HomePage() {
  const { data: session } = await auth
    .getSession()
    .catch(() => ({ data: null }));
  if (session?.user) redirect("/app");

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "Osirus",
    applicationCategory: "BusinessApplication",
    operatingSystem: "Web",
    url: absoluteUrl("/"),
    description:
      "Workspace für Assistent, Work und Agents. Modelle über UNOROUTER.",
    offers: PLANS.map((plan) => ({
      "@type": "Offer",
      name: plan.name,
      price: plan.price.replace(" €", ""),
      priceCurrency: "EUR",
    })),
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
          <a href="#preise">Preise</a>
          <Link className="btn btn-ghost" href="/auth/sign-in">
            Anmelden
          </Link>
        </div>
      </nav>

      <div id="inhalt">
        <section className="landing-hero">
          <p className="landing-eyebrow">
            <span className="landing-dot" aria-hidden="true" />
            Workspace
          </p>
          <h1>
            Bots, Work und <span className="landing-emphasis">Agents</span>
          </h1>
          <p className="landing-copy">
            Osirus ist der Workspace für einen Assistenten, für größere Aufträge
            und für eigene Agents. Modelle laufen über UNOROUTER. Aktionen nach
            außen warten auf deine Freigabe.
          </p>
          <div className="landing-actions">
            <Link className="btn btn-primary btn-lg" href="/auth/sign-up">
              Konto erstellen
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
              Ein Gespräch mit dem Assistenten gibt es heute. Eigene Bots
              anlegen, pro Bot ein Modell wählen, deployen und sie in einem
              Gruppenchat zusammenbringen, ist bald verfügbar.
            </p>
            <Link className="btn btn-secondary" href="/auth/sign-up">
              Konto erstellen
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
              Zuerst kommt der Auftrag. Danach sollen Modell, Prüfermodell und
              die Anzahl der Sub-Agents erscheinen, jeweils mit dem Hinweis
              Empfohlen. Diese Auswahl ist bald verfügbar. Du kannst die
              Vorschläge später überschreiben.
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
              Agents sind dauerhafte Rollen. Anlegen, Deploy und Gruppenchat
              sind bald verfügbar.
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
            <h2 id="pruefung-title">Prüfsystem</h2>
            <p>
              Eine Modellantwort allein ist kein Beleg. Ein Prüfer, der vom
              ausführenden Modell getrennt ist, ist bald verfügbar. Was schon
              gilt: eine Aktion nach außen wartet auf dein Ja.
            </p>
          </div>
        </section>

        <section
          id="preise"
          className="landing-prices"
          aria-labelledby="preise-title"
        >
          <h2 id="preise-title">Preise</h2>
          <p className="landing-copy">
            Endpreise in Euro pro Monat. {PRICE_TAX_NOTE} Die Abrechnung läuft
            über Stripe, sobald die Buchung verfügbar ist.
          </p>
          <ul className="price-grid">
            {PLANS.map((plan) => (
              <li key={plan.id} className="price-card">
                <h3>{plan.name}</h3>
                <p className="price-amount">
                  {plan.price} <span>/ Monat</span>
                </p>
                <p>5-Stunden- und Wochenkontingent. Mengen: bald verfügbar.</p>
                <Link className="btn btn-primary" href={plan.href}>
                  Mit {plan.name} registrieren
                </Link>
              </li>
            ))}
          </ul>
          <QuotaBars
            fiveHourRatio={PLACEHOLDER_QUOTA.fiveHourRatio}
            weekRatio={PLACEHOLDER_QUOTA.weekRatio}
            fiveHourRefill={PLACEHOLDER_QUOTA.fiveHourRefill}
            note={PLACEHOLDER_QUOTA.note}
          />
        </section>

        <section id="faq" className="landing-faq" aria-labelledby="faq-title">
          <h2 id="faq-title">Fragen</h2>
          {FAQ.map((item) => (
            <details key={item.q}>
              <summary>{item.q}</summary>
              <p>{item.a}</p>
            </details>
          ))}
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
