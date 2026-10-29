import Link from "next/link";
import { OPERATOR } from "../operator";

export const metadata = {
  title: "Cookies",
  description:
    "Cookie-Hinweis für Osirus nach § 25 TDDDG: technisch notwendige Speicherungen.",
  robots: { index: true },
};

export default function CookiesPage() {
  return (
    <article className="legal-body" lang="de">
      <h1>Cookie-Hinweis</h1>
      <p>
        Diese Seite listet sämtliche Cookies und Speicherungen im Browser, die
        Osirus nutzt, mit Zweck, Rechtsgrundlage und Speicherdauer. Sie ergänzt
        die <Link href="/legal/privacy">Datenschutzerklärung</Link>.
      </p>

      <h2>1. Verantwortliche</h2>
      <p>
        {OPERATOR.name}, Inhaberin {OPERATOR.owner}, {OPERATOR.street},{" "}
        {OPERATOR.city}, {OPERATOR.country}. E-Mail{" "}
        <a href={`mailto:${OPERATOR.email}`}>{OPERATOR.email}</a>, Telefon{" "}
        <a href={OPERATOR.phoneHref}>{OPERATOR.phoneDisplay}</a>.
      </p>

      <h2>2. Speicherungen</h2>
      <div className="table-wrap" tabIndex={0} aria-label="Cookie-Liste">
        <table className="table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Zweck</th>
              <th>Grundlage</th>
              <th>Dauer</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Sitzung von Neon Auth</td>
              <td>Hält dich sicher angemeldet.</td>
              <td>§ 25 Abs. 2 TDDDG, Art. 6 Abs. 1 lit. b DSGVO</td>
              <td>Sitzung, HttpOnly</td>
            </tr>
            <tr>
              <td>osirus-consent</td>
              <td>Speichert eine gesetzte Cookie-Präferenz.</td>
              <td>§ 25 Abs. 2 TDDDG</td>
              <td>1 Jahr, SameSite=Lax</td>
            </tr>
            <tr>
              <td>osirus-theme</td>
              <td>Deine Farbwahl, gesetzt erst wenn du sie triffst.</td>
              <td>§ 25 Abs. 2 TDDDG</td>
              <td>1 Jahr, SameSite=Lax</td>
            </tr>
            <tr>
              <td>osirus-sidebar</td>
              <td>Ob die Seitenleiste eingeklappt ist.</td>
              <td>§ 25 Abs. 2 TDDDG</td>
              <td>1 Jahr, SameSite=Lax</td>
            </tr>
            <tr>
              <td>osirus-mode</td>
              <td>Deine gewählte Arbeitsweise.</td>
              <td>§ 25 Abs. 2 TDDDG</td>
              <td>1 Jahr, SameSite=Lax</td>
            </tr>
            <tr>
              <td>osirus-lab-model</td>
              <td>Deine Modellwahl, nur wenn du sie gesetzt hast.</td>
              <td>§ 25 Abs. 2 TDDDG</td>
              <td>1 Jahr, SameSite=Lax</td>
            </tr>
            <tr>
              <td>osirus-interaction</td>
              <td>
                Deine Wahl zwischen den Oberflächen, nur wenn du sie setzt.
              </td>
              <td>§ 25 Abs. 2 TDDDG</td>
              <td>1 Jahr, SameSite=Lax</td>
            </tr>
          </tbody>
        </table>
      </div>

      <h2>3. Speicher im Browser (localStorage, sessionStorage)</h2>
      <div className="table-wrap" tabIndex={0} aria-label="Browser-Speicher">
        <table className="table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Art</th>
              <th>Zweck</th>
              <th>Grundlage</th>
              <th>Dauer</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>osirus.code.model</td>
              <td>localStorage</td>
              <td>
                Das Modell, das du in Code gewählt hast, nur wenn du eines
                wählst.
              </td>
              <td>§ 25 Abs. 2 Nr. 2 TDDDG</td>
              <td>bis du es änderst oder den Browserspeicher löschst</td>
            </tr>
            <tr>
              <td>osirus.models.v3</td>
              <td>sessionStorage</td>
              <td>
                Kurzzeitige Kopie der Liste verfügbarer Modelle, damit die
                Auswahl nicht bei jedem Seitenwechsel neu geladen wird. Enthält
                keine personenbezogenen Daten.
              </td>
              <td>§ 25 Abs. 2 Nr. 2 TDDDG</td>
              <td>bis zum Schließen des Tabs</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p>
        Analyse- oder Marketing-Cookies und vergleichbare Technologien gibt es
        nicht, ebenso keine Einbindung von Werbe- oder Tracking-Diensten
        Dritter. Sollten jemals optionale Speicherungen hinzukommen, werden sie
        erst nach vorheriger Einwilligung („Nur notwendige“ / „Alle
        akzeptieren“) gemäß § 25 Abs. 1 TDDDG gesetzt.
      </p>

      <h2>4. Mikrofon</h2>
      <p>
        Für das Diktieren fragt dein Browser nach der Erlaubnis, das Mikrofon zu
        nutzen. Diese Erlaubnis verwaltet dein Browser; Osirus speichert sie
        nicht. Du kannst sie in den Einstellungen deines Browsers jederzeit
        entziehen. Einzelheiten zur Verarbeitung stehen in Abschnitt 11 der{" "}
        <Link href="/legal/privacy">Datenschutzerklärung</Link>.
      </p>

      <h2>5. Rechtsgrundlage ohne Banner-Belästigung</h2>
      <p>
        Da Osirus ausschließlich technisch notwendige bzw. ausdrücklich vom
        Nutzer angeforderte Präferenz-Cookies nach § 25 Abs. 2 TDDDG einsetzt,
        wird die Nutzung nicht durch Werbe- oder Tracking-Banner blockiert. Eine
        gespeicherte Wahl in osirus-consent (`necessary` oder `all`) setzt keine
        optionalen Drittanbieter-Cookies.
      </p>

      <h2>6. Löschen</h2>
      <p>
        Cookies und den Browserspeicher kannst du jederzeit in den
        Browsereinstellungen löschen oder sperren. Ohne das Sitzungs-Cookie ist
        keine Anmeldung möglich. Ohne die Präferenzen gelten die
        Voreinstellungen.
      </p>

      <p>Stand: 29. Oktober 2026.</p>
    </article>
  );
}
