import Link from "next/link";
import { OPERATOR } from "../operator";

export const metadata = {
  title: "Datenschutz",
  description:
    "Datenschutzerklärung von Osirus: Verantwortliche, Zwecke, Rechtsgrundlagen, Empfänger, Drittländer, Speicherdauer, Rechte und Cookies.",
};

export default function PrivacyPage() {
  return (
    <article className="legal-body" lang="de">
      <h1>Datenschutzerklärung</h1>
      <p>
        Diese Erklärung informiert dich nach Art. 13 und 14 der
        Datenschutz-Grundverordnung (DSGVO) darüber, welche personenbezogenen
        Daten bei der Nutzung von Osirus verarbeitet werden, zu welchem Zweck,
        auf welcher Rechtsgrundlage, an wen sie gehen und wie lange sie
        gespeichert werden. Sie gilt für die Website, den Workspace unter /app
        und alle darin enthaltenen Bereiche (Agents, Rouge Agent, Code, Bots,
        Gruppenchats, Automationen und Verbindungen).
      </p>

      <h2>Inhalt</h2>
      <ol>
        <li>Verantwortliche</li>
        <li>Begriffe und Grundsätze</li>
        <li>Aufruf der Website und Server-Protokolle</li>
        <li>Konto, Anmeldung und Zustimmungen</li>
        <li>Inhalte im Workspace</li>
        <li>Verarbeitung durch KI-Modelle</li>
        <li>Bots, Gedächtnis und Gruppenchats</li>
        <li>Rouge Agent, Code und Freigaben</li>
        <li>Verbundene Dienste (GitHub, Vercel, Neon, Supabase, MCP)</li>
        <li>Dateien, Websuche und Links</li>
        <li>Sprachfunktionen (Diktieren und Vorlesen)</li>
        <li>Geteilte Chats</li>
        <li>Automationen und Benachrichtigungen</li>
        <li>Abonnements, Testphase und Zahlung</li>
        <li>Kontingente und Nutzungsdaten</li>
        <li>Sicherheit und Missbrauchsabwehr</li>
        <li>Cookies und Speicher im Browser</li>
        <li>Empfänger</li>
        <li>Übermittlung in Drittländer</li>
        <li>Speicherdauer und Löschung</li>
        <li>Deine Rechte</li>
        <li>Widerspruchsrecht</li>
        <li>Keine automatisierte Entscheidung im Einzelfall</li>
        <li>Pflicht zur Bereitstellung</li>
        <li>Mindestalter</li>
        <li>Stand und Änderungen</li>
      </ol>

      <h2>1. Verantwortliche</h2>
      <p>
        Verantwortliche im Sinne von Art. 4 Nr. 7 DSGVO ist:
        <br />
        {OPERATOR.name}
        <br />
        Inhaberin: {OPERATOR.owner}
        <br />
        {OPERATOR.street}
        <br />
        {OPERATOR.city}
        <br />
        {OPERATOR.country}
        <br />
        Telefon: <a href={OPERATOR.phoneHref}>{OPERATOR.phoneDisplay}</a>
        <br />
        E-Mail: <a href={`mailto:${OPERATOR.email}`}>{OPERATOR.email}</a>
      </p>
      <p>
        Eine Pflicht zur Benennung eines Datenschutzbeauftragten besteht nicht
        (Art. 37 DSGVO, § 38 BDSG); es ist keiner benannt. Anfragen zum
        Datenschutz und zur Ausübung deiner Rechte richtest du an die oben
        genannte Adresse oder E-Mail.
      </p>

      <h2>2. Begriffe und Grundsätze</h2>
      <p>
        „Personenbezogene Daten“ sind alle Informationen, die sich auf eine
        identifizierte oder identifizierbare Person beziehen (Art. 4 Nr. 1
        DSGVO). Wir verarbeiten sie nur, soweit es für die genannten Zwecke
        erforderlich ist (Datenminimierung), und schützen sie durch technische
        und organisatorische Maßnahmen nach Art. 32 DSGVO: verschlüsselte
        Übertragung (TLS), Trennung jedes Workspace auf Datenbankebene
        (Row-Level Security), verschlüsselte Ablage hinterlegter Zugangsdaten
        (AES-256-GCM), Protokollierung sicherheitsrelevanter Ereignisse und
        Freigaben vor jeder Aktion nach außen.
      </p>
      <p>
        Osirus verkauft keine personenbezogenen Daten und nutzt deine Inhalte
        nicht, um eigene KI-Modelle zu trainieren. Werbung, Tracking oder
        Profilbildung zu Marketingzwecken finden nicht statt.
      </p>

      <h2>3. Aufruf der Website und Server-Protokolle</h2>
      <p>
        Beim Aufruf jeder Seite verarbeitet unser Hosting-Dienstleister Vercel
        technisch notwendige Verbindungsdaten: IP-Adresse, Datum und Uhrzeit,
        aufgerufene Adresse, Statuscode, übertragene Datenmenge, Referrer,
        Browser und Betriebssystem (User-Agent) sowie die Region des
        verarbeitenden Rechenzentrums. Zweck ist die Auslieferung der Seiten,
        die Stabilität und die Abwehr von Angriffen. Rechtsgrundlage ist Art. 6
        Abs. 1 lit. f DSGVO; unser berechtigtes Interesse liegt im sicheren und
        funktionsfähigen Betrieb. Fehlermeldungen der Anwendung enthalten keine
        Zugangsdaten und keine Inhalte von Modellantworten. Protokolle werden
        nach den Fristen des Hosting-Dienstleisters automatisch gelöscht,
        üblicherweise innerhalb weniger Tage bis höchstens 30 Tage.
      </p>

      <h2>4. Konto, Anmeldung und Zustimmungen</h2>
      <ul>
        <li>
          <strong>Daten:</strong> Name, E-Mail-Adresse, Passwort-Hash (nie das
          Passwort im Klartext), bei Anmeldung über GitHub die GitHub-Kennung,
          der Benutzername und die bei GitHub hinterlegte E-Mail, Zeitpunkt der
          Registrierung und Anmeldung, Sitzungskennungen.
        </li>
        <li>
          <strong>Zustimmungen:</strong> Welche Fassung der AGB, der EULA und
          dieser Datenschutzerklärung du wann bestätigt hast. Ändert sich ein
          Text wesentlich, bitten wir erneut um Bestätigung.
        </li>
        <li>
          <strong>Zweck:</strong> Konto bereitstellen, dich sicher anmelden,
          Passwort zurücksetzen, Nachweis der Zustimmungen.
        </li>
        <li>
          <strong>Rechtsgrundlage:</strong> Art. 6 Abs. 1 lit. b DSGVO (Vertrag)
          und für die Nachweise Art. 6 Abs. 1 lit. c und lit. f DSGVO.
        </li>
        <li>
          <strong>Dienstleister:</strong> Neon (Datenbank und Anmeldung), bei
          GitHub-Anmeldung GitHub, für E-Mails zur Bestätigung und zum
          Zurücksetzen des Passworts der E-Mail-Versand von Neon Auth.
        </li>
      </ul>

      <h2>5. Inhalte im Workspace</h2>
      <p>
        Gespeichert werden die Inhalte, die du in Osirus anlegst oder erzeugen
        lässt: Unterhaltungen mit ihren Titeln, Nachrichten und Antworten,
        Aufträge des Rouge Agent und von Code samt Plan, Schritten, Ereignissen,
        Prüfergebnissen und Artefakten, deine Bots mit Name, Rolle und
        Anweisungen, Gruppenchats, angeheftete und archivierte Verläufe sowie
        Einstellungen. Zweck ist, die Funktionen auszuführen und dir den Verlauf
        jederzeit anzuzeigen. Rechtsgrundlage ist Art. 6 Abs. 1 lit. b DSGVO.
        Mitglieder eines gemeinsamen Workspace sehen die Inhalte, die diesem
        Workspace gehören; ein Bot greift für sein Gedächtnis nur auf deine
        eigenen Unterhaltungen mit ihm zu (siehe Abschnitt 7).
      </p>
      <p>
        Bitte gib keine besonderen Kategorien personenbezogener Daten nach Art.
        9 DSGVO (etwa Gesundheitsdaten) und keine Daten Dritter ein, wenn du
        dafür keine Rechtsgrundlage hast. Für Inhalte, die du über Dritte
        eingibst, bist du nach den AGB selbst verantwortlich.
      </p>

      <h2>6. Verarbeitung durch KI-Modelle</h2>
      <p>
        Um eine Antwort zu erzeugen, sendet Osirus deine Nachricht und den dafür
        nötigen Kontext an ein Sprachmodell: frühere Nachrichten derselben
        Unterhaltung, passende Auszüge angehängter Dateien, Webquellen, das
        Gedächtnis eines Bots, Ergebnisse von Werkzeugen und, wenn du ein
        Repository nennst, dessen Übersicht. Welches Modell antwortet, wählt
        Osirus nach Art und Schwierigkeit der Aufgabe; nur in Code kannst du es
        selbst wählen. Die Modelle werden über die in Abschnitt 18 genannten
        Anbieter aufgerufen. Rechtsgrundlage ist Art. 6 Abs. 1 lit. b DSGVO.
      </p>
      <p>
        Die Anbieter verarbeiten die Inhalte zur Beantwortung der Anfrage nach
        ihren eigenen Bedingungen; einige speichern Anfragen für eine begrenzte
        Zeit zur Missbrauchsabwehr. Osirus selbst trainiert keine Modelle mit
        deinen Inhalten. Gleiche Anfragen können für kurze Zeit
        zwischengespeichert werden, damit eine wiederholte Frage nicht erneut
        abgerechnet wird; der Zwischenspeicher ist an deinen Workspace gebunden.
      </p>
      <p>
        Hinweis nach Art. 50 der KI-Verordnung (EU) 2024/1689: Du interagierst
        in Osirus mit KI-Systemen. Texte, Code und andere Ergebnisse werden
        durch KI erzeugt und können Fehler enthalten. Prüfe sie vor dem Einsatz.
      </p>

      <h2>7. Bots, Gedächtnis und Gruppenchats</h2>
      <ul>
        <li>
          <strong>Bots</strong> sind von dir angelegte Assistenten mit Name,
          Rolle und Anweisungen. Jeder Bot hat einen eigenen Raum, in dem eure
          Unterhaltungen gespeichert sind.
        </li>
        <li>
          <strong>Gedächtnis eines Bots:</strong> Bevor ein Bot antwortet, liest
          er die letzten Wortwechsel deiner früheren Unterhaltungen mit ihm
          (höchstens 16 Beiträge, gekürzt). Er liest nur deine eigenen
          Unterhaltungen, nie die anderer Personen im Workspace; archivierte
          Unterhaltungen werden nicht verwendet. Du steuerst das Gedächtnis,
          indem du Unterhaltungen archivierst oder löschen lässt.
        </li>
        <li>
          <strong>Workspace-Gedächtnis:</strong> Aus abgeschlossenen und
          geprüften Aufträgen kann Osirus Erkenntnisse übernehmen (etwa die
          Testumgebung eines Repositorys), um spätere Aufträge im selben
          Workspace zu verbessern.
        </li>
        <li>
          <strong>Gruppenchats:</strong> Nachrichten und Antworten werden im
          Gruppenchat gespeichert. Ein angesprochener Bot liest dazu die letzten
          Beiträge des Gruppenchats.
        </li>
      </ul>
      <p>Rechtsgrundlage ist jeweils Art. 6 Abs. 1 lit. b DSGVO.</p>

      <h2>8. Rouge Agent, Code und Freigaben</h2>
      <p>
        Der Rouge Agent und Code arbeiten Aufträge in mehreren Schritten ab.
        Dafür speichern wir den Plan, jeden Schritt, die genutzten Werkzeuge mit
        ihren Eingaben und Ergebnissen, Prüfergebnisse sowie deine
        Entscheidungen zu Freigaben (wer hat wann was erlaubt oder abgelehnt).
        Code klont das gewählte Repository in eine abgeschottete, kurzlebige
        Sandbox, ändert dort Dateien, führt Prüfungen aus und schreibt
        Änderungen erst nach deiner Freigabe zurück. Die Sandbox wird nach dem
        Auftrag beendet. Der Rouge Agent kann deine Bots befragen und Aufgaben
        an Code übergeben; die Antworten der Bots werden Teil des Auftrags.
        Rechtsgrundlage ist Art. 6 Abs. 1 lit. b DSGVO, für die Protokolle der
        Freigaben zusätzlich Art. 6 Abs. 1 lit. f DSGVO (Nachvollziehbarkeit und
        Sicherheit).
      </p>

      <h2>9. Verbundene Dienste (GitHub, Vercel, Neon, Supabase, MCP)</h2>
      <p>
        Verbindest du unter „Connections“ einen Dienst, speichern wir den dafür
        hinterlegten Zugangsschlüssel verschlüsselt und nutzen ihn nur, wenn ein
        Auftrag ihn braucht. Er wird nie angezeigt, nie in eine Modellanfrage
        geschrieben und nicht in Protokolle aufgenommen.
      </p>
      <ul>
        <li>
          <strong>GitHub:</strong> Mit Lesezugriff listen und lesen Osirus,
          deine Bots und der Rouge Agent die Repositories, die dein Schlüssel
          sieht (Name, Branches, Dateien, README). Mit Schreibzugriff kann der
          Rouge Agent nach deiner ausdrücklichen Freigabe Repositories anlegen,
          Dateien schreiben, Pull Requests und Issues öffnen; Code kann nach
          Freigabe einen Branch pushen und einen Pull Request öffnen.
        </li>
        <li>
          <strong>Vercel, Neon, Supabase:</strong> Lesender Zugriff auf Projekte
          und Deployments deines Kontos, wenn ein Auftrag sie braucht.
        </li>
        <li>
          <strong>MCP-Server:</strong> Von dir eingetragene Server erhalten die
          Eingaben der Werkzeugaufrufe, die du freigibst. Jeder Aufruf eines
          MCP-Werkzeugs braucht deine Freigabe.
        </li>
      </ul>
      <p>
        Für die Verarbeitung bei diesen Diensten gelten deren eigene
        Datenschutzbestimmungen. Rechtsgrundlage ist Art. 6 Abs. 1 lit. b DSGVO.
        Du kannst jede Verbindung jederzeit trennen; der gespeicherte Schlüssel
        wird dann gelöscht.
      </p>

      <h2>10. Dateien, Websuche und Links</h2>
      <ul>
        <li>
          <strong>Dateien:</strong> Hochgeladene Dateien (etwa PDF, Tabellen,
          Code) werden in Text überführt und in deinem Workspace gespeichert.
          Passende Auszüge gehen mit deinen Fragen im selben Chat an das
          antwortende Modell.
        </li>
        <li>
          <strong>Websuche:</strong> Schaltest du sie ein, sendet Osirus aus
          deiner Nachricht abgeleitete Suchbegriffe an einen Suchdienst und ruft
          die gefundenen Seiten ab.
        </li>
        <li>
          <strong>Links:</strong> Links in deiner Nachricht werden abgerufen, um
          sie zu lesen. Der Betreiber der Seite sieht dabei eine Anfrage von
          Osirus, nicht deine IP-Adresse.
        </li>
      </ul>
      <p>Rechtsgrundlage ist Art. 6 Abs. 1 lit. b DSGVO.</p>

      <h2>11. Sprachfunktionen (Diktieren und Vorlesen)</h2>
      <p>
        Diktieren nutzt die Spracherkennung deines Browsers (Web Speech API).
        Der Browser fragt dich vorher nach der Erlaubnis für das Mikrofon. Die
        Erkennung führt der Hersteller deines Browsers durch, nicht Osirus: In
        Google Chrome geht die Aufnahme an Google, in Safari an Apple. Osirus
        erhält nur den erkannten Text, so als hättest du ihn getippt, und
        speichert keine Audiodaten. Vorlesen nutzt die Sprachausgabe deines
        Geräts und überträgt nichts. Rechtsgrundlage ist deine Einwilligung
        durch die Freigabe des Mikrofons (Art. 6 Abs. 1 lit. a DSGVO, § 25 Abs.
        1 TDDDG); du kannst sie in den Browser-Einstellungen jederzeit
        widerrufen. Ohne Diktieren funktioniert Osirus unverändert.
      </p>

      <h2>12. Geteilte Chats</h2>
      <p>
        Erstellst du einen Teilen-Link, kann jede Person mit diesem Link die
        Fragen und Antworten des Chats bis zum Zeitpunkt des Teilens lesen, bis
        du den Link deaktivierst. Dateien, Denkschritte und spätere Nachrichten
        werden nicht geteilt. Geteilte Seiten sind von Suchmaschinen
        ausgeschlossen. Rechtsgrundlage ist Art. 6 Abs. 1 lit. b DSGVO. Teile
        keine Inhalte mit personenbezogenen Daten Dritter ohne deren
        Einverständnis.
      </p>

      <h2>13. Automationen und Benachrichtigungen</h2>
      <p>
        Legst du eine Automation an, speichern wir ihren Zeitplan oder Auslöser
        und führen den Auftrag zu diesem Zeitpunkt in deinem Namen aus.
        Ergebnisse und Hinweise erscheinen in deiner Inbox. Rechtsgrundlage ist
        Art. 6 Abs. 1 lit. b DSGVO.
      </p>

      <h2>14. Abonnements, Testphase und Zahlung</h2>
      <p>
        Für kostenpflichtige Abonnements nutzen wir Stripe. Im Checkout gibst du
        deine Zahlungsdaten direkt bei Stripe ein; Osirus erhält sie nicht,
        sondern nur eine Kunden- und Abonnementkennung, den Tarif, den Status
        (etwa Testphase, aktiv, gekündigt) und die Abrechnungszeiträume. Beim
        ersten Pro-Abonnement kann eine kostenlose Testphase gelten; ob sie dir
        zusteht, prüfen wir anhand deines Kontos. Rechtsgrundlage ist Art. 6
        Abs. 1 lit. b DSGVO, für Rechnungs- und Buchungsdaten Art. 6 Abs. 1 lit.
        c DSGVO in Verbindung mit § 147 AO und § 257 HGB. Stripe ist für die
        Zahlungsabwicklung teils eigenständig verantwortlich.
      </p>

      <h2>15. Kontingente und Nutzungsdaten</h2>
      <p>
        Für die Abrechnung des 5-Stunden- und des Wochenkontingents speichern
        wir je Modellaufruf: Bereich, Modellkennung, Anzahl der Tokens, Kosten,
        Laufzeit und bei einem Fehler eine Fehlerkategorie, jedoch keine
        Inhalte. Rechtsgrundlage ist Art. 6 Abs. 1 lit. b DSGVO, für die
        Kapazitätssteuerung und Fehlerauswertung Art. 6 Abs. 1 lit. f DSGVO.
      </p>

      <h2>16. Sicherheit und Missbrauchsabwehr</h2>
      <p>
        Wir protokollieren sicherheitsrelevante Ereignisse: abgelehnte oder
        abgelaufene Freigaben, verweigerte Werkzeugaufrufe, blockierte
        Verbindungen zu privaten Adressen, Zugriffsversuche auf fremde Inhalte
        und Zähler für Anfragebegrenzungen. Zweck ist der Schutz deines Kontos,
        anderer Nutzer und des Dienstes. Rechtsgrundlage ist Art. 6 Abs. 1 lit.
        f DSGVO.
      </p>

      <h2>17. Cookies und Speicher im Browser</h2>
      <p>
        Osirus setzt nur technisch notwendige Cookies und speichert
        Einstellungen, die du ausdrücklich wählst (§ 25 Abs. 2 TDDDG). Es gibt
        keine Analyse- oder Marketing-Cookies. Die vollständige Liste mit Namen,
        Zweck und Dauer steht in der{" "}
        <Link href="/legal/cookies">Cookie-Erklärung</Link>.
      </p>

      <h2>18. Empfänger</h2>
      <ul>
        <li>
          <strong>Neon, LLC</strong> (ein Unternehmen von Databricks, Inc.):
          Datenbank und Anmeldung, Region Europäische Union (eu-central-1,
          Frankfurt). Auftragsverarbeitung nach Art. 28 DSGVO.
        </li>
        <li>
          <strong>Vercel Inc.</strong>: Hosting, Ausführung der Anwendung
          (Region Frankfurt) und die isolierte Sandbox für Code.
          Auftragsverarbeitung nach Art. 28 DSGVO.
        </li>
        <li>
          <strong>GitHub, Inc.</strong> (Microsoft): nur bei Anmeldung mit
          GitHub oder einer GitHub-Verbindung.
        </li>
        <li>
          <strong>Stripe Payments Europe, Ltd.</strong> und{" "}
          <strong>Stripe, Inc.</strong>: Zahlungsabwicklung, Checkout und
          Kundenportal.
        </li>
        <li>
          <strong>Modellanbieter:</strong> Inhalte, die zur Beantwortung oder
          Prüfung nötig sind (Nachrichten, Dateiauszüge, Webquellen,
          Werkzeugergebnisse), werden über die Schnittstellen von UNOROUTER,
          OpenRouter, Inc., NVIDIA Corporation (NIM), Bytez, Inc., Lightning AI,
          Inc., Kunya AI, B.AI, AIHubMix und ShortAPI verarbeitet, je nachdem,
          welches Modell eine Anfrage beantwortet.
        </li>
        <li>
          <strong>Hersteller der Modelle:</strong> UNOROUTER, OpenRouter, Kunya
          AI, B.AI, AIHubMix und ShortAPI leiten Anfragen je nach Modell an
          dessen Anbieter weiter, etwa Anthropic, PBC, OpenAI, L.L.C., Google
          LLC, xAI Corp., Alibaba Cloud (Qwen), Moonshot AI oder DeepSeek.
        </li>
        <li>
          <strong>Suchdienste:</strong> bei eingeschalteter Websuche Wikimedia
          Foundation, Inc. (Wikipedia) und, soweit eingerichtet, Tavily, Exa
          oder Firecrawl; bei Links in deiner Nachricht der Betreiber der
          jeweiligen Seite.
        </li>
        <li>
          <strong>Von dir verbundene Dienste</strong> (Vercel, Neon, Supabase,
          MCP-Server) in dem in Abschnitt 9 beschriebenen Umfang.
        </li>
        <li>
          <strong>Browser-Hersteller</strong> (etwa Google oder Apple) beim
          Diktieren, siehe Abschnitt 11.
        </li>
        <li>
          <strong>Behörden</strong>, wenn wir gesetzlich dazu verpflichtet sind
          (Art. 6 Abs. 1 lit. c DSGVO).
        </li>
      </ul>

      <h2>19. Übermittlung in Drittländer</h2>
      <p>
        Mehrere der genannten Empfänger sitzen in den USA oder anderen Ländern
        außerhalb des Europäischen Wirtschaftsraums oder verarbeiten Daten dort.
        Soweit ein Empfänger nach dem EU-US Data Privacy Framework zertifiziert
        ist, stützt sich die Übermittlung auf den Angemessenheitsbeschluss der
        EU-Kommission (Durchführungsbeschluss (EU) 2023/1795). Andernfalls
        erfolgt sie auf Grundlage von Standardvertragsklauseln nach dem
        Durchführungsbeschluss (EU) 2021/914, soweit der Empfänger sie anbietet,
        oder, wo das nicht der Fall ist, weil sie zur Erfüllung des mit dir
        geschlossenen Vertrags erforderlich ist (Art. 49 Abs. 1 lit. b DSGVO).
        Vercel Inc. und Databricks, Inc. sind nach dem Data Privacy Framework
        zertifiziert; das lässt sich unter dataprivacyframework.gov prüfen. In
        Drittländern kann das Datenschutzniveau geringer sein als in der EU;
        insbesondere können Behörden dort Zugriffsrechte haben.
      </p>

      <h2>20. Speicherdauer und Löschung</h2>
      <ul>
        <li>
          Konto- und Workspace-Inhalte speichern wir, solange dein Konto
          besteht. Einzelne Unterhaltungen kannst du archivieren; auf Anfrage
          löschen wir einzelne Inhalte oder das gesamte Konto.
        </li>
        <li>
          Nach einer Löschanfrage löschen oder anonymisieren wir die Daten
          unverzüglich, spätestens innerhalb eines Monats, soweit keine
          gesetzlichen Aufbewahrungspflichten entgegenstehen.
        </li>
        <li>
          Rechnungs- und Buchungsdaten bewahren wir nach § 147 AO und § 257 HGB
          bis zu zehn Jahre auf, gesperrt für jede andere Verwendung.
        </li>
        <li>
          Sicherheitsprotokolle, Freigabe-Nachweise und Nutzungszähler speichern
          wir, solange dein Konto besteht, weil sie für Abrechnung,
          Nachvollziehbarkeit und Sicherheit gebraucht werden; mit dem Konto
          werden sie gelöscht, soweit keine Aufbewahrungspflicht besteht.
        </li>
        <li>Sandboxes für Code bestehen nur für die Dauer eines Auftrags.</li>
        <li>
          Datensicherungen der Datenbank werden im regulären Zyklus des
          Anbieters überschrieben.
        </li>
      </ul>

      <h2>21. Deine Rechte</h2>
      <p>Dir stehen gegenüber der Verantwortlichen folgende Rechte zu:</p>
      <ul>
        <li>Auskunft über die verarbeiteten Daten (Art. 15 DSGVO),</li>
        <li>Berichtigung unrichtiger Daten (Art. 16 DSGVO),</li>
        <li>Löschung (Art. 17 DSGVO),</li>
        <li>Einschränkung der Verarbeitung (Art. 18 DSGVO),</li>
        <li>
          Datenübertragbarkeit in einem gängigen, maschinenlesbaren Format (Art.
          20 DSGVO),
        </li>
        <li>Widerspruch gegen die Verarbeitung (Art. 21 DSGVO),</li>
        <li>
          Widerruf einer Einwilligung mit Wirkung für die Zukunft (Art. 7 Abs. 3
          DSGVO).
        </li>
      </ul>
      <p>
        Wende dich dafür formlos an{" "}
        <a href={`mailto:${OPERATOR.email}`}>{OPERATOR.email}</a>. Wir antworten
        innerhalb eines Monats (Art. 12 Abs. 3 DSGVO) und können dich bitten,
        deine Identität zu bestätigen. Außerdem hast du das Recht, dich bei
        einer Aufsichtsbehörde zu beschweren (Art. 77 DSGVO). Zuständig für den
        Sitz der Verantwortlichen ist die Landesbeauftragte für Datenschutz und
        Informationsfreiheit Nordrhein-Westfalen (LDI NRW), Kavalleriestraße
        2–4, 40213 Düsseldorf,{" "}
        <a href="https://www.ldi.nrw.de">www.ldi.nrw.de</a>.
      </p>

      <h2>22. Widerspruchsrecht</h2>
      <p>
        <strong>
          Soweit wir Daten auf Grundlage von Art. 6 Abs. 1 lit. f DSGVO
          verarbeiten, kannst du aus Gründen, die sich aus deiner besonderen
          Situation ergeben, jederzeit widersprechen (Art. 21 Abs. 1 DSGVO). Wir
          verarbeiten die Daten dann nicht mehr, es sei denn, wir können
          zwingende schutzwürdige Gründe nachweisen, die deine Interessen,
          Rechte und Freiheiten überwiegen, oder die Verarbeitung dient der
          Geltendmachung, Ausübung oder Verteidigung von Rechtsansprüchen.
        </strong>
      </p>

      <h2>23. Keine automatisierte Entscheidung im Einzelfall</h2>
      <p>
        Wir treffen keine Entscheidungen, die ausschließlich auf einer
        automatisierten Verarbeitung beruhen und dir gegenüber rechtliche
        Wirkung entfalten oder dich in ähnlicher Weise erheblich beeinträchtigen
        (Art. 22 DSGVO). Die automatische Wahl eines Sprachmodells und das
        Pausieren bei erschöpftem Kontingent sind technische Abläufe zur
        Vertragserfüllung.
      </p>

      <h2>24. Pflicht zur Bereitstellung</h2>
      <p>
        Name, E-Mail und ein Passwort oder die Anmeldung über GitHub sind für
        das Konto erforderlich; ohne sie kommt der Vertrag nicht zustande. Für
        ein Abonnement sind zusätzlich die Zahlungsdaten bei Stripe nötig. Alle
        weiteren Angaben, Verbindungen und Funktionen wie Diktieren sind
        freiwillig.
      </p>

      <h2>25. Mindestalter</h2>
      <p>
        Osirus richtet sich an Personen ab 18 Jahren. Wir verarbeiten nicht
        wissentlich Daten von Kindern. Erfahren wir davon, löschen wir das
        Konto.
      </p>

      <h2>26. Stand und Änderungen</h2>
      <p>Stand: 29. Oktober 2026.</p>
      <p>
        Ändert sich die Verarbeitung, passen wir diese Erklärung an. Bei
        wesentlichen Änderungen bitten wir dich in der Anwendung, die neue
        Fassung zu bestätigen. Frühere Fassungen erhältst du auf Anfrage.
      </p>
    </article>
  );
}
