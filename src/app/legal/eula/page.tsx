import Link from "next/link";
import { OPERATOR } from "../operator";

export const metadata = {
  title: "EULA",
  description:
    "Endnutzer-Lizenz für Osirus: Nutzungsrecht, Schranken und geistiges Eigentum.",
};

export default function EulaPage() {
  return (
    <article className="legal-body" lang="de">
      <h1>Endnutzer-Lizenz (EULA)</h1>
      <p>
        Diese Lizenz gilt zwischen dir und {OPERATOR.name}, Inhaberin{" "}
        {OPERATOR.owner}, für die Nutzung der Anwendung Osirus. Sie ergänzt die{" "}
        <Link href="/legal/terms">AGB</Link>. Bei Widerspruch gehen die AGB vor,
        soweit sie Verbraucherrechte betreffen. Die{" "}
        <Link href="/legal/privacy">Datenschutzerklärung</Link> gilt ergänzend.
      </p>

      <h2>1. Nutzungsrecht</h2>
      <p>
        Du erhältst ein einfaches, nicht ausschließliches, nicht übertragbares
        Recht, Osirus über die Weboberfläche für dich oder deine Organisation zu
        nutzen, solange dein Konto besteht und du die AGB einhältst. Ein Verkauf
        der Software findet nicht statt. Der Quelltext, die Marke und die
        zugrundeliegenden Sprachmodelle verbleiben bei der Rechteinhaberin bzw.
        den jeweiligen Dritten.
      </p>

      <h2>2. Schranken</h2>
      <ul>
        <li>
          Du darfst die Anwendung nicht vermieten, weiterverkaufen oder Dritten
          außerhalb deines Kontos entgeltlich zugänglich machen.
        </li>
        <li>
          Du darfst technische Schutzmaßnahmen, Rate-Limits, Kontingente oder
          Paywall-Mechanismen nicht umgehen. Das gesetzliche Recht nach §§ 69d,
          69e UrhG bleibt unberührt.
        </li>
        <li>
          Ausgaben des Assistenten, der Work-Läufe und der Agents darfst du in
          deinen eigenen Projekten frei verwenden. Du bist dafür verantwortlich,
          Rechte Dritter und die Eignung der Ergebnisse vor dem Einsatz zu
          prüfen.
        </li>
      </ul>

      <h2>3. Dritte Software</h2>
      <p>
        Osirus nutzt Open-Source-Bibliotheken Dritter. Deren Lizenzhinweise
        stehen in der Datei THIRD_PARTY_NOTICES.md im Quelltext. Diese EULA
        schränkt jene Open-Source-Lizenzen nicht ein.
      </p>

      <h2>4. Laufzeit und Beendigung</h2>
      <p>
        Das Nutzungsrecht endet mit der Schließung deines Kontos oder einer
        berechtigten Sperrung nach den AGB. Bestimmungen über geistiges Eigentum
        und Haftung aus den AGB gelten über das Vertragsende hinaus fort.
      </p>

      <h2>5. Gewährleistung und Haftung</h2>
      <p>
        Gesetzliche Mängelrechte von Verbrauchern bleiben unberührt. Für die
        inhaltliche Fehlerfreiheit von Sprachmodell-Ausgaben wird keine Gewähr
        übernommen. Es gelten die Haftungsregelungen der AGB.
      </p>

      <h2>6. Kontakt</h2>
      <p>
        <a href={`mailto:${OPERATOR.email}`}>{OPERATOR.email}</a>
        <br />
        <a href={OPERATOR.phoneHref}>{OPERATOR.phoneDisplay}</a>
      </p>
    </article>
  );
}
