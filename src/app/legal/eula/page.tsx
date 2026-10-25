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
        <Link href="/legal/privacy">Datenschutzerklärung</Link> bleibt daneben
        gelten.
      </p>

      <h2>1. Nutzungsrecht</h2>
      <p>
        Du erhältst ein einfaches, nicht ausschließliches, nicht übertragbares
        Recht, Osirus über die Website für dich oder deine Organisation zu
        nutzen, solange dein Konto besteht und du die AGB einhältst. Ein Verkauf
        der Software findet nicht statt. Der Quelltext, die Marke und die
        Modelle bleiben bei der Rechteinhaberin oder den jeweiligen Dritten.
      </p>

      <h2>2. Schranken</h2>
      <ul>
        <li>
          Du darfst die Anwendung nicht vermieten, weiterverkaufen oder Dritten
          außerhalb deines Kontos zugänglich machen.
        </li>
        <li>
          Du darfst technische Schutzmaßnahmen nicht umgehen. Das gesetzliche
          Recht, den Code zu untersuchen, soweit es zwingend besteht, bleibt
          unberührt.
        </li>
        <li>
          Ausgaben des Assistenten darfst du in deinen eigenen Arbeiten
          verwenden. Du bist dafür verantwortlich, Rechte Dritter daran zu
          prüfen.
        </li>
        <li>
          Eigene Modelle werden nicht lizenziert. Was noch nicht verfügbar ist,
          ist nicht Teil dieser Lizenz.
        </li>
      </ul>

      <h2>3. Dritte Software</h2>
      <p>
        Osirus nutzt Bibliotheken Dritter. Deren Lizenzen stehen in der Datei
        THIRD_PARTY_NOTICES.md im Quelltext. Diese EULA erweitert jene Lizenzen
        nicht.
      </p>

      <h2>4. Ende</h2>
      <p>
        Das Nutzungsrecht endet, wenn das Konto endet oder wir es nach den AGB
        sperren. Danach unterlässt du den weiteren Zugriff. Abschnitte über
        geistiges Eigentum und Haftung aus den AGB bleiben bestehen.
      </p>

      <h2>5. Gewährleistung</h2>
      <p>
        Die Anwendung wird bereitgestellt, wie sie läuft. Gesetzliche
        Mängelrechte von Verbrauchern bleiben unberührt. Für Modellantworten
        übernehmen wir keine Richtigkeit. Die Haftungsregeln der AGB gelten auch
        für diese Lizenz.
      </p>

      <h2>6. Kontakt</h2>
      <p>
        {OPERATOR.email}
        <br />
        {OPERATOR.phoneDisplay}
      </p>
    </article>
  );
}
