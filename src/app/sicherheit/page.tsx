import type { Metadata } from "next";
import Link from "next/link";
import { OPERATOR } from "../legal/operator";

export const metadata: Metadata = {
  title: "Sicherheit und Datenschutz",
  description:
    "Wie Osirus deine Daten schützt: Hosting in Frankfurt (EU), getrennte Workspaces, verschlüsselte Zugangsdaten, Freigabe vor jeder Aktion nach außen und AVV für Unternehmen.",
  alternates: { canonical: "/sicherheit" },
};

const POINTS: Array<{ title: string; body: string }> = [
  {
    title: "Daten in der EU",
    body: "Anwendung und Datenbank laufen in Rechenzentren in Frankfurt am Main. Deine Chats, Dateien und Einstellungen werden dort gespeichert, verschlüsselt im Ruhezustand und nur verschlüsselt (TLS) übertragen.",
  },
  {
    title: "Getrennte Workspaces",
    body: "Jede Abfrage an die Datenbank läuft mit der Identität der angemeldeten Person. Die Datenbank selbst erzwingt, dass niemand Daten eines anderen Workspaces lesen oder ändern kann (Row Level Security), auch nicht durch einen Fehler in der Anwendung.",
  },
  {
    title: "Verschlüsselte Zugangsdaten",
    body: "Tokens für verbundene Dienste wie GitHub oder eigene MCP-Server werden mit AES-256-GCM verschlüsselt gespeichert und nur im Moment der Nutzung entschlüsselt. Sie erscheinen nie im Browser oder in Protokollen.",
  },
  {
    title: "Freigabe vor jeder Aktion nach außen",
    body: "Agent und Code lesen selbstständig, aber alles, was in verbundenen Systemen etwas verändert, wartet auf deine ausdrückliche Freigabe. Jede Aktion wird mit Zeitpunkt protokolliert.",
  },
  {
    title: "Deine Inhalte bleiben deine",
    body: "Osirus nutzt deine Chats und Dateien nicht, um eigene Modelle zu trainieren. Inhalte werden nur verarbeitet, um deine Anfrage zu beantworten. Anweisungen in Dateien oder Webseiten behandelt Osirus als Inhalt, nicht als Befehl.",
  },
  {
    title: "Anmeldung und Zahlung",
    body: "Passwörter werden nur als sicherer Hash gespeichert, Anmeldeversuche sind begrenzt, Sitzungen liegen in geschützten Cookies. Kartendaten verarbeitet ausschließlich unser zertifizierter Zahlungsdienstleister; Osirus speichert keine Zahlungsdaten.",
  },
];

export default function SecurityPage() {
  return (
    <article className="legal-body security" lang="de">
      <h1>Sicherheit und Datenschutz</h1>
      <p className="security-lede">
        Osirus ist für Arbeit gebaut, bei der Fehler etwas kosten. Darum gilt:
        Deine Daten bleiben in der EU, Workspaces sind auf Datenbankebene
        getrennt, und nichts wirkt nach außen ohne deine Freigabe.
      </p>

      <ul className="security-points">
        {POINTS.map((point) => (
          <li key={point.title}>
            <h2>{point.title}</h2>
            <p>{point.body}</p>
          </li>
        ))}
      </ul>

      <h2>Für Unternehmen: AVV nach Art. 28 DSGVO</h2>
      <p>
        Wir schließen mit dir einen Vertrag zur Auftragsverarbeitung (AVV) ab
        und nennen darin alle Unterauftragsverarbeiter und technischen und
        organisatorischen Maßnahmen. Schreib uns an{" "}
        <a href={`mailto:${OPERATOR.email}?subject=AVV%20f%C3%BCr%20Osirus`}>
          {OPERATOR.email}
        </a>
        .
      </p>

      <h2>Auskunft, Export und Löschung</h2>
      <p>
        Du kannst jederzeit Auskunft über deine Daten, eine Kopie oder die
        Löschung deines Kontos verlangen; formlos per E-Mail an die Adresse
        oben. Details stehen in der{" "}
        <Link href="/legal/privacy">Datenschutzerklärung</Link>.
      </p>

      <h2>Sicherheitslücke gefunden?</h2>
      <p>
        Melde sie bitte vertraulich an{" "}
        <a
          href={`mailto:${OPERATOR.email}?subject=Sicherheitsmeldung%20Osirus`}
        >
          {OPERATOR.email}
        </a>
        . Wir bestätigen den Eingang innerhalb von zwei Werktagen und halten
        dich über die Behebung auf dem Laufenden.
      </p>
    </article>
  );
}
