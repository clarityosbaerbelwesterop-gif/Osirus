import type { Metadata } from "next";
import Link from "next/link";
import { RelatedPages } from "@/components/marketing/related-pages";

export const metadata: Metadata = {
  title: "KI-Team mit Freigabeknopf – so arbeitet Osirus",
  description:
    "Ein KI-Team mit Freigabeknopf heißt: Osirus plant und prüft selbst, aber jede Aktion nach außen wartet auf deinen Klick. So bleibt die Kontrolle bei dir, ohne dass du jeden Schritt selbst ausführen musst.",
  alternates: { canonical: "/ki-team-freigabe" },
};

export default function ApprovalTeamPage() {
  return (
    <article className="legal-body" lang="de">
      <h1>KI-Team mit Freigabeknopf</h1>
      <p className="security-lede">
        Osirus darf vorbereiten, prüfen und vorschlagen. Sobald etwas in einem
        verbundenen System geändert oder nach außen geschickt werden soll,
        bleibt die Wirkung aus, bis du freigibst oder ablehnst.
      </p>

      <h2>Warum der Freigabeknopf da ist</h2>
      <p>
        Ein KI-Team ist nützlich, wenn es Arbeit abnimmt – und riskant, wenn es
        ungesehen Mails schickt, Dateien überschreibt oder einen Pull Request
        öffnet, den niemand angesehen hat. Osirus trennt deshalb zwei Dinge:
        das, was es intern tun darf, und das, was nach außen wirkt.
      </p>
      <p>
        Intern heißt: lesen, zerlegen, einen Plan machen, eine Antwort
        formulieren, Code in einer abgeschotteten Sandbox ausführen. Nach außen
        heißt: Schreibzugriff auf verbundene Systeme, etwa GitHub, Datenbanken
        oder eigene MCP-Server. Dieser zweite Schritt wartet auf dich.
      </p>

      <h2>Der Ablauf in drei Schritten</h2>
      <ol>
        <li>
          <strong>Plan.</strong> Osirus zerlegt die Aufgabe und wählt das
          Modell, das zu ihr passt.
        </li>
        <li>
          <strong>Prüfung.</strong> Deterministische Checks und ein vom
          Ausführer getrenntes Prüfermodell kontrollieren das Ergebnis.
        </li>
        <li>
          <strong>Freigabe.</strong> Jeder Schreibzugriff auf verbundene Systeme
          wartet auf deinen Klick. Du siehst, was passieren würde, und kannst
          freigeben oder ablehnen.
        </li>
      </ol>
      <p>
        Die Freigabe ist kein feiner Hinweis, der verschwindet, wenn du das
        Fenster schließt. Die Aktion bleibt liegen, bis jemand entscheidet. Jede
        Entscheidung wird mit Zeitpunkt festgehalten.
      </p>

      <h2>Was das im Alltag ändert</h2>
      <p>
        Du musst Osirus nicht bei jeder Kleinigkeit über die Schulter schauen.
        Du entscheidest an der Stelle, an der eine Wirkung entsteht: bevor etwas
        geschrieben, gesendet oder veröffentlicht wird. Genau das ist mit
        „KI-Team mit Freigabeknopf“ gemeint.
      </p>
      <p>
        Technische Hintergründe – Hosting in Frankfurt, getrennte Workspaces,
        Protokollierung – stehen unter{" "}
        <Link href="/sicherheit">Sicherheit und Datenschutz</Link>. Was Osirus
        KI darüber hinaus kann, steht unter{" "}
        <Link href="/osirus-ki">Osirus KI</Link>. Wer dahintersteckt, steht
        unter <Link href="/ueber-uns">Über ClarityCompassAI</Link>.
      </p>

      <RelatedPages current="/ki-team-freigabe" />
    </article>
  );
}
