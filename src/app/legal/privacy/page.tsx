import Link from "next/link";
import { OPERATOR } from "../operator";

export const metadata = {
  title: "Datenschutz",
  description:
    "Datenschutzerklärung von Osirus: Verantwortliche, Empfänger, Rechte und Cookies.",
};

export default function PrivacyPage() {
  return (
    <article className="legal-body" lang="de">
      <h1>Datenschutzerklärung</h1>
      <p>
        Diese Erklärung beschreibt, welche personenbezogenen Daten Osirus
        verarbeitet, zu welchem Zweck, auf welcher Rechtsgrundlage und wie
        lange. Sie gilt für die Website und den Workspace.
      </p>

      <h2>1. Verantwortliche</h2>
      <p>
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
        Ein Datenschutzbeauftragter ist nicht benannt. Anfragen zu deinen
        Rechten richtest du an die genannte Adresse.
      </p>

      <h2>2. Welche Daten wir verarbeiten</h2>
      <ul>
        <li>
          <strong>Konto.</strong> Name, E-Mail-Adresse und die Authentifizierung
          über E-Mail und Passwort oder über GitHub OAuth sowie die
          protokollierte Zustimmung zu AGB, EULA und Datenschutzhinweisen.
          Zweck: Konto bereitstellen. Quelle: deine Registrierung.
          Rechtsgrundlage: Art. 6 Abs. 1 lit. b DSGVO und Art. 6 Abs. 1 lit. c
          DSGVO.
        </li>
        <li>
          <strong>Workspace.</strong> Sitzungstitel, Nachrichten, Aufträge,
          Work-Läufe, Agents, Gruppenchats, Pläne, Prüfpunkte und Ereignisse.
          Zweck: den Assistenten, Work und Agents ausführen und den Verlauf
          anzeigen. Rechtsgrundlage: Art. 6 Abs. 1 lit. b DSGVO.
        </li>
        <li>
          <strong>Erinnerung.</strong> Angaben, die der Assistent aus deinen
          verifizierten Sitzungen übernimmt, begrenzt auf deinen Workspace.
          Rechtsgrundlage: Art. 6 Abs. 1 lit. b DSGVO.
        </li>
        <li>
          <strong>Dateien.</strong> Dateien, die du hochlädst, werden zum
          Weiterverwenden im eigenen Workspace in Text überführt. Passende
          Auszüge gehen mit deinen Fragen im selben Chat an das antwortende
          Modell. Rechtsgrundlage: Art. 6 Abs. 1 lit. b DSGVO.
        </li>
        <li>
          <strong>Websuche und Links.</strong> Schaltest du im Chat die Websuche
          ein, sendet Osirus aus deiner Nachricht abgeleitete Suchbegriffe an
          einen Suchdienst und ruft die gefundenen Seiten ab; Links in deiner
          Nachricht werden abgerufen, um sie zu lesen. Rechtsgrundlage: Art. 6
          Abs. 1 lit. b DSGVO.
        </li>
        <li>
          <strong>Geteilte Chats.</strong> Erstellst du einen Teilen-Link, kann
          jede Person mit diesem Link die Fragen und Antworten des Chats bis zum
          Zeitpunkt des Teilens lesen, bis du den Link deaktivierst. Dateien,
          Denkschritte und spätere Nachrichten werden nicht geteilt. Geteilte
          Seiten sind von Suchmaschinen ausgeschlossen. Rechtsgrundlage: Art. 6
          Abs. 1 lit. b DSGVO.
        </li>
        <li>
          <strong>Modellaufrufe und Kontingente.</strong> Rolle, Modellkennung,
          Tokenzahl, abgerechnete Kosten in USD, Laufzeit und bei einem Fehler
          eine Fehlerkategorie zur Abrechnung des 5-Stunden- und
          Wochenkontingents. Rechtsgrundlage: Art. 6 Abs. 1 lit. b DSGVO und
          Art. 6 Abs. 1 lit. f DSGVO (Betrieb, Caching und Kapazität).
        </li>
        <li>
          <strong>Sicherheit.</strong> Freigaben, abgelehnte Werkzeugaufrufe und
          Rate-Limit-Zähler gegen Missbrauch. Rechtsgrundlage: Art. 6 Abs. 1
          lit. f DSGVO.
        </li>
        <li>
          <strong>Technisch notwendige Cookies und Präferenzen.</strong> Sitzung
          und ausdrücklich gewählte Einstellungen gemäß § 25 Abs. 2 TDDDG. Wir
          setzen keine Analyse- oder Marketing-Cookies.
        </li>
      </ul>

      <h2>3. Empfänger</h2>
      <ul>
        <li>
          <strong>Neon, LLC</strong> (ein Unternehmen von Databricks) —
          Datenbank und Anmeldung. Die Datenbankregion ist die Europäische Union
          (eu-central-1, Frankfurt).
        </li>
        <li>
          <strong>Vercel Inc.</strong> — Hosting, Ausführung der Anwendung und,
          soweit konfiguriert, die isolierte Sandbox-Ausführung.
        </li>
        <li>
          <strong>GitHub</strong> (GitHub, Inc. / Microsoft) — nur wenn du dich
          mit GitHub anmeldest oder ein GitHub-Repository verbindest. Dabei
          erhält GitHub die für OAuth bzw. API-Zugriffe nötigen Daten.
        </li>
        <li>
          <strong>Stripe</strong> (Stripe Payments Europe, Ltd. und Stripe,
          Inc.) — Zahlungsdienst für Abonnements, Checkout und Kundenportal. Bei
          Buchung eines Abos verarbeitet Stripe die zur Zahlungsabwicklung
          erforderlichen Daten. Rechtsgrundlage: Art. 6 Abs. 1 lit. b DSGVO.
        </li>
        <li>
          <strong>Modellanbieter</strong> — Inhalte, die du zur Beantwortung
          oder Prüfung sendest (Nachrichten, Dateiauszüge, Webquellen), werden
          über die API-Schnittstellen von UNOROUTER, OpenRouter, Inc., NVIDIA
          Corporation (NIM), Bytez, Inc. und Lightning AI, Inc. verarbeitet, je
          nachdem, welches Modell eine Anfrage beantwortet.
        </li>
        <li>
          <strong>Weitere Modellanbieter</strong> — UNOROUTER und OpenRouter
          leiten Anfragen je nach Modell an dessen Anbieter weiter, etwa
          Anthropic, PBC, OpenAI, L.L.C., Google LLC, Alibaba Cloud (Qwen),
          Moonshot AI oder DeepSeek. Sende keine besonderen Kategorien
          personenbezogener Daten (Art. 9 DSGVO), die du diesen Empfängern nicht
          anvertrauen möchtest.
        </li>
        <li>
          <strong>Suchdienste</strong> — bei eingeschalteter Websuche Wikimedia
          Foundation, Inc. (Wikipedia) und, soweit eingerichtet, Tavily, Exa
          oder Firecrawl; bei Links in deiner Nachricht der Betreiber der
          jeweiligen Seite.
        </li>
      </ul>

      <h2>4. Drittland</h2>
      <p>
        Die genannten Stellen können Daten in den USA verarbeiten. Soweit ein
        Empfänger unter dem EU-US Data Privacy Framework zertifiziert ist,
        stützt sich die Übermittlung auf den Angemessenheitsbeschluss
        (Durchführungsbeschluss (EU) 2023/1795). Andernfalls verwenden wir
        Standardvertragsklauseln nach dem Durchführungsbeschluss (EU) 2021/914,
        soweit sie für den Empfänger gelten. Vercel Inc. und Neon über
        Databricks, Inc. sind nach dem Data Privacy Framework zertifiziert; das
        lässt sich unter dataprivacyframework.gov prüfen.
      </p>

      <h2>5. Speicherdauer</h2>
      <p>
        Kontodaten und Workspace-Inhalte speichern wir, solange das Konto
        besteht. Nach einer Löschanfrage an die oben genannte Adresse löschen
        oder anonymisieren wir sie unverzüglich, soweit keine gesetzlichen
        Aufbewahrungspflichten (insbesondere handels- und steuerrechtliche
        Pflichten für Abrechnungsdaten) entgegenstehen. Sicherungen werden im
        regulären Sicherungszyklus überschrieben.
      </p>

      <h2>6. Deine Rechte</h2>
      <p>
        Du hast das Recht auf Auskunft (Art. 15 DSGVO), Berichtigung (Art. 16),
        Löschung (Art. 17), Einschränkung (Art. 18), Datenübertragbarkeit (Art.
        20) und Widerspruch (Art. 21). Beruht eine Verarbeitung auf
        Einwilligung, kannst du sie jederzeit mit Wirkung für die Zukunft
        widerrufen (Art. 7 Abs. 3 DSGVO). Wir antworten innerhalb eines Monats
        (Art. 12 Abs. 3 DSGVO).
      </p>
      <p>
        Du kannst dich bei einer Aufsichtsbehörde beschweren (Art. 77 DSGVO).
        Zuständig für den Sitz der Verantwortlichen ist die Landesbeauftragte
        für Datenschutz und Informationsfreiheit Nordrhein-Westfalen (LDI NRW),
        Kavalleriestraße 2–4, 40213 Düsseldorf,{" "}
        <a href="https://www.ldi.nrw.de">www.ldi.nrw.de</a>.
      </p>

      <h2>7. Cookies und Speicher (§ 25 TDDDG)</h2>
      <p>
        Notwendige und von dir ausdrücklich gewünschte Speicherungen sind in der{" "}
        <Link href="/legal/cookies">Cookie-Erklärung</Link> vollständig
        aufgeführt. Optionale Analyse- oder Marketing-Cookies werden nicht
        eingesetzt.
      </p>

      <h2>8. Verbundene Systeme</h2>
      <p>
        Der Assistent handelt an Systemen, die du verbindest, etwa einem
        GitHub-Repository, erst nach deiner Freigabe für die konkrete Aktion.
        Freigaben werden protokolliert. Hinterlegte Zugangsdaten werden
        verschlüsselt gespeichert (AES-256-GCM). Die Datenbank hält sie nicht im
        Klartext.
      </p>

      <h2>9. Hinweise zu Modellantworten</h2>
      <p>
        Antworten erzeugt ein Sprachmodell. Sie können trotz unabhängigem
        Prüfermodell und deterministischer Verifikation Fehler enthalten.
        Inhalte, die du sendest, werden von UNOROUTER, NVIDIA und den in
        Abschnitt 3 genannten Modellanbietern zur Beantwortung verarbeitet.
      </p>

      <h2>10. Pflicht zur Bereitstellung</h2>
      <p>
        Name, E-Mail und ein Passwort oder die Anmeldung über GitHub sind für
        das Konto erforderlich. Ohne diese Angaben kommt der Vertrag nicht
        zustande. Alle weiteren Angaben sind freiwillig.
      </p>

      <h2>11. Stand und Änderung</h2>
      <p>Stand: 26. Oktober 2026.</p>
      <p>
        Wenn sich die Verarbeitung ändert, aktualisieren wir diese
        Datenschutzerklärung. Die jeweils veröffentlichte Fassung ist die
        geltende.
      </p>
    </article>
  );
}
