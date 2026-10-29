import Link from "next/link";
import { OPERATOR } from "../operator";

export const metadata = {
  title: "EULA",
  description:
    "Endnutzer-Lizenz für Osirus: Nutzungsrecht, Schranken, Rechte an Ergebnissen, Modelle Dritter und geistiges Eigentum.",
};

export default function EulaPage() {
  return (
    <article className="legal-body" lang="de">
      <h1>Endnutzer-Lizenz (EULA)</h1>
      <p>Stand: 29. Oktober 2026</p>
      <p>
        Diese Lizenz gilt zwischen dir und {OPERATOR.name}, Inhaberin{" "}
        {OPERATOR.owner}, für die Nutzung der Anwendung Osirus. Sie ergänzt die{" "}
        <Link href="/legal/terms">AGB</Link>. Bei Widersprüchen gehen die AGB
        vor, soweit sie Verbraucherrechte betreffen. Die{" "}
        <Link href="/legal/privacy">Datenschutzerklärung</Link> gilt ergänzend.
      </p>

      <h2>1. Gegenstand</h2>
      <p>
        Osirus wird als Dienst über das Internet bereitgestellt (Software as a
        Service). Eine Kopie der Software wird nicht überlassen und nicht
        verkauft. Gegenstand dieser Lizenz sind die Weboberfläche, die
        Programmierschnittstellen, die du über die Oberfläche nutzt, die
        Dokumentation und die mit Osirus erzeugten Ergebnisse.
      </p>

      <h2>2. Nutzungsrecht</h2>
      <p>
        Du erhältst für die Dauer deines Vertrags ein einfaches, nicht
        ausschließliches, nicht übertragbares und nicht unterlizenzierbares
        Recht, Osirus im Rahmen deines Tarifs für eigene Zwecke oder die Zwecke
        deiner Organisation zu nutzen. Personen, die du in einen gemeinsamen
        Workspace einlädst, nutzen Osirus mit eigenem Konto und auf Grundlage
        dieser Lizenz.
      </p>

      <h2>3. Schranken</h2>
      <ul>
        <li>
          Du darfst Osirus nicht vermieten, verleihen, weiterverkaufen oder
          Dritten außerhalb deines Kontos oder Workspace entgeltlich oder
          unentgeltlich als eigenen Dienst zugänglich machen.
        </li>
        <li>
          Du darfst technische Schutzmaßnahmen, Anfragebegrenzungen,
          Kontingente, Bezahlschranken, die Sandbox oder die Trennung der
          Workspaces nicht umgehen.
        </li>
        <li>
          Du darfst Osirus nicht automatisiert in einem Umfang abfragen, der
          über die bestimmungsgemäße Nutzung hinausgeht, und keine Inhalte der
          Anwendung systematisch auslesen, um einen konkurrierenden Dienst oder
          ein konkurrierendes Modell zu entwickeln.
        </li>
        <li>
          Die Dekompilierung und Rückentwicklung ist nur im Rahmen der §§ 69d
          und 69e UrhG zulässig.
        </li>
        <li>
          Urheberrechts-, Marken- und sonstige Schutzvermerke dürfen nicht
          entfernt oder verändert werden.
        </li>
      </ul>

      <h2>4. Rechte an Eingaben und Ergebnissen</h2>
      <p>
        Deine Eingaben und Dateien bleiben deine. Die Ergebnisse, die Osirus für
        dich erzeugt (Antworten, Code, Pläne, Artefakte), darfst du ohne
        zusätzliche Lizenz von uns in eigenen und kommerziellen Projekten
        verwenden, ändern und veröffentlichen, soweit wir Rechte daran haben.
        KI-erzeugte Ergebnisse sind nach geltendem Recht häufig nicht
        urheberrechtlich geschützt und können ähnlich auch für andere entstehen.
        Du bist dafür verantwortlich, vor dem Einsatz Rechte Dritter (etwa
        Lizenzen von Code-Bibliotheken) und die Eignung für deinen Zweck zu
        prüfen.
      </p>

      <h2>5. Sprachmodelle und Dienste Dritter</h2>
      <p>
        Osirus ruft Sprachmodelle verschiedener Anbieter auf und verbindet auf
        deinen Wunsch Dienste wie GitHub, Vercel, Neon, Supabase und MCP-Server.
        Die Modelle und Dienste bleiben Eigentum ihrer Anbieter. Du hältst die
        Nutzungsrichtlinien dieser Anbieter ein, soweit sie für deine Nutzung
        gelten; insbesondere darfst du Osirus nicht verwenden, um mit den
        Ergebnissen eines Modells ein konkurrierendes Modell zu trainieren, wenn
        der jeweilige Anbieter das untersagt.
      </p>

      <h2>6. Open-Source-Software</h2>
      <p>
        Osirus nutzt Open-Source-Bibliotheken. Ihre Lizenzhinweise stehen in der
        Datei THIRD_PARTY_NOTICES.md im Quelltext und werden auf Anfrage
        bereitgestellt. Diese EULA schränkt die Rechte aus jenen Lizenzen nicht
        ein.
      </p>

      <h2>7. Marken und geistiges Eigentum</h2>
      <p>
        „Osirus“, das Logo, die Gestaltung der Oberfläche und die Dokumentation
        sind geschützt und verbleiben bei der Rechteinhaberin. Die Lizenz
        gewährt keine Rechte an Marken oder Kennzeichen.
      </p>

      <h2>8. Aktualisierungen</h2>
      <p>
        Wir aktualisieren Osirus laufend. Aktualisierungen sind Teil der
        Leistung und unterliegen dieser Lizenz. Änderungen des Funktionsumfangs
        richten sich nach § 17 der AGB.
      </p>

      <h2>9. Exportkontrolle und Sanktionen</h2>
      <p>
        Du nutzt Osirus nicht entgegen geltender Exportkontroll- und
        Sanktionsvorschriften der Europäischen Union oder der Bundesrepublik
        Deutschland und nicht für Personen oder Organisationen, gegen die solche
        Sanktionen bestehen.
      </p>

      <h2>10. Laufzeit und Beendigung</h2>
      <p>
        Das Nutzungsrecht endet mit dem Ende deines Vertrags, mit der Schließung
        deines Kontos oder mit einer berechtigten Sperrung nach den AGB. Die
        Regelungen zu Ergebnissen (Ziffer 4), geistigem Eigentum (Ziffer 7) und
        die Haftungsregelungen der AGB gelten über das Vertragsende hinaus.
      </p>

      <h2>11. Gewährleistung und Haftung</h2>
      <p>
        Gesetzliche Rechte von Verbrauchern bleiben unberührt. Für die
        inhaltliche Richtigkeit von KI-Ergebnissen übernehmen wir keine
        Garantie. Im Übrigen gelten die Regelungen zur Gewährleistung und
        Haftung in den §§ 13 und 14 der AGB.
      </p>

      <h2>12. Kontakt</h2>
      <p>
        {OPERATOR.name}, Inhaberin {OPERATOR.owner}
        <br />
        {OPERATOR.street}, {OPERATOR.city}, {OPERATOR.country}
        <br />
        <a href={`mailto:${OPERATOR.email}`}>{OPERATOR.email}</a>
        <br />
        <a href={OPERATOR.phoneHref}>{OPERATOR.phoneDisplay}</a>
      </p>
    </article>
  );
}
