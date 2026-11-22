import type { Metadata } from "next";
import Link from "next/link";
import { RelatedPages } from "@/components/marketing/related-pages";

export const metadata: Metadata = {
  title: "Osirus KI – Chat, Aufgaben und Code mit Freigabe",
  description:
    "Osirus KI ist das KI-Team von ClarityCompassAI: Chat mit Quellen, autonome Aufgaben und Arbeit an Repositories. Das Modell wählt Osirus selbst; jede Aktion nach außen braucht deine Freigabe. Gehostet in der EU.",
  alternates: { canonical: "/osirus-ki" },
};

export default function OsirusKiPage() {
  return (
    <article className="legal-body" lang="de">
      <h1>Osirus KI</h1>
      <p className="security-lede">
        Osirus KI ist kein einzelnes Chatfenster, sondern ein Team: Es antwortet
        mit Quellen, erledigt Aufgaben und arbeitet in deinen Repositories – und
        bleibt stehen, bevor etwas nach außen wirkt.
      </p>

      <h2>Was Osirus KI von einem gewöhnlichen Chat unterscheidet</h2>
      <p>
        Viele KI-Dienste liefern eine Antwort und überlassen dir den Rest.
        Osirus KI bleibt in einem Workspace und kann dort weiterarbeiten:
        Dateien lesen, Code ändern, Tests ausführen, mit verbundenen Diensten
        sprechen. Der Unterschied liegt in der Grenze: Lesen darf Osirus
        selbstständig. Alles, was etwas verändert oder den Workspace verlässt,
        wartet auf deine Freigabe.
      </p>
      <p>
        Außerdem wählst du das Modell nicht für jede Frage neu. Für Kurzes nimmt
        Osirus ein schnelles Modell, für Schweres ein stärkeres. Wen du vor dir
        hast, hängt von der Aufgabe ab, nicht von einem festen Standardmodell.
      </p>

      <h2>Wofür du Osirus KI nutzen kannst</h2>
      <ul>
        <li>
          Recherchen, bei denen die Antwort nummerierte Quellen mitbringen soll,
          statt nur einen flüssigen Text.
        </li>
        <li>
          Arbeit mit PDFs, Tabellen und Code im selben Gespräch, inklusive einer
          abgeschotteten Sandbox, in der Python- oder JavaScript-Code aus einer
          Antwort auf Knopfdruck läuft.
        </li>
        <li>
          Wiederkehrende Rollen als Bots, die sich an eure Unterhaltungen
          erinnern, oder mehrere Bots in einem Gruppenchat.
        </li>
        <li>
          Ziele statt einzelner Prompts: Der Agent plant, recherchiert und hält
          vor schreibenden Schritten an.
        </li>
        <li>
          Änderungen an einem Repository bis zum Pull Request, den du selbst
          prüfst.
        </li>
      </ul>

      <h2>Wo die Arbeit stattfindet</h2>
      <p>
        Osirus KI wird von <Link href="/ueber-uns">ClarityCompassAI</Link> in
        Moers betrieben. Anwendung und Datenbank laufen in Frankfurt, in der EU.
        Wie Workspaces getrennt sind und was vor einer Aktion nach außen
        passiert, steht unter <Link href="/sicherheit">Sicherheit</Link> und
        unter <Link href="/ki-team-freigabe">KI-Team mit Freigabeknopf</Link>.
      </p>
      <p>
        Wenn du es ausprobieren willst, reicht die{" "}
        <Link href="/auth/sign-up">Startseite zum kostenlosen Einstieg</Link>–
        ohne dass du vorher einen Plan wählen musst.
      </p>

      <RelatedPages current="/osirus-ki" />
    </article>
  );
}
