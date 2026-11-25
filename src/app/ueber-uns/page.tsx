import type { Metadata } from "next";
import Link from "next/link";
import { RelatedPages } from "@/components/marketing/related-pages";
import { OPERATOR } from "../legal/operator";

export const metadata: Metadata = {
  title: "Über ClarityCompassAI und Osirus",
  description:
    "ClarityCompassAI aus Moers entwickelt Osirus: ein KI-Team für Chat, Aufgaben und Code, mit Freigabe vor jeder Aktion nach außen. Gegründet am 2. Januar 2025, eigenfinanziert.",
  alternates: { canonical: "/ueber-uns" },
};

export default function AboutPage() {
  return (
    <article className="legal-body" lang="de">
      <h1>Über ClarityCompassAI und Osirus</h1>
      <p className="security-lede">
        ClarityCompassAI entwickelt Osirus, ein KI-Team für Chat, Aufgaben und
        Code. Alles, was nach außen wirkt, wartet auf deine Freigabe.
      </p>

      <h2>Das Unternehmen</h2>
      <p>
        {OPERATOR.name} wurde am 2. Januar 2025 gegründet und hat seinen Sitz in
        Moers, Nordrhein-Westfalen. Inhaberin des Einzelunternehmens ist{" "}
        {OPERATOR.owner}.
      </p>
      <p>
        ClarityCompassAI ist eigenfinanziert – aus eigener Entscheidung. Die
        vollständige Anschrift und die gesetzlichen Angaben stehen im{" "}
        <Link href="/legal/impressum">Impressum</Link>.
      </p>

      <h2>Was Osirus macht</h2>
      <p>
        Osirus ist das Produkt von ClarityCompassAI: ein KI-Team, mit dem du
        schreibst, recherchierst und in Repositories arbeitest. Für jede Aufgabe
        wählt Osirus das passende Modell. Antworten aus dem Web tragen
        nummerierte Quellen. Bevor etwas in verbundenen Systemen geändert oder
        nach außen geschickt wird, hält Osirus an und wartet auf deinen Klick.
      </p>
      <ul>
        <li>
          <strong>Chat.</strong> PDFs, Tabellen und Code liest Osirus mit.
          Kürzere Fragen übernimmt ein schnelles Modell, schwere Aufgaben ein
          stärkeres.
        </li>
        <li>
          <strong>Bots.</strong> Spezialisten mit eigener Rolle und eigenem
          Gedächtnis; im Gruppenchat können mehrere zusammenarbeiten.
        </li>
        <li>
          <strong>Agent.</strong> Du gibst ein Ziel vor. Der Agent plant,
          recherchiert und arbeitet mit verbundenen Diensten; schreibende
          Schritte fragt er vorher ab.
        </li>
        <li>
          <strong>Code.</strong> Osirus liest ein Repository, ändert den Code,
          führt Tests aus und öffnet einen Pull Request zur Prüfung.
        </li>
      </ul>
      <p>
        Eine ausführlichere Beschreibung, was Osirus KI kann, steht auf der
        Seite <Link href="/osirus-ki">Osirus KI</Link>. Wie die Freigabe im
        Alltag greift, erklärt{" "}
        <Link href="/ki-team-freigabe">KI-Team mit Freigabeknopf</Link>.
      </p>

      <h2>Hosting in der EU</h2>
      <p>
        Anwendung und Datenbank laufen in Rechenzentren in Frankfurt am Main,
        also in der EU. Workspaces sind auf Datenbankebene voneinander getrennt.
        Details stehen unter{" "}
        <Link href="/sicherheit">Sicherheit und Datenschutz</Link>.
      </p>

      <RelatedPages current="/ueber-uns" />
    </article>
  );
}
