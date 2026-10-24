import Link from "next/link";
import { LegalDraftNote } from "@/components/legal/draft-note";
import { OPERATOR } from "../operator";

export const metadata = {
  title: "Cookies",
  description:
    "Cookie-Hinweis für Osirus nach § 25 TDDDG: notwendige Speicherungen und der Einwilligungs-Hinweis.",
  robots: { index: true },
};

export default function CookiesPage() {
  return (
    <article className="legal-body" lang="de">
      <LegalDraftNote />
      <h1>Cookie-Hinweis</h1>
      <p>
        Diese Seite listet die Cookies von Osirus, ihren Zweck, die
        Rechtsgrundlage und die Dauer. Sie ergänzt die{" "}
        <Link href="/legal/privacy">Datenschutzerklärung</Link>.
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
              <td>Hält dich angemeldet.</td>
              <td>§ 25 Abs. 2 TDDDG, Art. 6 Abs. 1 lit. b DSGVO</td>
              <td>Sitzung, HttpOnly</td>
            </tr>
            <tr>
              <td>osirus-consent</td>
              <td>Merkt deine Wahl im Cookie-Hinweis.</td>
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
              <td>Eine frühere Modellwahl, nur wenn du sie gesetzt hast.</td>
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
      <p>
        Die Anwendung nutzt kein localStorage und kein sessionStorage. Analyse-
        oder Marketing-Cookies gibt es nicht. Kommen sie hinzu, werden sie erst
        nach Einwilligung gesetzt (§ 25 Abs. 1 TDDDG).
      </p>

      <h2>3. Hinweis</h2>
      <p>
        Beim ersten Besuch fragt der Hinweis nach der Wahl. „Nur notwendige“
        speichert osirus-consent mit dem Wert necessary. „Alle akzeptieren“
        speichert den Wert all. Solange keine optionalen Cookies existieren,
        setzt auch die Zustimmung keine zusätzlichen Cookies. Die Entscheidung
        kannst du löschen, indem du osirus-consent im Browser entfernst. Danach
        erscheint der Hinweis wieder.
      </p>

      <h2>4. Löschen</h2>
      <p>
        Cookies lassen sich in den Browsereinstellungen löschen oder sperren.
        Ohne das Sitzungs-Cookie ist keine Anmeldung möglich. Ohne die
        Präferenz-Cookies gelten die Voreinstellungen.
      </p>
    </article>
  );
}
