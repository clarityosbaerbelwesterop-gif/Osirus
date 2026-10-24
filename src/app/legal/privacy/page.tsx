import Link from "next/link";
import { LegalDraftNote } from "@/components/legal/draft-note";
import { OPERATOR } from "../operator";

export const metadata = {
  title: "Datenschutz",
  description:
    "Datenschutzerklärung von Osirus: Verantwortliche, Empfänger, Rechte und Cookies.",
};

export default function PrivacyPage() {
  return (
    <article className="legal-body" lang="de">
      <LegalDraftNote />
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
          über E-Mail und Passwort oder über GitHub OAuth. Zweck: Konto
          bereitstellen. Quelle: deine Registrierung. Rechtsgrundlage: Art. 6
          Abs. 1 lit. b DSGVO.
        </li>
        <li>
          <strong>Workspace.</strong> Sitzungstitel, Nachrichten, Aufträge,
          Pläne, Prüfpunkte und Ereignisse. Zweck: den Assistenten ausführen und
          den Verlauf anzeigen. Rechtsgrundlage: Art. 6 Abs. 1 lit. b DSGVO.
        </li>
        <li>
          <strong>Erinnerung.</strong> Angaben, die der Assistent aus deinen
          Sitzungen übernimmt, begrenzt auf deinen Workspace. Rechtsgrundlage:
          Art. 6 Abs. 1 lit. b DSGVO.
        </li>
        <li>
          <strong>Dateien.</strong> Dateien, die du hochlädst, werden zum
          Weiterverwenden in Text überführt. Rechtsgrundlage: Art. 6 Abs. 1 lit.
          b DSGVO.
        </li>
        <li>
          <strong>Modellaufrufe.</strong> Rolle, Modellkennung, Tokenzahl,
          Laufzeit und bei einem Fehler eine Fehlerkategorie. Prompt und Antwort
          stehen nicht in diesen Protokollen. Rechtsgrundlage: Art. 6 Abs. 1
          lit. b DSGVO und Art. 6 Abs. 1 lit. f DSGVO (Betrieb und Kapazität).
        </li>
        <li>
          <strong>Sicherheit.</strong> Freigaben, abgelehnte Werkzeugaufrufe und
          Zähler gegen Missbrauch. Rechtsgrundlage: Art. 6 Abs. 1 lit. f DSGVO.
        </li>
        <li>
          <strong>Einwilligung in optionale Cookies.</strong> Deine Wahl im
          Cookie-Hinweis, damit wir sie nicht bei jedem Besuch neu fragen.
          Rechtsgrundlage: Art. 6 Abs. 1 lit. c DSGVO in Verbindung mit § 25
          TDDDG. Derzeit setzen wir keine optionalen Cookies.
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
          soweit konfiguriert, die Sandbox.
        </li>
        <li>
          <strong>GitHub</strong> (GitHub, Inc. / Microsoft) — nur wenn du dich
          mit GitHub anmeldest oder GitHub verbindest. Dabei erhält GitHub die
          für OAuth nötigen Daten.
        </li>
        <li>
          <strong>Stripe</strong> (Stripe Payments Europe, Ltd. und Stripe,
          Inc.) — Zahlungsdienst für die Abos. Solange die Buchung nicht
          freigeschaltet ist, übermitteln wir keine Zahlungsdaten. Sobald ein
          Abo buchbar ist, verarbeitet Stripe die zur Zahlung nötigen Daten als
          eigener Verantwortlicher.
        </li>
        <li>
          <strong>UNOROUTER</strong> — Inhalte, die du zur Beantwortung sendest,
          gehen an den konfigurierten Modellzugang UNOROUTER.
        </li>
        <li>
          <strong>Anthropic, PBC und OpenAI, L.L.C.</strong> — UNOROUTER kann
          eine Anfrage an diese Modellanbieter weiterleiten. Welche Anbieter ein
          konkreter Aufruf erreicht, hängt von der Route ab. Sende nichts, das
          du diesen Stellen nicht anvertrauen willst.
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
        oder anonymisieren wir sie, soweit kein Gesetz eine weitere Aufbewahrung
        verlangt. Sicherungen werden überschrieben, sobald der laufende
        Sicherungszyklus sie ersetzt.
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
        <Link href="/legal/cookies">Cookie-Erklärung</Link> aufgezählt.
        Optionale Cookies setzen wir erst, nachdem du im Hinweis zugestimmt
        hast. Ein Ablehnen lässt die notwendige Nutzung unberührt.
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
        Antworten erzeugt ein Sprachmodell. Sie können falsch sein. Eine Antwort
        des Modells allein ist kein Beleg. Ein getrenntes Prüfermodell ist noch
        nicht verfügbar. Inhalte, die du sendest, können von UNOROUTER und den
        in Abschnitt 3 genannten Modellanbietern verarbeitet werden.
      </p>

      <h2>10. Pflicht zur Bereitstellung</h2>
      <p>
        Name, E-Mail und ein Passwort oder die Anmeldung über GitHub sind für
        das Konto erforderlich. Ohne diese Angaben kommt der Vertrag nicht
        zustande. Alle weiteren Angaben sind freiwillig.
      </p>

      <h2>11. Änderung</h2>
      <p>
        Wenn sich die Verarbeitung ändert, aktualisieren wir diese Seite. Die
        jeweils veröffentlichte Fassung ist die geltende.
      </p>
    </article>
  );
}
