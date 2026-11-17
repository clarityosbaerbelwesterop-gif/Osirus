# Datenschutz-Folgenabschätzung (Art. 35 DSGVO)

Stand: 17. November 2026 · Status: **Entwurf zur Freigabe durch die
Verantwortliche** (Bärbel Westerop). Überprüfung: jährlich und bei jeder
wesentlichen Änderung der Verarbeitung (neuer Modellanbieter, neue
Datenkategorie, neue Funktion mit Wirkung nach außen).

## 1. Schwellwertanalyse

### 1.1 Muss-Liste der Datenschutzkonferenz (DSK, Version 1.1)

| Nr.    | Fallgruppe                                                                                                                                                             | Osirus                                                                                                                                       | Ergebnis                      |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| 11     | Einsatz von künstlicher Intelligenz zur Verarbeitung personenbezogener Daten zur Steuerung der Interaktion mit den Betroffenen oder zur Bewertung persönlicher Aspekte | KI-Modelle verarbeiten die Nachrichten der Person und antworten ihr; Agenten handeln in ihrem Auftrag. Keine Bewertung persönlicher Aspekte. | **Einschlägig (Interaktion)** |
| andere | Profiling, Scoring, Überwachung, Standortdaten, Kommunikationsüberwachung u. a.                                                                                        | nicht gegeben                                                                                                                                | nicht einschlägig             |

### 1.2 Kriterien der Leitlinien WP 248 rev.01 (EDSA)

| Kriterium                                     | Osirus                                                                        | Erfüllt           |
| --------------------------------------------- | ----------------------------------------------------------------------------- | ----------------- |
| Bewertung oder Scoring                        | Modellwahl richtet sich nach der Aufgabe, nicht nach der Person               | nein              |
| Automatisierte Entscheidung mit Rechtswirkung | keine (Datenschutzerklärung Abschnitt 23)                                     | nein              |
| Systematische Überwachung                     | keine                                                                         | nein              |
| Sensible oder höchstpersönliche Daten         | nicht vorgesehen, aber in frei eingegebenen Inhalten nicht auszuschließen     | **teilweise**     |
| Umfangreiche Verarbeitung                     | derzeit wenige Dutzend Konten; mit Wachstum steigend                          | nein (beobachten) |
| Abgleich oder Zusammenführung von Datensätzen | Verbindungen lesen Daten anderer Dienste nur im Auftrag und Umfang der Person | nein              |
| Schutzbedürftige Betroffene                   | ab 18 Jahren; bei Geschäftskunden Daten von Beschäftigten möglich             | teilweise         |
| Innovative Technologie                        | Sprachmodelle und Agenten                                                     | **ja**            |
| Hindernis bei Rechtsausübung                  | Self-Service für Auskunft und Löschung                                        | nein              |

**Ergebnis:** Muss-Liste Nr. 11 ist einschlägig, und zwei Kriterien der WP 248
sind (teilweise) erfüllt. **Eine DSFA ist durchzuführen.** Sie folgt.

## 2. Systematische Beschreibung (Art. 35 Abs. 7 lit. a)

- **Verarbeitungen:** Nr. 3 bis 9 und 17 des Verzeichnisses
  (`verzeichnis-verarbeitungstaetigkeiten.md`): Chat mit KI-Modellen, Rouge
  Agent und Code, Ausführen von Code, Bots und Gedächtnis, Dateien, Websuche,
  Verbindungen, Automationen.
- **Zweck:** Erbringung des vertraglich vereinbarten Dienstes (Art. 6 Abs. 1
  lit. b).
- **Datenfluss:** Browser → Osirus (Vercel, Region Frankfurt) → Datenbank
  (Neon, Frankfurt, Row-Level Security) → zur Beantwortung nötiger Kontext an
  einen Modellanbieter (Abschnitt 18 der Datenschutzerklärung) → Antwort zurück.
  Wirkung nach außen (GitHub, MCP-Server, Webhooks) nur nach Freigabe der
  genauen Eingabe.
- **Beteiligte:** Verantwortliche; Auftragsverarbeiter Vercel, Neon, Resend;
  Modellanbieter; eigenständig verantwortliche Dienste, die die Person verbindet.

## 3. Notwendigkeit und Verhältnismäßigkeit (lit. b)

- **Datenminimierung:** An das Modell geht nur der Kontext der Unterhaltung,
  passende Dateiauszüge (nicht ganze Dateien) und zitierte Quellen. Suchdienste
  erhalten nur Suchbegriffe, keine Kennung, keine IP-Adresse.
- **Speicherbegrenzung:** Löschkonzept (`loeschkonzept.md`), automatische
  Fristen, Self-Service-Löschung.
- **Zweckbindung:** Kein Training eigener Modelle mit Inhalten, keine Werbung,
  kein Tracking.
- **Transparenz:** Datenschutzerklärung mit allen Empfängern und Fristen;
  KI-Hinweis nach Art. 50 KI-VO.
- **Betroffenenrechte:** Export und Löschung als Self-Service, Archivieren
  steuert das Bot-Gedächtnis.

## 4. Risiken für Rechte und Freiheiten (lit. c) und Maßnahmen (lit. d)

Bewertung: Eintrittswahrscheinlichkeit × Schwere, jeweils gering / mittel /
hoch, vor und nach den Maßnahmen (Verweise auf `tom.md`).

| Nr. | Risiko                                                                                                  | vorher          | Maßnahmen                                                                                                                                                                              | Restrisiko                                                                              |
| --- | ------------------------------------------------------------------------------------------------------- | --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| R1  | Offenlegung von Chat-Inhalten durch Modellanbieter (Protokollierung, Training bei kostenlosen Modellen) | mittel × hoch   | Hinweis in Datenschutzerklärung und KI-Hinweis; bezahlte Pläne auf Anbieter mit Vertragsbedingungen; keine besonderen Kategorien eingeben (Hinweis); Auswahl der Anbieter dokumentiert | **mittel** — verbleibt bei Free-Modellen; durch Anbieterverträge (AVV) weiter zu senken |
| R2  | Zugriff eines Mandanten auf Daten eines anderen                                                         | gering × hoch   | Row-Level Security mit FORCE, `queryAs`; Mitgliedschaften an die Organisation gebunden (Migration 030); Tests gegen alle Migrationen                                                   | gering                                                                                  |
| R3  | Diebstahl hinterlegter Zugangsschlüssel                                                                 | gering × hoch   | AES-256-GCM v2 mit Workspace-Bindung und Rotation; Redaktion in Fehlern und Protokollen; MCP-Adressen versiegelt                                                                       | gering                                                                                  |
| R4  | Ungewollte Handlungen nach außen durch Prompt-Injection aus Webseiten oder Dateien                      | mittel × hoch   | Freigabe jeder Wirkung nach außen mit vollständig angezeigter Eingabe; Inhalte als Daten markiert; Bot-Werkzeuge atomar freigegeben                                                    | gering                                                                                  |
| R5  | Unrichtige Ergebnisse (Grundsatz der Richtigkeit)                                                       | hoch × mittel   | KI-Hinweis; Quellen mit Datum; getrenntes Prüfermodell und deterministische Checks bei Agenten; Code im Chat ausführbar                                                                | mittel (inhärent; Person entscheidet über die Verwendung)                               |
| R6  | Zugriff von Behörden in Drittländern                                                                    | gering × hoch   | DPF bzw. SCC; Datenbank in der EU; nur nötiger Kontext verlässt die EU                                                                                                                 | gering bis mittel                                                                       |
| R7  | Speicherung länger als nötig                                                                            | mittel × mittel | Automatische Fristen, Löschung als Self-Service                                                                                                                                        | gering                                                                                  |
| R8  | Kontoübernahme                                                                                          | gering × hoch   | Anmeldung und Registrierung begrenzt (IP- und E-Mail-Hash), sichere Cookies, Löschen nur mit frischer Anmeldung, CSP mit Nonce gegen Skript-Einschleusung                              | gering                                                                                  |
| R9  | Einschleusen von Skripten (XSS) mit Zugriff auf Inhalte                                                 | gering × hoch   | Markdown ohne rohes HTML, CSP mit Nonce und strict-dynamic, kein Framing                                                                                                               | gering                                                                                  |

## 5. Ergebnis

Nach den Maßnahmen besteht **kein hohes Restrisiko**; eine vorherige
Konsultation der Aufsichtsbehörde (Art. 36) ist nicht erforderlich. Das höchste
Restrisiko (R1) wird durch abgeschlossene Auftragsverarbeitungsverträge mit den
Modellanbietern und die Bevorzugung von Anbietern ohne Trainingsnutzung weiter
gesenkt (offener Punkt der Betreiberin, `README.md`).

| Freigabe                         | Datum | Unterschrift |
| -------------------------------- | ----- | ------------ |
| Verantwortliche: Bärbel Westerop |       |              |
